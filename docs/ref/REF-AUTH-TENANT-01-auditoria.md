# REF-AUTH-TENANT-01 — Tenant verificável no JWT

17 ago 2026. Auditoria + arquitetura proposta. Zero implementação. Espelho do artifact publicado na
sessão. Aprovado pelo dono como "Caminho 2" da revisão de [[REF-ADDRESS-SEC-02]] — tratar a causa raiz
na arquitetura de autenticação em vez de mitigar em `addresses` isoladamente.

## Achado de pesquisa que definiu o desenho

Confirmei via documentação oficial do Supabase (não presumido) que o Custom Access Token Hook recebe
**só** `user_id`, claims atuais e `authentication_method` — nunca headers HTTP, Origin, Referer, nem
dado extra que o app queira passar. Isso descarta a ideia óbvia ("hook decide o tenant pelo domínio")
e levou ao desenho real: **ativar o tenant é um passo explícito e verificado, separado do login,** cujo
resultado o Hook só assina depois.

## Desenho

1. Login normal — token emitido sem `tenant_id` ainda (Hook é no-op se não achar nada).
2. App resolve a loja pelo domínio (como já faz hoje, `get_store_by_domain`) — continua sendo só hint
   de UX.
3. App chama `activate_tenant(p_store_id)` — SECURITY DEFINER, verifica de verdade
   `EXISTS(customers WHERE auth_user_id=auth.uid() AND store_id=p_store_id) AND stores.status='ativo'`.
   Se válido, grava em `public.active_tenant(auth_user_id, store_id)` (tabela nova, 1 linha por pessoa).
4. App força `refreshSession()` — dispara o Hook de novo.
5. Hook lê `active_tenant` e embute `claims.tenant_id` — assinado, imutável pelo client a partir daqui.
6. Toda RLS/RPC passa a ler `(auth.jwt()->>'tenant_id')::uuid` — nunca mais um parâmetro cru.

**Por que fecha o teste do curl**: uma vez que o token tem `tenant_id=Encanto` assinado, nenhuma
manipulação de parâmetro em chamadas subsequentes muda isso. A única forma de obter acesso à Bar da
Sogra é chamar `activate_tenant('bar-uuid')` de verdade — o que só sucede se a pessoa REALMENTE for
cliente de lá — seguido de refresh. Nesse ponto não é mais ataque, é troca legítima.

## Admin/Super Admin — preservados por desenho

Recomendação: **não** dar claim de tenant ao Admin. `is_admin_of(p_store_id)` já é correto para o que
o Admin precisa (gerenciar várias lojas na mesma sessão é o comportamento pretendido, não uma falha).
O Hook precisa ser um no-op seguro quando não há linha em `active_tenant` (login de admin).

## Staleness — registrado sem meio-termo escondido

Perder acesso a uma loja não é revogação instantânea — token já emitido continua valendo até expirar
(~1h padrão) ou renovar. É limitação inerente de qualquer JWT de vida curta, não um descuido desta
REF.

## Risco não verificado

Não confirmei se o plano/tier atual do projeto Supabase suporta Custom Access Token Hook (token da
Management API local expirado). Precisa checar no Dashboard antes de aprovar a implementação.

## Plano de 7 ondas

Infraestrutura (tabela + Hook) → `activate_tenant` + wiring no boot → `link_customer_to_auth` →
RLS de `addresses` → `save_structured_address` + RPC de leitura → testes de ataque (5 casos) →
regressão completa. Cada onda com gate próprio de aprovação.

SQL preliminar (conceitual, não a versão final) no artifact. Aguardando aprovação do desenho antes de
qualquer implementação.

## Gate final — auditoria de `activate_tenant()` (2ª rodada)

Dono confirmou: Custom Access Token Hook disponível no Free e Pro do Supabase — não precisa migrar de
plano.

**Achado de concorrência que corrigiu o desenho**: a 1ª versão usava `auth_user_id` como chave
primária de `active_tenant` (1 linha por pessoa, global). Isso quebra o cenário de 2 abas em lojas
diferentes (mesma pessoa): a 2ª ativação sobrescreveria a 1ª, e no próximo refresh silencioso da 1ª
aba ela perderia o próprio tenant sem pedir. **Corrigido**: as claims padrão do Supabase já incluem
`session_id` (confirmado na pesquisa da 1ª rodada) — cada login tem o seu, e como cada loja é um
domínio separado (localStorage isolado por origem, já é assim hoje), abas em lojas diferentes têm
`session_id` diferentes. `active_tenant` passa a ser chaveada por `session_id`
(`REFERENCES auth.sessions(id) ON DELETE CASCADE` — confirmei que `auth.sessions` existe de verdade
no projeto), não mais por pessoa — isolamento correto entre abas/sessões, limpeza automática no
logout.

**`activate_tenant()` auditada nos 16 pontos pedidos**: SECURITY DEFINER (mesmo padrão de
`save_structured_address`), só `authenticated`, mesma verificação `EXISTS(customers+stores ativa)`
já validada nas REFs anteriores, sem distinguir "loja não existe" de "loja inativa" na mensagem de
erro (evita dar pista pra quem testa IDs por tentativa e erro). Achado incidental: não há UNIQUE
constraint em `customers(auth_user_id, store_id)` — não afeta `activate_tenant` (EXISTS não precisa
de linha única), registrado como hardening futuro, fora do escopo crítico.

**Hook fail-closed confirmado linha por linha**: reconfirma `stores.status='ativo'` a CADA refresh
(não só na ativação) — se a loja for desativada depois, o claim some no próximo refresh, nunca emite
valor inválido.

**RLS conceitual demonstrada**: `store_id = (auth.jwt()->>'tenant_id')::uuid AND customer_id IN
(customers do auth.uid() nesse mesmo tenant)` — teste definitivo (6 tentativas: leitura direta,
parâmetro manipulado, RPC manipulada, curl, e finalmente ativação legítima seguida de troca) percorrido
passo a passo, todas resolvendo como especificado.

Zero implementação nesta rodada também. Aguardando aprovação final do dono.

## Implementação aprovada — plano de 7 ondas confirmado

Dono aprovou a implementação completa em 17 ago 2026, confirmando a decisão de `active_tenant`
chaveada por `session_id` (não `auth_user_id`) e a regra de que `activate_tenant(store_id)` é
autorização verificada server-side, nunca confiança no parâmetro. Ordem de ondas confirmada:
(1) `active_tenant` → (2) `activate_tenant()` → (3) Custom Access Token Hook →
(4) integração de sessão/storefront → (5) RLS/RPC → (6) `customers`/`link_customer_to_auth` →
(7) ataque + regressão. Cada onda com gate próprio — implementação → testes → auditoria do diff →
commit → relatório → próxima onda. Push/deploy só ao final, com autorização própria.

### Onda 1 — tabela `active_tenant`

**Implementado**: `migrations/REF-AUTH-TENANT-01-onda1-active-tenant.sql` (+ rollback).

```sql
CREATE TABLE public.active_tenant (
  session_id   uuid PRIMARY KEY REFERENCES auth.sessions(id) ON DELETE CASCADE,
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id     uuid NOT NULL REFERENCES public.stores(id),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX active_tenant_auth_user_id_idx ON public.active_tenant (auth_user_id);
ALTER TABLE public.active_tenant ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.active_tenant FROM authenticated;
REVOKE ALL ON public.active_tenant FROM anon;
```

Decisões de nomenclatura: a coluna chama-se `store_id` (não `tenant_id`) para ficar consistente com
`customers`/`addresses`/`admins`, que já usam esse nome — o claim assinado no JWT (Onda 3) é que vai
se chamar `tenant_id`, é só o nome externo. Um único timestamp (`updated_at`) — cobre tanto a
1ª ativação quanto trocas de loja, sem duplicar `auth.sessions.created_at`.

**Zero policy criada de propósito**: RLS ligada + zero policies = deny-all para qualquer role sujeita
a RLS (`authenticated`/`anon`). Só `postgres` (usado pelas funções `SECURITY DEFINER` das próximas
ondas, `rolbypassrls=true`) e `service_role` continuam acessando. `supabase_auth_admin` (role que vai
executar o Hook na Onda 3) ainda não recebeu nenhum grant — só quando o Hook existir.

**Testado** (todos em transações `BEGIN...ROLLBACK`, fixture real de `auth.sessions`/`customers`,
zero PII exposta — só UUIDs):
- Migration aplicada via dry-run (`COMMIT`→`ROLLBACK` temporário) antes da aplicação real — zero
  resíduo confirmado por `to_regclass`.
