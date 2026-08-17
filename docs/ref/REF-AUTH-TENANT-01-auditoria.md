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

**LIMITAÇÃO CENTRAL — ação manual pendente, PARO aqui conforme pedido**: a função existe e sua lógica
está 100% provada (isolada e com dados reais), mas o Supabase **não vai chamá-la** até o Auth Hook ser
ligado explicitamente — isso é uma configuração do projeto (não SQL), e só existem 2 jeitos de fazer
isso: Dashboard, ou Management API. Testei a Management API de novo (mesmo token salvo) — **ainda
401/expirado**, mesmo resultado da Onda 1 (não contornei, mesma disciplina de sempre). Confirmei via
documentação oficial que não há alternativa via SQL/config.toml neste projeto (não é CLI-linked — sem
`supabase/config.toml` no repo). **Preciso que você habilite manualmente**, e recomendo fazer isso
primeiro **no projeto E2E** (não produção), pra eu completar a prova end-to-end (novo refresh → JWT
real com `tenant_id`) num ambiente sem nenhum risco, antes de sequer cogitar produção:

1. Dashboard do projeto **E2E** (`bgzcrovskjbktdxkhemd`) → **Authentication → Hooks**.
2. Hook **"Custom Access Token"** → tipo **Postgres (SQL)**.
3. URI/função: `pg-functions://postgres/public/custom_access_token_hook`.
4. Salvar/ativar.

Os grants que a própria Supabase pede como pré-requisito (`GRANT EXECUTE ... TO supabase_auth_admin`,
`REVOKE ... FROM anon, authenticated`) **já estão aplicados** em ambos os projetos — não falta nada do
lado do banco.

Depois de habilitado no E2E, retomo e completo: novo `refreshSession()` real → decodificar o JWT novo
→ confirmar `tenant_id` presente de verdade → testar troca de tenant com refresh de verdade → só então
considerar habilitar em produção (autorização própria, separada).

**Resultado**: Onda 3 **parcialmente fechada** — função implementada, testada exaustivamente (isolada
e com fixtures reais) e aplicada em ambos os projetos; a prova final (JWT real pós-Hook) está bloqueada
numa ação manual de Dashboard que só você pode fazer. Não avancei pra Onda 4.
