# REF-ADDRESS-SEC-02 — Isolamento customer × tenant

Auditoria read-only, 17 ago 2026. Zero alteração de banco/código nesta fase. Espelho do artifact
publicado na sessão. Trata o achado confirmado da auditoria de [[REF-ADDRESS-UX-01]]: mesmo
`auth_user_id`, com `customer` em Encanto e Bar da Sogra, conseguia ler o histórico de endereços das
duas lojas pela mesma sessão.

## Achado central (Fase 2)

Rastreada a cadeia hostname → loja resolvida → `p_store_id` → `customers.store_id`: **não existe hoje,
em nenhum ponto do backend, verificação server-side de "qual loja este usuário está realmente
acessando" no lado do storefront** (diferente do Admin, que tem `is_admin_of()` real via tabela
`admins`). `get_store_by_domain(p_hostname)` aceita qualquer texto do client sem checar o Host real;
`link_customer_to_auth` recebe `p_store_id` do client para decidir onde criar/atualizar o `customers`
— ou seja, até `customers.store_id` (que seria a âncora óbvia) nasce de um valor client-supplied.

Causa raiz: Supabase Auth aqui emite um token por PESSOA, não por (pessoa, loja) — não há claim de
loja no JWT. Por construção, nenhuma RLS policy baseada só em `auth.uid()` + dados de tabela consegue
distinguir "sessão desta pessoa na Encanto" de "sessão da mesma pessoa na Bar da Sogra".

## Proposta: RPC-only, zero grant direto (mesmo molde de `admin_order_endereco`)

Em vez de tentar consertar a policy de SELECT (não fecha sozinha, pela razão acima), a proposta migra
`addresses` para o padrão já usado com sucesso no Admin:

- **REVOKE** SELECT/INSERT/UPDATE/DELETE diretos de `authenticated` em `addresses` (nenhum é usado
  hoje — write já vai por `save_structured_address`, DEFINER, roda como `postgres`). RLS/policies da
  SEC-01 permanecem como defesa em profundidade.
- **Nova RPC `get_enderecos_recentes(p_store_id, p_limite)`** — SECURITY DEFINER, resolve
  `customer_id` via `auth_user_id=auth.uid() AND store_id=p_store_id` (nunca confia em `p_store_id`
  como autorização, só como seletor — mesmo princípio de `admin_order_endereco`).
- **`save_structured_address`** ganha 1 mudança: deriva `store_id` do `customer_id` já validado
  (nunca lê `store_id` do payload) — resolve o Fase 4 (novos endereços nascem com `store_id` correto)
  sem tocar em nenhuma linha histórica.
- **Frontend**: `AddressClienteService.recentes()` troca a query direta por `.rpc('get_enderecos_recentes', ...)`.

## O que NÃO se resolve (limite estrutural, registrado com honestidade)

Uma pessoa com contas legítimas em 2 lojas ainda pode, se souber o mecanismo, chamar a RPC pedindo o
`p_store_id` "errado" e ver o PRÓPRIO histórico da outra loja — nunca dado de outra pessoa (`auth.uid()`
é intransferível). Fechar isso por completo exigiria um claim de loja verificado no JWT (Auth Hook /
custom claims) — mudança de arquitetura de autenticação, fora do escopo desta REF, registrada como
follow-up.

Achado incidental não corrigido: `link_customer_to_auth` aceita `p_store_id` do client — é a raiz de
`customers.store_id` não ser verificado na origem. Fora do escopo (tocaria cadastro/login, não
`addresses`).

## SQL exato, rollback, 8 casos de teste

Detalhados no artifact publicado na sessão — nada aplicado, aguardando aprovação.