- Após aplicação real: colunas/tipos/nullability conferem exatamente com o desenho; PK em
  `session_id`; FK `session_id→auth.sessions.id` e `auth_user_id→auth.users.id` ambas
  `ON DELETE CASCADE`; FK `store_id→stores.id` sem cascade (padrão `NO ACTION`, correto — não há
  hard-delete de lojas no app); `relrowsecurity=true`; grants finais só para `postgres`/`service_role`
  (authenticated e anon sem nenhum privilégio); zero policies; 2 índices (PK + `auth_user_id`).
- `SET LOCAL ROLE authenticated` + `SELECT` real → `permission denied for table active_tenant`.
- `SET LOCAL ROLE authenticated` + `INSERT` real → `permission denied for table active_tenant`.
- `postgres` INSERT com fixture real (`session_id`/`user_id`/`store_id` reais de uma sessão
  existente) → sucede, linha correta, depois `ROLLBACK` — zero resíduo.
- `postgres` INSERT com `session_id` inexistente (`gen_random_uuid()`) → `violates foreign key
  constraint active_tenant_session_id_fkey` — confirma que FK é enforced independente de
  `bypassrls` (FK não é RLS).
- Tabela confirmada vazia (`count=0`) após todos os testes.

**Regressão**: `test:domain` verde (exit 0). `test:db-guards` — 19 PASS / 1 FAIL, o FAIL é
`S4:addresses backfill completo` (8 linhas históricas com `store_id` NULL) — **pré-existente, sem
relação com esta onda** (a migration desta onda não toca `addresses`; é o gap já registrado como
follow-up `REF-ADDRESS-STOREID-01` desde a autorização de push da UX-01). `build` e `build:admin`
verdes.

**Diff**: 2 arquivos novos (`migrations/REF-AUTH-TENANT-01-onda1-active-tenant.sql` +
`-rollback.sql`). Nenhum arquivo de código/frontend tocado nesta onda.

**Riscos**: nenhum — tabela nova, sem FK de saída de nenhuma tabela existente apontando para ela
ainda (nada além desta migration referencia `active_tenant`), zero acesso possível fora de
`postgres`/`service_role`. Reversível via rollback a qualquer momento sem efeito colateral (nada
depende dela ainda).

**Resultado**: Onda 1 fechada. Aguardando aprovação para Onda 2 (`activate_tenant()`).

### Onda 2 — RPC `activate_tenant(p_store_id)`

**Implementado**: `migrations/REF-AUTH-TENANT-01-onda2-activate-tenant.sql` (+ rollback).

```sql
CREATE OR REPLACE FUNCTION public.activate_tenant(p_store_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_session_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'sessao invalida';
  END IF;

  v_session_id := NULLIF(auth.jwt()->>'session_id', '')::uuid;
  IF v_session_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.sessions WHERE id = v_session_id) THEN
    RAISE EXCEPTION 'sessao invalida';
  END IF;

  IF p_store_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.customers c JOIN public.stores s ON s.id = c.store_id
    WHERE c.auth_user_id = auth.uid() AND c.store_id = p_store_id AND s.status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'tenant indisponivel';
  END IF;

  INSERT INTO public.active_tenant (session_id, auth_user_id, store_id, updated_at)
  VALUES (v_session_id, auth.uid(), p_store_id, now())
  ON CONFLICT (session_id) DO UPDATE SET store_id = EXCLUDED.store_id, updated_at = now();
END;
$function$;

REVOKE ALL ON FUNCTION public.activate_tenant(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.activate_tenant(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.activate_tenant(uuid) TO authenticated;
```

**Ownership em cada camada**: `auth.uid()` (identidade, nunca parâmetro) → `customers.auth_user_id = auth.uid() AND customers.store_id = p_store_id` (vínculo real com a loja pedida) → `stores.status = 'ativo'` (loja disponível) → `session_id` lido de `auth.jwt()->>'session_id'` (nunca parâmetro) e confirmado como sessão real em `auth.sessions` antes de gravar. `p_store_id` é só o seletor — a autorização inteira vem de fontes assinadas/servidor, nunca de um argumento que o client controla. Assinatura final tem **um único parâmetro** (`p_store_id uuid`) — não existe forma sintática de o caller passar `session_id` ou `auth_user_id`.

**Mensagens sem enumeração**: "loja não existe", "loja inativa" e "sem vínculo" retornam exatamente a mesma exceção (`tenant indisponivel`) — confirmado nos testes que as 3 strings de erro são idênticas byte a byte. `sessao invalida` é uma categoria à parte (estado da sessão, não do tenant) — não vaza informação sobre lojas.

**Testado** (`scripts/auth-tenant-onda2-activate-tenant-test.mjs`, novo, 24 verificações, todas em `BEGIN...ROLLBACK`, fixtures reais — inclusive duas sessões reais e simultâneas da mesma pessoa usadas no teste de concorrência):
- Vínculo válido (Encanto e Bar, este com customer sintético) → ALLOW, linha gravada com `session_id`/`auth_user_id`/`store_id` corretos.
- Sem vínculo, loja inexistente, loja inativa (fixture sintética, `status='suspenso'` — `stores_status_check` só aceita `ativo`/`suspenso`/`cancelado`, não existe `'inativo'` na constraint) → DENY, as 3 mensagens **idênticas**.
- `p_store_id NULL` → DENY.
- Prova estrutural: `pg_get_function_identity_arguments` = `p_store_id uuid`, único parâmetro possível.
- Troca legítima: mesma sessão ativa Encanto e depois Bar → ambas ALLOW, UPSERT atualiza a mesma linha (`session_id` é PK).
- **Concorrência real**: usuário com 2 sessões reais simultâneas (`SESSION_DUAL_A`/`SESSION_DUAL_B`, mesma pessoa) ativa Encanto na sessão A e Bar na sessão B — ambas as linhas coexistem em `active_tenant`, nenhuma sobrescreveu a outra. Confirma na prática a correção de desenho decidida no gate final (chave por `session_id`, não `auth_user_id`).
- `STRANGER` (zero vínculo com qualquer customer) → DENY.
- `session_id` ausente do claim → DENY (`sessao invalida`).
- `session_id` sintaticamente válido mas sem linha real em `auth.sessions` → DENY limpo (`sessao invalida`), não erro cru de FK.
- `anon` → `permission denied for function activate_tenant` (sem grant de EXECUTE). Grants finais confirmados via `information_schema.routine_privileges`: só `authenticated`/`postgres`/`service_role`.
- `SECURITY DEFINER=true`, `search_path=pg_catalog, public` confirmados via `pg_proc` — mesmo padrão de `save_structured_address`/`is_admin_of`/`link_customer_to_auth`, protegido contra search_path injection.
- Logout (estrutural, sem mecanismo paralelo): FK `active_tenant.session_id → auth.sessions.id` continua `ON DELETE CASCADE` (reconfirmado, não alterado nesta onda) — teste de logout real (encerrar uma sessão de verdade) fica pra quando houver integração de sessão de fato (Onda 4); aqui só se confirma que o mecanismo de limpeza continua correto estruturalmente.
- `active_tenant` confirmada vazia ao final (nenhum teste persistiu linha real).

**Regressão**: `test:domain` verde. `test:db-guards` (cadeia `&&`) para no mesmo FAIL pré-existente de sempre (`S4:addresses backfill`, 8 linhas históricas — `REF-ADDRESS-STOREID-01`, sem relação com esta onda) antes de chegar na suite nova no fim da cadeia — por isso a suite desta onda também foi rodada isoladamente (`npm run test:auth-tenant-onda2-activate-tenant`), 24/24 verde, duas vezes. `build` e `build:admin` verdes.

**Diff**: `migrations/REF-AUTH-TENANT-01-onda2-activate-tenant.sql` (+rollback), `scripts/auth-tenant-onda2-activate-tenant-test.mjs` (novo), `package.json` (1 script novo, referenciado em `test:db-guards`), este doc. Nenhum arquivo de frontend/Admin tocado.

**Riscos/limitações**: a suposição de que `auth.jwt()->>'session_id'` está presente no token real emitido pelo GoTrue deste projeto foi pesquisada via documentação oficial na fase de desenho (não nesta onda) — a confirmação end-to-end contra um token REAL emitido por login de verdade só acontece na Onda 4 (integração de sessão/storefront), quando `activate_tenant()` passa a ser chamada de fato pelo app. Até lá, `activate_tenant()` existe e está correta, mas nada no app a chama ainda — zero risco de regressão em produção.

**Resultado**: Onda 2 fechada. Aguardando aprovação para Onda 3 (Custom Access Token Hook).

### Onda 3 — Custom Access Token Hook

**Implementado**: `migrations/REF-AUTH-TENANT-01-onda3-custom-access-token-hook.sql` (+ rollback),
aplicada em produção **e** no projeto E2E dedicado (`bgzcrovskjbktdxkhemd`).

