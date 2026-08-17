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
