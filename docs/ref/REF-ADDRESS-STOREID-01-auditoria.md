# REF-ADDRESS-STOREID-01 — Drift de store_id em addresses

**Status: FECHADA — Parte A + Parte B, ao vivo em produção (2026-08-20).**

Nome reservado havia tempo em três auditorias diferentes (`REF-ADDRESS-SEC-01`,
`REF-ADDRESS-AUTOCOMPLETE-01`, `REF-AUTH-TENANT-01`) para o problema de `addresses.store_id IS NULL`
em linhas de checkout convidado (`customer_id` sempre NULL nesse caso) — nunca tinha sido aberta de
verdade até esta REF.

## Parte A — backfill histórico (produção)

8 linhas com `store_id NULL` identificadas, todas de checkout convidado, todas recentes
(15–17/08/2026, não drift antigo parado), todas 100% rastreáveis via
`orders.endereco_id → orders.store_id` — 8/8 = Encanto, zero ambiguidade. `UPDATE` único, escopado
por lista explícita de IDs + `store_id IS NULL`, confirmado antes/depois (22 endereços no total, 0 sem
`store_id` depois). Zero efeito em RLS — linhas com `customer_id NULL` já eram invisíveis antes E
depois (a policy exige `customer_id` correspondente, não só `store_id`). Operação de dado direto, sem
migration/commit.

## Parte B — gap estrutural do guest (produção)

### Achado

`save_structured_address()` nunca setava `store_id` quando `customer_id` ficava NULL — caminho
guest, ou o fallback silencioso que já existia quando a checagem de ownership/coerência de tenant do
`customer_id` falhava. Gap contínuo (todo novo endereço de convidado nascia órfão), não só histórico.

Investigação inicial cogitou derivar `addresses.store_id` de `orders.store_id` (via `endereco_id`),
mas essa fonte não era confiável — `create_order()` tinha o MESMO problema, ainda mais grave (escrita
cross-tenant completa, não só uma coluna). Isso abriu `REF-ORDER-TENANT-01` como frente própria, que
fechou esse achado maior primeiro e deixou `orders.store_id` genuinamente confiável.

### Solução

Reaproveita, sem alteração, a mesma técnica e a mesma função já validada e em produção pela
`REF-ORDER-TENANT-01`: `resolve_store_from_origin()`, que deriva a loja do header HTTP `Origin` real
da requisição (`current_setting('request.headers', true)`), nunca de um campo enviado pelo client —
`p_address` nunca carregou `store_id` e continua sem carregar.

`save_structured_address()` passa a chamar `resolve_store_from_origin()` sempre que `v_store_id` ainda
está NULL depois da tentativa de usar o `customer_id` (guest puro, ou o mesmo fallback de
ownership/tenant que já existia). Fail-closed: sem Origin reconhecido, a função lança exceção em vez
de gravar mais um endereço órfão. `addressRepository.salvar()` já trata qualquer erro do RPC como
falha silenciosa (retorna `null`) — o checkout nunca foi bloqueado por isso e continua não sendo
(`CheckoutPage.jsx`: `enderecoId` fica `null`, o pedido segue com o texto do endereço mesmo assim).

O caso autenticado com `customer_id` válido (ownership + coerência de tenant quando o JWT tem
`tenant_id`) continua 100% intocado — só o ramo que já ficava com `store_id NULL` passa a resolver via
Origin.

### Testes

**SQL simulado** (`BEGIN...ROLLBACK`, customer real de produção só para leitura do próprio
`store_id`, zero `UPDATE` nele) — 7/7 casos, rodado em E2E e novamente em produção antes do
fechamento: A) auth com `customer_id` próprio, tenant coerente → `store_id` do customer, `customer_id`
preservado; B) auth com `customer_id` próprio mas tenant do JWT divergente + Origin reconhecido →
cai pro guest, `store_id` do Origin, `customer_id` vira NULL; C/D) guest com Origin de cada loja →
`store_id` da loja certa, `customer_id` NULL; E) guest com Origin desconhecido → exceção; F) guest sem
Origin → exceção; G) auth com `customer_id` próprio e sem `tenant_id` no JWT (legado) → `store_id` do
customer, `customer_id` preservado.

**HTTP real** (não simulado) contra produção, via `curl`, replicando o fluxo real do frontend
(`anon key` + header `Origin` genuíno): endereço criado com `store_id` da Encanto quando o Origin era
da Encanto, `store_id` da Bar da Sogra quando o Origin era da Bar da Sogra, e rejeitado
(`"loja nao identificada"`) com um Origin desconhecido — prova ponta a ponta, sem simulação. Os 2
registros reais criados no teste foram removidos imediatamente após a confirmação.

**Regressão** — suíte Playwright completa (E2E, migration já aplicada): 120 passaram, as mesmas 4
falhas de sempre (`checkout-logado.spec.js`, `admin-empresa-identidade-visual.spec.js`,
`platform-console.spec.js` ×2), já documentadas como pré-existentes e não relacionadas desde a
`REF-ORDER-TENANT-01` — zero regressão nova. `test:domain` e os dois builds (`build`, `build:admin`)
verdes; nenhuma mudança de frontend nesta REF (100% DB/RLS/RPC).

### Produção

Pré-check (hash antes, grants, contagem de endereços/customers/orders) → migration aplicada →
introspecção pós-migration (hash novo, idêntico ao aplicado em E2E; grants inalterados) → matriz SQL
simulada 7/7 → smoke test HTTP real nas duas lojas (criado e imediatamente limpo) → integridade final
idêntica ao baseline (22 endereços/0 sem `store_id`/18 customers/102 orders). Nenhum deploy de
frontend necessário.

### Rollback

`REF-ADDRESS-STOREID-01-onda1-guest-origin-rollback.sql` — restaura `save_structured_address()` ao
estado exato de antes (guest/fallback volta a gravar `store_id NULL`).

## Relação com REF-ORDER-TENANT-01

Frentes distintas, históricos não misturados. `REF-ORDER-TENANT-01` proveu a técnica
(`resolve_store_from_origin()`) e a confiabilidade de `orders.store_id` que motivaram e viabilizaram
esta Parte B — reaproveitada aqui sem nenhuma alteração na função em si.

## Resultado

`addresses.store_id` deixa de nascer órfão em qualquer caminho — autenticado ou guest, histórico
(Parte A) ou estrutural (Parte B). **Onda 1 = VERDE, em produção.**