```sql
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_session_id uuid; v_store_id uuid; v_claims jsonb;
BEGIN
  v_claims := coalesce(event->'claims', '{}'::jsonb);
  v_session_id := NULLIF(v_claims->>'session_id', '')::uuid;
  IF v_session_id IS NOT NULL THEN
    SELECT at.store_id INTO v_store_id
    FROM public.active_tenant at JOIN public.stores s ON s.id = at.store_id
    WHERE at.session_id = v_session_id AND s.status = 'ativo';
  END IF;
  IF v_store_id IS NOT NULL THEN
    v_claims := jsonb_set(v_claims, '{tenant_id}', to_jsonb(v_store_id::text));
  END IF;
  RETURN jsonb_set(event, '{claims}', v_claims);
EXCEPTION WHEN OTHERS THEN
  RETURN event;
END;
$function$;

REVOKE ALL ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
```

**Fail-closed em 2 níveis, de propósito**: (1) sem `session_id`, sem linha em `active_tenant` ou loja
não `ativo` → `tenant_id` simplesmente não entra nas claims — login continua normal (é o caso de
Admin/Super Admin, que nunca tem linha em `active_tenant`, e do primeiro login antes de qualquer
`activate_tenant()`). (2) `EXCEPTION WHEN OTHERS THEN RETURN event` — qualquer erro inesperado devolve
o evento original sem `tenant_id`, **nunca propaga exceção**. Isso é deliberado e crítico: documentação
oficial confirma que uma exceção dentro de um Auth Hook de emissão de token derruba a autenticação de
**todo mundo**, não só de quem usa tenant — preferimos "faltou `tenant_id`" a "ninguém consegue logar".

**Claim final**: só `tenant_id` (uuid da loja, como texto). Nada de `customer_id`, telefone, e-mail,
endereço — confirmado no teste ITEM8 que o conjunto de chaves da claim resultante nunca ganha nenhuma
dessas.

**Configuração realizada (SQL)**: função criada + grants (`REVOKE ALL FROM PUBLIC`,
`REVOKE EXECUTE FROM anon, authenticated`, `GRANT EXECUTE TO supabase_auth_admin`) — confirmados via
`information_schema.routine_privileges` em ambos os projetos. `supabase_auth_admin` já tinha `USAGE`
no schema `public` por padrão (herdado do grant a `PUBLIC` no schema, confirmado via
`has_schema_privilege`) — não precisou de grant adicional.

**JWT REAL — confirmação empírica, não só documentação** (login de verdade contra o projeto E2E
dedicado, conta fixture `e2e-cliente@teste.encanto.local`, nunca produção):
- Decodifiquei um `access_token` real emitido pelo GoTrue deste projeto: `session_id` **está presente**
  nas claims, formato UUID válido. Claims completas do token real (chaves): `aal, amr, app_metadata,
  aud, email, exp, iat, is_anonymous, iss, phone, role, session_id, sub, user_metadata`.
- Cruzei o `session_id` da claim contra `auth.sessions` no mesmo projeto — **linha real correspondente
  confirmada** (mesma sessão, não uma claim solta).
- Achado incidental registrado: minha primeira tentativa chamou `signOut()` logo após o login, e o
  `session_id` sumiu de `auth.sessions` — ou seja, `signOut()` (scope padrão) **revoga a sessão no
  servidor**, não só limpa o `localStorage`. Refeito sem `signOut()` pra manter a sessão viva pro resto
  da validação. Relevante para a Onda 4 (staleness / comportamento de logout).
- Chamei `activate_tenant(Encanto)` via **RPC autenticado real** (não simulado — `Authorization` header
  genuíno de uma sessão de verdade) contra o projeto E2E → sucesso. Linha certa confirmada em
  `active_tenant` via consulta direta.
- Chamei `refreshSession()` real → **`session_id` permanece idêntico** entre o token antigo e o novo
  (confirma que refresh não gira a sessão, só o token — suposição de desenho da Onda 1/2 agora
  confirmada empiricamente, não só assumida). `tenant_id` **ausente** no novo token — esperado, ver
  Limitações abaixo.

**Testado** (`scripts/auth-tenant-onda3-hook-test.mjs`, novo, 11 verificações, `BEGIN...ROLLBACK` em
produção, fixtures reais — 2 sessões reais e simultâneas da mesma pessoa — e sintéticas — loja
inativa):
1. Tenant ativo (Encanto) → `claims.tenant_id` correto.
2. Sessão sem nenhuma linha em `active_tenant` → `tenant_id` ausente.
3. Claims sem `session_id` → `tenant_id` ausente, sem erro.
4. `active_tenant` aponta pra loja **inativa** → `tenant_id` ausente mesmo assim (fail-closed
   reconfirmado a cada emissão, não só na ativação).
5. Evento malformado (`{}`) → não explode.
6. **Duas sessões reais e simultâneas da mesma pessoa** → sessão A vira `tenant_id=Encanto`, sessão B
   vira `tenant_id=Bar`, nenhuma disputa — mesma prova de concorrência da Onda 2, agora também na
   camada do Hook.
7. **Segurança contra manipulação**: claims de entrada com `tenant_id`/`customer_id`/`store_id`
   forjados (simulando um evento adulterado) são **completamente ignorados** — o resultado vem só de
   `active_tenant`, nunca do que já vinha nas claims de entrada.
8. PII: conjunto de chaves resultante nunca inclui `customer_id`/telefone/e-mail/endereço/nome.
9. Grants finais: só `supabase_auth_admin`/`postgres`/`service_role`.
10. `SECURITY DEFINER=true`, `search_path` fixo.
Regressão do próprio script: zero resíduo (`active_tenant`/loja sintética confirmados removidos após
`ROLLBACK`).

**Regressão geral**: `test:domain` verde. `build`/`build:admin` verdes. `test:db-guards` (cadeia `&&`)
continua parando no mesmo FAIL pré-existente de sempre (`addresses.store_id` histórico); as 2 suites
novas desta REF (Onda 2 e Onda 3) foram confirmadas isoladas, verdes.

**Diff**: `migrations/REF-AUTH-TENANT-01-onda3-custom-access-token-hook.sql` (+rollback),
`scripts/auth-tenant-onda3-hook-test.mjs` (novo), `package.json` (1 script novo), este doc. Nenhum
arquivo de frontend/Admin tocado. Nada além da função em si — `active_tenant`/`activate_tenant()`
também aplicadas ao projeto E2E (só lá, ainda não existiam), reaproveitando exatamente as migrations
já testadas nas Ondas 1/2.

**LIMITAÇÃO ENCONTRADA (histórico desta onda, já resolvida)**: a função existia e sua lógica estava
100% provada (isolada e com dados reais), mas o Supabase não chamava — o Auth Hook precisa ser ligado
explicitamente, configuração do projeto, não SQL. Management API testada de novo com o token salvo até
então — ainda 401/expirado, mesmo resultado da Onda 1 (não contornado). Sem alternativa via
SQL/config.toml (projeto não é CLI-linked). Reportei o bloqueio e o passo manual exato necessário:

1. Dashboard do projeto **E2E** (`bgzcrovskjbktdxkhemd`) → **Authentication → Hooks**.
2. Hook **"Custom Access Token"** → tipo **Postgres (SQL)**.
3. URI/função: `pg-functions://postgres/public/custom_access_token_hook`.
4. Salvar/ativar.

Os grants que a própria Supabase pede como pré-requisito (`GRANT EXECUTE ... TO supabase_auth_admin`,
`REVOKE ... FROM anon, authenticated`) **já estão aplicados** em ambos os projetos — não falta nada do
lado do banco.

**Desbloqueio (token de Management API novo, fornecido só pra esta finalidade)**: token armazenado
exclusivamente em `C:\Users\00thi\.encanto\supabase-management.env` (fora do repo, mecanismo já
existente pra essa credencial) — nunca em código/migration/arquivo versionado. Confirmado aceito
(HTTP 200, lista os 2 projetos). Configurado via Management API **somente no projeto E2E**
(`bgzcrovskjbktdxkhemd`) — `PATCH /v1/projects/{ref}/config/auth` com
`hook_custom_access_token_enabled=true` e
`hook_custom_access_token_uri=pg-functions://postgres/public/custom_access_token_hook`. Confirmado via
GET fresco (não só o eco do PATCH) e, tão importante quanto, **confirmado que produção continua com o
Hook desligado** (`hook_custom_access_token_enabled=false`, `uri=null`) — não toquei produção nesta
etapa, exatamente como instruído.

**PROVA FINAL COMPLETA — pipeline real de ponta a ponta** (login real → `activate_tenant()` real →
`refreshSession()` real → Hook → JWT com `tenant_id`), contra o projeto E2E:
1. Login (antes de qualquer `activate_tenant` nesta sessão) → `tenant_id` **ausente** no token — correto,
   fail-closed.
2. `activate_tenant(Encanto)` via RPC autenticado real → sucesso.
3. `refreshSession()` real → **novo token contém `tenant_id` = id real da loja Encanto**, exatamente
   como devia. `session_id` preservado (mesma sessão, só o token renovado).
4. Conjunto de chaves do token pós-refresh: `aal, amr, app_metadata, aud, email, exp, iat,
   is_anonymous, iss, phone, role, session_id, sub, tenant_id, user_metadata` — só `tenant_id` foi
   adicionado, nenhuma PII a mais.

Verificação de higiene do token de Management API (pedida explicitamente): `git log --all -p` e
`git grep` no repo inteiro — **zero ocorrências** do token (novo ou do antigo, já expirado) em
qualquer commit ou arquivo rastreado. `.env.e2e` confirmado gitignored (`.gitignore:14` e
`.gitignore:22`); `supabase-management.env` nunca esteve dentro do repositório.

**Resultado**: Onda 3 **fechada** — função implementada, testada exaustivamente (isolada, com fixtures
reais, e agora também com prova end-to-end contra um JWT real emitido depois do Hook ligado no
projeto E2E). Produção continua com o Hook desligado de propósito — habilitar lá é uma decisão
separada, não tomada nesta onda. Não avancei pra Onda 4.

### Onda 4 — Integração de sessão / storefront

**Onde o storefront já resolvia cada peça (mapeamento, sem refatorar nada disso)**:
`StorefrontProvider.jsx` resolve a loja por domínio (`get_store_by_domain(hostname)`) e expõe via
`useStorefrontStore()` — só UX/contexto, nunca autorização (igual antes). `AuthProvider.jsx` gerencia
sessão/`customer` do cliente (`dbCliente`, cliente Supabase dedicado, isolado do `db` do Admin por
`storageKey` próprio). Composição em `App.jsx`: `<StorefrontProvider><AuthProvider>` — `AuthProvider`
já vive DENTRO do contexto da loja resolvida, então pode consumir `useStorefrontStore()` sem precisar
mudar a árvore.

**Implementado** (arquivos):
- `src/utils/jwt.js` (novo) — `decodeJwtPayload(token)`, decodifica o payload sem verificar assinatura
  (a verificação real é do Postgres/PostgREST no servidor; aqui só lemos `tenant_id` já assinado pra
  decidir se precisa agir).
- `src/services/tenantSync.js` (novo) — `precisaAtivarTenant()` (decisão pura: token sem
  `tenant_id`/com tenant errado/loja não resolvida ou inativa) + `syncTenant()` (efeito: chama
  `activate_tenant` só se precisar, `refreshSession()` só se a ativação teve sucesso). Recebe
  `dbCliente` por parâmetro — puro, sem importar React, testável sem rede e reaproveitado
  IDENTICAMENTE pelo hook do provider e pelo script de prova real (o que é testado é o que roda).
- `src/services/AuthService.js` — novo método `syncTenant(accessToken, storeId, storeStatus)`,
  delega pro módulo acima passando `dbCliente`.
- `src/providers/AuthProvider.jsx` — `useStorefrontStore()` + novo `useEffect` (separado do efeito de
  sessão existente, não mexe nele) que chama `AuthService.syncTenant(...)` quando há sessão E loja
  resolvida. Guarda dupla contra loop: (1) `precisaAtivarTenant` já não faz nada quando o claim já
  bate — o próprio `refreshSession()` dispara `onAuthStateChange` de novo, o efeito roda de novo, dessa
  vez vê "já bate" e para — converge sozinho, nunca looping; (2) `useRef` cobre a janela assíncrona
  entre disparos concorrentes do mesmo efeito.
- `tests/address.render.mjs` — único teste que renderizava `<AuthProvider>` sozinho (sem
  `StorefrontProvider` por fora); `useStorefrontStore()` lançaria fora desse contexto. `withAuth`
  passou a envolver com `<StorefrontProvider>` também — `renderToStaticMarkup` nunca roda efeitos
  (mesmo raciocínio já usado pro próprio `AuthProvider`), então isso não dispara rede nem muda os
  goldens byte-a-byte (reconfirmado rodando o teste).

**Fluxo antes/depois**:
- Antes: login → `carregarCustomer` → fim. JWT nunca ganhava `tenant_id`.
- Depois: login → `carregarCustomer` (inalterado) **e**, em paralelo, quando sessão+loja resolvida →
  `syncTenant` decide se precisa ativar → `activate_tenant()` (Onda 2) → `refreshSession()` → Hook
  (Onda 3) assina `tenant_id` → `onAuthStateChange` atualiza a sessão → efeito reavalia, já bate, para.

**Convidado**: `session?.access_token` ausente → o efeito nem chama `AuthService.syncTenant` — zero
requisição, checkout continua exatamente como sempre (não tocado, coberto pelos goldens de checkout já
existentes, todos verdes sem alteração).

**Admin/Super Admin/addresses**: nada tocado — `is_admin_of`, RLS de `addresses`,
`link_customer_to_auth`, checkout, autocomplete — zero arquivo desses domínios no diff desta onda.

**Testado**:
1. `tests/tenantSync.golden.mjs` (novo, 14 verificações, zero rede, `dbCliente` mockado): convidado
   sem token → zero chamada; loja não resolvida/inativa → zero chamada; claim já correto → zero chamada
   (base da convergência sem loop); precisa ativar → chama `activate_tenant` com `p_store_id` certo e
   depois `refreshSession`; troca de loja → reativa pra loja certa; `activate_tenant` falha →
   `refreshSession` NUNCA é chamado; `refreshSession` falha → erro devolvido, nunca lança exceção;
   `dbCliente` nulo → não lança.
2. `scripts/auth-tenant-onda4-e2e-real-test.mjs` (novo, **24 verificações, TODAS contra o projeto E2E
   real, importando os módulos de verdade do frontend** — não uma reimplementação paralela): login
   real sem `tenant_id` (seguro) → `syncTenant(Encanto)` real → JWT real com `tenant_id=Encanto` →
   refresh com o mesmo tenant é idempotente (zero chamada de RPC extra, espiado de verdade) → troca
   real Encanto→Bar (JWT muda, `session_id` preservado) → troca de volta Bar→Encanto → loja inexistente
   nega sem crash e sem alterar o tenant vigente → loja inativa é barrada antes mesmo de chamar a RPC
   (`storeStatus!=='ativo'`) → **duas sessões reais e simultâneas da mesma pessoa** (login duas vezes)
   cada uma com seu próprio tenant, sem disputa, `session_id` diferentes → logout/login: linha em
   `active_tenant` da sessão antiga **some por CASCADE** (confirmado com dado real, não só
   estruturalmente como na Onda 3), sessão nova nasce sem `tenant_id` (nada herdado), ativa
   corretamente de novo.
3. Fixtures novas do E2E, documentadas como código reproduzível em `scripts/e2e-tenant-fixture-stores.mjs`
   (idempotente, mesmo padrão de `scripts/e2e-fixture-accounts.mjs`): loja "Bar da Sogra (fixture E2E)"
   (ativa) e "Loja Inativa (fixture E2E)" (suspensa), ambas com `customers` vinculando o MESMO
   `auth_user_id` do cliente fixture — replica o cenário real "1 pessoa, 2 lojas legítimas" e isola
   "loja inativa" como único motivo de negação num dos testes.

**Regressão**: `test:domain` verde (inclui as 2 suites novas). `build`/`build:admin` verdes.
`test:db-guards` (produção) continua parando no mesmo FAIL pré-existente de sempre
(`addresses.store_id`); Ondas 2 e 3 desta REF reconfirmadas isoladas, ainda verdes (24/24 e 11/11,
sem regressão causada por esta onda).

**Diff**: `src/utils/jwt.js`, `src/services/tenantSync.js` (novos); `src/services/AuthService.js`,
`src/providers/AuthProvider.jsx`, `tests/address.render.mjs` (modificados);
`tests/tenantSync.golden.mjs`, `scripts/auth-tenant-onda4-e2e-real-test.mjs`,
`scripts/e2e-tenant-fixture-stores.mjs` (novos); `package.json` (3 scripts novos). **Achado**: havia
2 arquivos de OUTRO ator (`migrations/REF-SEC-DATA-01-harden-critical*.sql`,
`scripts/sec-data-01-harden-critical-test.mjs`) presentes no working tree no momento do commit —
NÃO tocados, NÃO adicionados, `git add` explícito só dos arquivos desta onda (mesma disciplina de
sempre).

**Riscos/limitações**: nenhuma migration de banco nesta onda (zero DDL em produção — só código
frontend + fixtures de teste no projeto E2E). `syncTenant` roda em paralelo a `carregarCustomer`, sem
bloquear a UI — se falhar (usuário sem vínculo com a loja do domínio atual), a sessão simplesmente
segue sem `tenant_id` para sempre até algo mudar de verdade (login/logout, domínio) — comportamento
correto e intencional (nenhuma RLS depende disso ainda, ver Onda 5). `precisaAtivarTenant` reavalia a
cada nova referência de token — em auto-refresh de rotina (sem troca de loja) o Hook reconfirma o
mesmo `tenant_id`, então o claim já bate e nenhuma chamada extra de `activate_tenant` acontece
(confirmado no ITEM8 do script real). Não testei via browser/Playwright de verdade (duas abas reais,
clique em UI) — a prova usa 2 conexões `supabase-js` diretas simulando 2 abas (2 sessões reais e
simultâneas), que é o que efetivamente importa (mesmo mecanismo, sem depender de driver de browser).

**Resultado**: Onda 4 fechada. Nenhuma RLS/RPC downstream ainda lê `tenant_id` (isso é Onda 5). Não
avancei pra Onda 5. Hook de produção continua desligado.

### Onda 5 — RLS/RPC de `addresses` usando o claim `tenant_id`

**⚠️ Só aplicada no projeto E2E. NÃO aplicada em produção** — produção ainda tem o Hook desligado
(Onda 3); se esta migration fosse aplicada lá agora, `auth.jwt()->>'tenant_id'` nunca existiria pra
ninguém e as 4 policies (que exigem `tenant_id IS NOT NULL`) bloqueariam todo acesso a `addresses`
pra todo mundo. Confirmado ao final desta onda que produção continua com as policies antigas
(`addresses_*_own`), grants e `save_structured_address` intactos.

#### Auditoria (antes de qualquer alteração)

Policies da SEC-01 (4, todas `customer_id IN (SELECT... auth_user_id=auth.uid())`, sem escopo de
loja nenhum): exatamente o gap que motivou toda a cadeia SEC-02→AUTH-TENANT-01. Grants:
`authenticated` DELETE/INSERT/SELECT/UPDATE, `anon` nenhum. RPCs que tocam `addresses`: só 2
(`admin_order_endereco`, já escopada por `is_admin_of`, não tocada; `save_structured_address`, alvo
desta onda). Nenhuma RPC de leitura existe — `AddressClienteService.recentes()` faz
`.from('addresses').select()` direto, dependendo só da RLS (permanece assim; a policy mais estrita
sozinha já resolve, sem precisar inventar uma RPC nova). FKs confirmadas: `addresses.customer_id →
customers.id` (nullable), `addresses.store_id → stores.id` (nullable, sempre NULL em toda escrita
nova até esta onda), `customers.store_id → stores.id` (NOT NULL).

**Achado crítico fora do escopo esperado, resolvido com autorização explícita**:
`src/address/repository/addressRepository.js` chamava `save_structured_address` usando `db` (cliente
do Admin) em vez de `dbCliente` (cliente da sessão do cliente) — `auth.uid()` dentro da RPC nunca
refletia o cliente logado de verdade, então a checagem de ownership falhava silenciosamente sempre e
todo endereço salvo pelo checkout virava órfão, logado ou não. Não abria brecha de segurança nova
(caía pro lado seguro), mas invalidava qualquer coisa que esta onda construísse em cima de
`auth.uid()`/`tenant_id` dentro da RPC. Corrigido: 1 linha de import (`dbCliente` em vez de `db`).

#### Policies — antes → depois

Antes (SEC-01, 4 policies `_own`): só `customer_id IN (SELECT... auth_user_id=auth.uid())`.

Depois (4 policies `_tenant`, mesma forma em SELECT/INSERT/UPDATE/DELETE):
```sql
(auth.jwt()->>'tenant_id') IS NOT NULL
AND store_id = (auth.jwt()->>'tenant_id')::uuid
AND customer_id IN (
  SELECT c.id FROM customers c
  WHERE c.auth_user_id = auth.uid() AND c.store_id = (auth.jwt()->>'tenant_id')::uuid
)
```
3 condições em conjunto: linha pertence ao tenant certo, dono (customer) pertence ao tenant certo,
sessão está no tenant certo. `store_id` do CLIENT nunca é confiado como autorização em nenhum lugar —
só comparado contra o claim assinado. UPDATE tem a mesma condição em USING **e** WITH CHECK (barra
mover um endereço pra outro tenant). `admin_order_endereco`/`is_admin_of` **não tocadas**.

#### `save_structured_address` — antes → depois

Antes: só validava ownership (`customer_id` pertence a `auth.uid()`), nunca gravava `store_id`.
Depois: deriva `store_id` do `customers.store_id` do customer JÁ validado (nunca de parâmetro) e,
quando há `tenant_id` no JWT, exige coerência extra (`customer.store_id = tenant_id`) — sessão da
Encanto não consegue vincular endereço ao customer da Bar, mesmo sendo a mesma pessoa nas duas. Sem
`tenant_id` (Hook desligado, caso de produção hoje), cai pro comportamento já correto de confiar no
`customers.store_id` do customer validado — **funciona hoje mesmo sem o Hook**, fica mais estrito
automaticamente quando o Hook for ligado, sem precisar de outra migration.

#### Testado

**`scripts/auth-tenant-onda5-addresses-rls-test.mjs`** (novo, 22 verificações, `BEGIN...ROLLBACK`
contra o E2E, fixtures reais + sintéticas): customer Encanto→Encanto ALLOW, customer
Encanto→Bar/Bar→Encanto DENY (mesma pessoa, tenant errado) em SELECT/UPDATE/DELETE/INSERT;
`customer_id`/`store_id` manipulados isoladamente (cada um sozinho já é suficiente pra DENY); UPDATE
tentando mover o próprio endereço pra outro tenant, DENY; token sem `tenant_id` nega tudo mesmo pra
dado legítimo; stranger sem nenhum customer nega mesmo com `tenant_id` válido; RPC direta com
`customer_id` cross-tenant vira órfã (não vincula errado); RPC com `customer_id` legítimo vincula E
deriva `store_id` certo; anon nega (`permission denied`); Admin/Super Admin confirmados não tocados.

**`scripts/auth-tenant-onda5-addresses-real-test.mjs`** (novo, 15 verificações, **ataque via API
real** — login genuíno, RPC real, leitura/escrita direta via REST com JWT de verdade, não simulação
SQL): RPC real cria endereço vinculado; SELECT direto via REST vê o próprio; troca real de tenant
(Encanto→Bar) faz o MESMO endereço sumir da visão via REST; UPDATE/DELETE diretos via REST
cross-tenant não afetam nenhuma linha; INSERT direto via REST com `store_id` manipulado é rejeitado
pela RLS; **duas sessões reais e simultâneas da mesma pessoa** (login duas vezes), cada uma só vê o
endereço do próprio tenant, nas duas direções; anon real via REST nega. Limpa os próprios dados no
final via `service_role` (zero resíduo).

**Achado de infraestrutura durante os testes (não relacionado a tenant_id)**: o `addresses` do
projeto E2E estava desatualizado — faltavam as colunas de geocoding estruturado (`estado`, `cep`,
`referencia`, `latitude`, `longitude`, `place_id`, `formatted_address`, `provider`, `confidence`) e a
migration SEC-01/HARDEN-ORDERS-RLS-step2 nunca tinha sido aplicada lá (`anon` ainda com grant total).
Corrigido com um catch-up cirúrgico (só as colunas + grants de `addresses`, sem tocar
`orders`/`customers`/`order_items` — que têm suas próprias migrations mais recentes no E2E que eu não
queria arriscar sobrescrever) — não é uma migration nova desta REF, é sincronizar o ambiente de teste
com o que produção já tinha antes desta onda começar.

#### Regressão

`test:domain` verde (inclui os guards de `addressRepository`/`address-multitenant` atualizados —
2 testes estruturais antigos travavam o comportamento ANTIGO/com bug como se fosse o esperado,
corrigidos pra travar o comportamento novo, mesmo padrão já visto em SEC-01). `build`/`build:admin`
verdes (1 segfault do `npm`/Node no meio do build do Admin, confirmado transiente — build já tinha
terminado com sucesso antes do crash, refeito e confirmado limpo). `test:db-guards` (produção):
mesmo FAIL pré-existente de sempre, contagem **idêntica** (`total=22 · store_id NULL=8`, zero
mudança — confirma que produção não foi tocada). Ondas 2/3/4 reconfirmadas sem regressão (24/24,
11/11, 24/24).

#### Diff

`migrations/REF-AUTH-TENANT-01-onda5-addresses-tenant-rls.sql` (+rollback);
`src/address/repository/addressRepository.js` (client fix); `tests/address.guard.mjs`,
`tests/address-multitenant.golden.mjs` (guards atualizados); `scripts/auth-tenant-onda5-addresses-rls-test.mjs`,
`scripts/auth-tenant-onda5-addresses-real-test.mjs` (novos); `package.json` (2 scripts novos, **não**
wireados em `test:db-guards` — são só-E2E, mesmo tratamento das Ondas 3/4). Catch-up de schema/grants
do `addresses` no E2E aplicado direto (não é migration desta REF, é sincronizar ambiente de teste).
**Achado**: outro ator commitou `REF-SEC-DATA-01` durante esta onda e deixou uma edição de
`package.json` (registro do `test:sec-data-01` + wiring em `test:db-guards`) não commitada na working
tree — isolei via patch cirúrgico aplicado só ao índice (`git apply --cached`), garantindo que meu
commit contém EXATAMENTE minhas 2 linhas, sem tocar nem reverter a deles (que continua pendente na
working tree, para eles commitarem separadamente).

#### Impacto Admin / Super Admin

Nenhum arquivo de Admin no diff. `is_admin_of`, `is_super_admin`, `admin_order_endereco` — nem lidas
para alteração, só confirmadas via `pg_proc.prosecdef` que continuam exatamente como estavam. Admin
nunca teve `tenant_id` e continua sem precisar dele (`is_admin_of(store_id)` já resolve o caso de uso
dele, decisão já tomada e documentada desde a auditoria original desta REF).

#### Riscos / Limitações

- **Loja desativada (defesa em profundidade)**: a policy RLS, por si só, **não** verifica
  `stores.status` — ela confia inteiramente em `tenant_id` só existir no JWT quando a loja estiver
  ativa, garantia que é do Hook (Onda 3, reconfirma a cada emissão), não da RLS. Testado (ITEM14)
  que, se hipoteticamente um `tenant_id` de loja inativa aparecesse numa claim, a RLS SOZINHA
  permitiria — a proteção real é o Hook nunca emitir esse claim, já comprovado empiricamente na
  Onda 3. Registrado com honestidade, não escondido: não é uma falha desta onda, é a mesma
  arquitetura de camadas já decidida (Hook = fonte de verdade do tenant, RLS = confia no que está
  assinado).
- Migration não aplicada em produção — depende de uma decisão futura e separada de ligar o Hook lá
  primeiro.
- `addresses.store_id` NULL em 8 linhas históricas continua fora de escopo
  (`REF-ADDRESS-STOREID-01`), não mexido.
- `REF-ADDRESS-UX-01`/`REF-ADDRESS-SEC-02` continuam não fechadas — dependem desta cadeia inteira
  fechar, incluindo eventualmente ligar o Hook em produção.

**Resultado**: Onda 5 fechada (no E2E). Produção segue sem a migration (Hook desligado lá). Não
avancei pra Onda 6.

---

### Onda 6 — `link_customer_to_auth` tenant-aware

#### Auditoria (antes de qualquer mudança)

`link_customer_to_auth(p_phone, p_email, p_name, p_store_id=default_store_id())` — SECURITY DEFINER,
`search_path` seguro, `auth.uid()` sempre server-side. `p_store_id` nunca era comparado contra nada —
só usado como filtro de busca/gravação, confiado cegamente (vindo do domínio resolvido no client via
`buildStorefrontRpcParam()`). `admin_link_customer_to_auth` correta, sem caller no frontend, fora do
escopo. `link_customer_to_auth_email` não existe (nem hoje nem no histórico de migrations).
`customers`: 7 colunas, `store_id`/`phone` NOT NULL, uniques compostas `(store_id, phone)` /
`(store_id, lower(email))` / `(store_id, auth_user_id)`. RLS: `"Admin all customers"`
(`is_admin_of(store_id)`) + `"Cliente le proprio customer"` (SELECT-only, `auth_user_id=auth.uid()`,
sem âncora de loja desde SAAS-01 Onda 6.1 — determinismo delegado à query do frontend, não tocado
nesta onda). Grants de tabela batem com o padrão RPC-only (sem policy de escrita pro cliente comum).
**Achado de mínimo privilégio**: `EXECUTE` de `link_customer_to_auth` estava concedido a `PUBLIC`/`anon`
além de `authenticated` (não explorável — nega antes de tocar em dado — mas fora do padrão das Ondas
2/3). Produção real: 2 lojas ativas de verdade (Encanto + Bar da Sogra, provisionada na Onda 8 do
SAAS-01), 18 customers reais, todos em Encanto, zero pessoa com customer em 2+ lojas — nenhum drift
legado a resolver. E2E: schema/RLS/RPC idênticos a produção; grants de tabela ainda amplos
(`anon` com CRUD completo em `customers`, mesmo drift já visto em `addresses` na Onda 5 — RLS
bloqueia de qualquer forma, não mexido nesta onda por não ter sido pedido).

**Tensão de desenho identificada e resolvida antes de implementar**: `e2e/support/fixture-customer.js`
(helper de setup do Playwright, usado em `minha-conta.spec.js`) chama `link_customer_to_auth` direto
por um client anon, sem nunca passar por `activate_tenant`/Hook — nunca terá `tenant_id`. Produção
também nunca tem `tenant_id` hoje (Hook desligado). Resolvido com degradação graciosa formalmente
aprovada pelo dono: `tenant_id` presente exige coerência com `p_store_id` (proteção real, nova);
`tenant_id` ausente preserva o comportamento legado, byte a byte.

#### RPC — antes/depois

**Antes**: `v_store := p_store_id` usado sem nenhuma verificação.
**Depois**: adicionado logo após as validações de entrada —
```sql
v_tenant uuid := nullif(auth.jwt()->>'tenant_id', '')::uuid;
...
if v_tenant is not null and v_tenant <> v_store then
  return jsonb_build_object('ok', false, 'error', 'loja invalida');
end if;
```
Mesma mensagem genérica (`'loja invalida'`) do check de `p_store_id IS NULL` — não revela se a loja
alvo existe. Resto da função (lock advisory, casos a/b/c, guarda `requer_verificacao` da
REF-LOYALTY-01a, anti-takeover de telefone) **byte a byte idêntico** — nenhuma proteção existente foi
tocada.

#### Regra tenant presente / tenant ausente

- **Presente**: `p_store_id` precisa ser exatamente igual ao `tenant_id` do JWT, senão `DENY` — mesmo
  que a loja alvo exista de verdade, mesmo que o caller já possua customer legítimo lá (ITEM5: usar o
  telefone real do próprio customer da Bar enquanto o tenant é Encanto continua negado — a checagem
  acontece antes de qualquer lookup por telefone).
- **Ausente**: comportamento idêntico ao que já existia antes desta onda — `p_store_id` como seletor,
  `default_store_id()` como fallback quando omitido. Nenhum fallback novo foi criado (não escolhe por
  domínio, não escolhe primeiro tenant, não escolhe por customer existente) — só preserva o que já
  estava lá.

#### Anti-takeover

Preservado sem nenhuma alteração de código: telefone já vinculado a outro `auth.uid()` continua
negando (`'telefone ja vinculado a outra conta'`), com ou sem `tenant_id` presente (ITEM6/ITEM8).
Guarda `requer_verificacao` da REF-LOYALTY-01a (convidado com histórico de pedidos/selos) continua
intacta com `tenant_id` presente (ITEM9).

#### Múltiplos tenants

Mesma pessoa com customer legítimo em Encanto e Bar da Sogra: sessão com `tenant_id=Encanto` só opera
o customer de Encanto (ITEM1/2/5); sessão com `tenant_id=Bar` só opera o customer da Bar (ITEM3/4) —
inclusive com **duas sessões reais e simultâneas** da mesma pessoa (login duplo de verdade), cada uma
respeitando só o próprio tenant, provado via API direta (não simulação).

#### Grants

`REVOKE EXECUTE ... FROM PUBLIC, anon` + reafirmação explícita `GRANT ... TO authenticated`. Confirmado
ao vivo no E2E pós-migration: `EXECUTE` restrito a `authenticated`/`postgres`/`service_role`. Chamada
real por `anon` sem sessão recebe `permission denied for function link_customer_to_auth` (provado via
API real, não só leitura de catálogo).

#### Testes — E2E (SQL simulado)

`scripts/auth-tenant-onda6-link-customer-rls-test.mjs` — **15/15**. `BEGIN...ROLLBACK`,
`SET LOCAL ROLE`/`request.jwt.claims`, fixtures reais do E2E (`USER_DUAL` com customer legítimo em
Encanto/Bar da Sogra E2E, dos fixtures da Onda 4) + 2 fixtures de admin do E2E reaproveitados como
"pessoa distinta"/"pessoa nova" (só existem 3 `auth.users` reais no projeto E2E, e a RPC grava
`customers.auth_user_id` com FK real — diferente dos testes de RLS pura de `addresses`/`activate_tenant`
que só liam `auth.uid()`, aqui precisa de usuário real de verdade). Cobre: tenant×store
ALLOW/DENY nas 2 direções (Encanto↔Bar), posse legítima do telefone real não atravessa tenant errado,
anti-takeover com e sem tenant, `requer_verificacao` com tenant presente, criação de customer novo com
tenant presente, fallback sem tenant (explícito e por omissão de `p_store_id`), loja inativa
(defesa em profundidade documentada, mesmo padrão da Onda 5), grants, Admin/Super Admin intocados.

#### Testes — API real (ataque)

`scripts/auth-tenant-onda6-link-customer-real-test.mjs` — **13/13**. Login real, RPC real via
`supabase-js`, `activate_tenant`+Hook+`refreshSession` reais (mesmo módulo `tenantSync.js` da Onda 4).
Ataque via API direta manipulando `p_store_id` nas duas direções (Encanto→Bar, Bar→Encanto) —
rejeitado pela RPC nas duas. Duas sessões reais e simultâneas da mesma pessoa (login duplo de
verdade) operando em paralelo, cada uma no próprio tenant, com tentativa cruzada simultânea negada.
`anon` real sem login recebe erro ao chamar a RPC. Restaura o `phone` original dos 2 customers fixture
via `service_role` no final (captura o estado ANTES de qualquer chamada) — `name`/`email` nunca são
tocados pela suíte (sempre `null`, `coalesce` preserva o valor existente), zero resíduo.

#### Regressão

`test:domain` verde. `build`/`build:admin` verdes. `test:db-guards` (produção): mesmo FAIL
pré-existente de sempre (`addresses.store_id NULL`, contagem idêntica `total=22 · store_id NULL=8`).
**Achado, não causado por esta onda**: a cadeia do `test:db-guards` parou num FAIL novo em
`test:datetime-schema` (`DT5`, grants de `admin_orders_search` divergentes do baseline pinado) —
investigado e confirmado como resultado de uma migration de **outro ator**
(`migrations/REF-SEC-DATA-01-harden-r5-r6-r8.sql`, não commitada, presente na working tree) já aplicada
em produção por eles, fora desta sessão — nada a ver com `link_customer_to_auth`/Onda 6. Rodei o resto
da cadeia manualmente (script a script) pra não deixar isso mascarar uma regressão real: todos os 16
scripts restantes (`saas01-onda1` até `saas02-onda2`, incluindo `saas01-onda3-identidade-cliente` —
regressão direta da produção, que continua na versão ANTIGA de `link_customer_to_auth` — e
`auth-tenant-onda2`/`onda3`) **100% verdes**. Ondas 4/5 (E2E) reconfirmadas 24/24 e 22/22+15/15.

**Achado real, discutido e registrado (não corrigido nesta onda)**: rodei pela primeira vez a suíte
Playwright real (`e2e/tests/cliente/`) contra o E2E desde que os fixtures de Bar da Sogra/Loja Inativa
existem (criados na Onda 4 desta própria REF). `minha-conta.spec.js` falha de forma determinística
(8/8 execuções) — `AuthService.getMeuCustomer()` roda, na carga inicial da página, ANTES do domínio
resolver `storefrontId` (corrida genuína entre `StorefrontProvider` e `AuthProvider`, named
explicitamente no próprio código-fonte), cai no caminho SEM `.eq('store_id', ...)`, e
`customers WHERE auth_user_id=X LIMIT 1` sem `ORDER BY` devolve, hoje, a linha de "Loja Inativa" (não
a de Encanto) — confirmado direto no banco. Bug pré-existente da **SAAS-01 Onda 6.1** (que removeu a
âncora de `store_id` da RLS e documentou explicitamente esse risco: "sem isso, a query ficaria
ambígua"), só se torna **observável** porque a Onda 4 desta REF acrescentou customers reais em mais de
uma loja para o mesmo `auth_user_id` fixture — antes disso, `LIMIT 1` sem filtro trivialmente
devolvia a única linha existente. `fidelidade.spec.js`/`meus-pedidos.spec.js` (mesma pasta,
mesmo fixture) passam normais — o problema é isolado à leitura de `customer.name`/`.phone` em
`MinhaContaScreen`. **Zero impacto em produção hoje**: confirmado que nenhum customer real tem 2+
lojas lá, então o `LIMIT 1` sem filtro sempre devolve a única linha possível, correta por
consequência. Fora do escopo autorizado desta onda (dono foi explícito: "GETMEUCUSTOMER: NÃO alterar
nesta Onda... fica registrado como follow-up separado") — não alterei `AuthService.js`/
`AuthProvider.jsx`. Registrado aqui com o maior detalhe possível para decisão do dono.

#### Migration / Rollback

`migrations/REF-AUTH-TENANT-01-onda6-link-customer-tenant.sql` (+rollback) — `CREATE OR REPLACE` da
função (sem `DROP` — mesma assinatura de sempre, não é overload) + `REVOKE`/`GRANT` de `EXECUTE`.
**Zero `UPDATE`/`INSERT`/`DELETE` de dados** — confirmado por leitura antes de aplicar, conforme
pedido. Aplicada **somente no E2E** (`node run-e2e.mjs --file ...`), confirmada via
`information_schema.routine_privileges` ao vivo. **Produção não tocada** — nenhum comando de escrita
foi executado contra `db.env` (produção) nesta onda, só leituras (`SELECT`) para a auditoria e as
reconfirmações de regressão. Rollback restaura a função antiga (sem checagem de tenant) e os 3 grants
originais (`PUBLIC`, `anon`, `authenticated`).

#### Diff

`migrations/REF-AUTH-TENANT-01-onda6-link-customer-tenant.sql` (+rollback, novos);
`scripts/auth-tenant-onda6-link-customer-rls-test.mjs`,
`scripts/auth-tenant-onda6-link-customer-real-test.mjs` (novos); `package.json` (2 scripts novos,
**não** wireados em `test:db-guards` — só-E2E, mesmo tratamento das Ondas 3/4/5). Nenhum arquivo de
outro REF/ator incluído (`REF-SEC-DATA-01`, `REF-WHATSAPP-01`, `loadtest-e2e.mjs` etc. deliberadamente
deixados de fora do `git add`, presentes na working tree mas não meus).

#### Impacto Admin / Super Admin

Nenhum arquivo de Admin no diff. `admin_link_customer_to_auth`/`is_admin_of`/`is_super_admin`
confirmados via `pg_proc.prosecdef` inalterados — continuam `SECURITY DEFINER`, nada tocado.

#### Riscos / Limitações

- Migration não aplicada em produção — depende da decisão futura e separada de ligar o Hook lá
  primeiro (mesmo racional da Onda 5).
- Degradação graciosa é **temporária por desenho**: enquanto o Hook estiver desligado em produção, a
  proteção nova (tenant×store) não protege ninguém lá — só passa a valer depois do cutover do Hook,
  quando as sessões de produção passarem a carregar `tenant_id` de verdade.
- Loja inativa: a RPC, isoladamente, não reconfirma `stores.status` (mesma limitação de camada já
  documentada na Onda 5 para a RLS de `addresses`) — a proteção real é o Hook nunca emitir esse claim
  pra loja inativa, já comprovado na Onda 3.
- **Achado novo, fora de escopo**: `getMeuCustomer()`/`"Cliente le proprio customer"` (SAAS-01 Onda
  6.1) tem uma corrida de carregamento que hoje escolhe a loja errada no E2E multi-loja (ver
  Regressão acima) — dormente em produção (zero customer real com 2+ lojas hoje), mas bloqueia
  `minha-conta.spec.js` no E2E até ser corrigido numa onda própria.
- `addresses.store_id` NULL em 8 linhas históricas continua fora de escopo (`REF-ADDRESS-STOREID-01`).

**Resultado**: Onda 6 fechada (no E2E). Produção segue sem a migration (Hook desligado lá). Não
avancei pra Onda 7.

---

### REF-AUTH-TENANT-01-FIX-GET-MEUCUSTOMER — correção isolada, fora da numeração de ondas

Autorizada separadamente, entre a Onda 6 e a Onda 7, especificamente pro achado da regressão da Onda 6
(`minha-conta.spec.js` falhando 8/8 no E2E). Zero mudança em RLS/RPC/tenant/Admin/Super Admin/migration
— 100% frontend, 100% no call-site de `getMeuCustomer`.

#### Causa raiz confirmada

`getMeuCustomer(userId)` é chamado por `AuthProvider.carregarCustomer` a partir do efeito de MOUNT, via
`AuthService.getSession()` — leitura local/rápida (inclusive com sessão pré-injetada via `storageState`,
caso do E2E Playwright). Esse efeito roda ANTES do `StorefrontProvider` resolver a loja por domínio
(`get_store_by_domain`, RPC de rede, deliberadamente não-bloqueante desde a REF-PERF-01). Confirmado
direto no banco: `SELECT ... FROM customers WHERE auth_user_id=X LIMIT 1` sem `ORDER BY` devolve hoje a
linha de "Loja Inativa" em vez da de Encanto para o fixture com customer em 3 lojas. O efeito de mount
que dispara essa 1ª carga só depende de `[carregarCustomer]` (estável) — nunca re-executa quando
`store.store_id` resolve depois, então o estado errado nunca era corrigido.

Achado durante os testes (2 camadas adicionais do MESMO problema, não visíveis só pela auditoria):
1. `MinhaContaScreen.jsx` tinha um guard local (`setNome(n => n ? n : mc.nomeInicial)`) que só
   preenchia o campo se ele ainda estivesse VAZIO — uma vez que o valor errado chegava (não-vazio),
   nenhuma correção posterior do `customer` do contexto conseguia mais sobrescrevê-lo.
2. Ao introduzir uma 2ª carga (disparada quando a loja resolve), passou a existir mais de uma chamada
   de `carregarCustomer` em voo ao mesmo tempo — sem guarda, a resposta de rede de uma chamada MAIS
   ANTIGA (o fetch ambíguo do mount) podia chegar DEPOIS de uma chamada MAIS NOVA (ex.: o reload
   explícito que já existia em `atualizarPerfil`, logo após salvar o perfil) e sobrescrever dado fresco
   com dado obsoleto — só apareceu sob timing apertado de teste automatizado, não em uso humano normal.

#### Solução escolhida (3 mudanças, todas em `AuthProvider.jsx`/`MinhaContaScreen.jsx`)

1. **`AuthProvider.jsx`** — novo `useEffect` (mesmo padrão já aprovado do tenant-sync da Onda 4),
   disparado por `[store?.store_id, session?.user?.id, carregarCustomer]`: quando a loja resolve (e há
   sessão), recarrega o customer — agora com o filtro certo (`getMeuCustomer` já aplicava
   `.eq('store_id', ...)` quando o singleton está preenchido; o bug era só de TIMING, não de query).
   `session?.user?.id` (não a sessão inteira, mesmo cuidado do efeito de tenant-sync) evita refirar em
   cada refresh de token.
2. **`AuthProvider.jsx`** — guarda de sequência em `carregarCustomer` (`cargaCustomerSeqRef`): cada
   chamada recebe um número; só a chamada MAIS RECENTE tem permissão de aplicar seu resultado via
   `setCustomer`. Resolve a corrida entre múltiplas cargas em voo (mount, correção de loja, reload
   explícito pós-salvar) sem precisar de `AbortController` (a API do Supabase não aceita `signal`).
3. **`MinhaContaScreen.jsx`** — sincronização do estado local (`nome`/`telefone`) trocou de "só se o
   campo ainda estiver vazio" para "sempre que `customer?.id` mudar" (via `useRef` com sentinela
   `Symbol`). Resincroniza quando a IDENTIDADE do customer muda (login/logout/correção de loja); nunca
   sobrescreve edição em andamento do usuário quando é o MESMO customer recarregado (mesmo id).

Por que não "esperar a loja resolver antes de carregar o customer": a 1ª carga imediata (mesmo
potencialmente ambígua) é o que mantém o boot não-bloqueante pra maioria dos casos reais — produção
hoje só tem 1 loja real com customers (Encanto), então essa 1ª carga já é sempre correta lá; o efeito
novo só entra em jogo pra corrigir o caso multi-loja, sem custo extra de rede pro caso comum.

#### Por que não há race condition remanescente

A guarda de sequência garante que, entre N chamadas de `carregarCustomer` em qualquer ordem de
resolução de rede, só o resultado da chamada iniciada por ÚLTIMO é aplicado — as demais são
descartadas silenciosamente. Como toda ação que dispara uma nova carga (loja resolvendo, login,
salvar perfil) sempre acontece estritamente DEPOIS da anterior ter sido *iniciada*, o resultado final
sempre reflete a intenção mais recente, independente de qual resposta de rede chega primeiro.

#### Comportamento multi-tenant

Sessão na Encanto → só o customer de Encanto (`getMeuCustomer` já filtra por `store_id` quando
resolvido). Sessão na Bar da Sogra → só o customer da Bar. Mesma pessoa, lojas diferentes, cada
resolução de domínio traz o customer certo — provado em navegador real (ver Testes).

#### Testes

**Antes** (código anterior a esta correção, confirmado via `git stash` contra o MESMO ambiente):
`minha-conta.spec.js` falha deterministicamente 8/8.

**Depois**:
- `minha-conta.spec.js` (3 testes) — verde, reconfirmado em 3 execuções seguidas (9/9), incluindo o
  teste de edição (prova que a guarda de sequência não quebra o fluxo de salvar).
- `e2e/tests/cliente/minha-conta-multi-loja.spec.js` (novo, 3 testes) — loja resolvida = Bar da Sogra
  mostra o customer da Bar (nunca o de Encanto/Inativa); loja resolvida = Encanto mostra o customer da
  Encanto; duas sessões reais e simultâneas (mesma pessoa, mesma loja) sem contaminação cruzada.
  Reconfirmado em 3 execuções seguidas (9/9). Usa `page.route()` só pra mockar a resposta de
  `get_store_by_domain` — exceção justificada e documentada no próprio arquivo: este ambiente de E2E só
  tem 1 hostname real configurado (Encanto), não há como navegar de verdade pra um domínio que resolva
  pra Bar da Sogra/Loja Inativa sem provisionar hosting adicional; login, RPC de `getMeuCustomer` e RLS
  continuam 100% reais.
- Regressão ampla: `e2e/tests/auth` + `cliente` + `store` + `cart` (50 testes) — **100% verde** quando
  rodados juntos. `e2e/tests/checkout/checkout-logado.spec.js` — 1 falha (timeout esperando a tela de
  sucesso após finalizar pedido) que **já existia antes desta correção**: confirmado rodando o MESMO
  teste com `git stash` dos 2 arquivos desta correção (código idêntico ao commit da Onda 6) — falha
  idêntica. Root cause aparente: lentidão do `create_order` (botão fica "Enviando…" além do timeout de
  5s da asserção), sem relação com `getMeuCustomer`. Quando essa suíte de checkout roda JUNTO com as
  outras no mesmo worker, a falha dela (que não fecha o `context` por sair via exceção antes da linha
  `context.close()`) deixa uma requisição em voo que ocasionalmente atrapalha o teste seguinte
  (`minha-conta.spec.js` "editar") — confirmado isolando: sem a pasta `checkout`, as outras 50 (+ os
  10 de `cliente`, já contados) passam 100% de forma reprodutível. Fragilidade pré-existente da suíte
  de checkout, fora do escopo desta correção (não autorizada a mexer nela).
- `test:domain`, `build`, `build:admin`, `test:auth-lock` (guard estrutural do anti-deadlock do
  `onAuthStateChange`, região não tocada por esta correção) — todos verdes.
- "Minha Conta — loja inativa": **não aplicável via UI real** — `StoreApp.jsx` mostra a tela "Loja
  indisponível" e nunca renderiza a árvore normal (onde Minha Conta é aberta) quando
  `store.status !== 'ativo'`; o gate já acontece numa camada acima de onde este bug vive.

#### Regressão

Zero novo FAIL além do já investigado e confirmado pré-existente/não-relacionado (`checkout-logado`).

#### Commit

Arquivos: `src/providers/AuthProvider.jsx`, `src/components/conta/MinhaContaScreen.jsx`,
`e2e/tests/cliente/minha-conta-multi-loja.spec.js`. Nenhuma migration, nenhum arquivo de RLS/RPC/Admin/
Super Admin. `package.json` não precisou de mudança (specs Playwright são descobertos automaticamente
pela config, não listados individualmente).

#### Limitações

- A correção é reativa (corrige após a loja resolver), não preventiva — existe uma janela técnica
  (não observada nos testes, mas teoricamente possível sob rede muito lenta) onde o `customer` errado
  fica visível por um instante antes da correção. Aceitável: produção hoje tem 0 clientes reais com
  2+ lojas (o cenário nem existe ainda fora do E2E), e a guarda de sequência garante que o estado FINAL
  está sempre correto.
- `checkout-logado.spec.js` continua com a falha pré-existente (não corrigida, fora do escopo
  autorizado desta correção) — registrada, não escondida.
