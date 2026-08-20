# REF-ORDER-TENANT-01 — Integridade de pedido por tenant

**Status: FECHADA — Onda 1 VERDE, ao vivo em produção (2026-08-19).**

Nasceu de um achado durante a auditoria da Parte B de `REF-ADDRESS-STOREID-01`: ao investigar se
`orders.store_id` poderia ser uma fonte confiável para derivar `addresses.store_id` no checkout
convidado, descobriu-se que `create_order()` — a RPC que cria o próprio pedido — também confiava
cegamente em `p_store_id` vindo do client, sem nenhuma validação de tenant. Mesma classe de
vulnerabilidade já fechada em `link_customer_to_auth` (Onda 6 de `REF-AUTH-TENANT-01`), nunca
estendida para `create_order`.

## Achado (auditoria)

`p_store_id` sempre foi um parâmetro do client (`buildStorefrontRpcParam()`, alimentado por
`window.location.hostname` → `get_store_by_domain()` → singleton JS local) e `create_order()` usava
esse valor DIRETO em `customers`/`orders`/`order_items`, sem validação. Confirmado empiricamente via
`BEGIN...ROLLBACK` contra produção: sessão autenticada no tenant Encanto conseguia criar
pedido/customer/order_items reais atribuídos à Bar da Sogra só trocando o parâmetro — e vice-versa;
guest também, por qualquer caminho. Efeitos em cascata reais confirmados: `notification_outbox`
(fila de WhatsApp) e `order_events` herdam o `store_id` manipulado; `loyalty_grant()` também
(dormente em produção, `loyalty_enabled=false`). Classificado **CRÍTICO** — explorável por qualquer
sessão, inclusive anônima, com uma única chamada trocando um parâmetro.

## Solução — duas fontes de verdade

**Autenticado** (`auth.uid() IS NOT NULL`): reaproveita o mecanismo já existente e em produção desde
a Onda 6 de `REF-AUTH-TENANT-01` — `tenant_id` assinado no JWT (Hook + `activate_tenant`). Quando
presente, `p_store_id` precisa bater com ele, senão `DENY` (mensagem genérica `'loja invalida'`,
mesma da Onda 6, anti-enumeração). Quando ausente (tenant ainda não sincronizado), comportamento
legado preservado — não quebra nada, e não compromete a solução do guest (que nunca lê `p_store_id`).

**Guest** (`auth.uid() IS NULL`): `p_store_id` do client **nunca é usado**. O servidor deriva a loja
do header HTTP `Origin` real da requisição via `current_setting('request.headers', true)::json->>
'origin'` — GUC que o PostgREST preenche automaticamente a cada request (confirmado: mesmo padrão do
pacote comunitário `pg_headerkit` em projetos Supabase, sem Edge Function nem config especial).
Origin é cross-origin de verdade aqui (frontend em `*.valionsistemas.com.br`, API em `*.supabase.co`)
— o navegador sempre envia esse header, e nenhum JS da página consegue sobrescrevê-lo (forbidden
header name da própria spec Fetch). Sem Origin reconhecido → `DENY` fail-closed, nunca cai pro
default antigo (`default_store_id()`/Encanto).

`resolve_store_from_origin()` (nova função) reaproveita a mesma lógica de casamento de
domínio/subdomínio de `get_store_by_domain()` — sem o fallback pra `default_store_id()` no final
(fail-closed em vez de assumir Encanto). Também reconhece `{slug}.localhost` — reservado IETF
(RFC 6761), todo navegador só resolve pra loopback — existe só pra permitir testar em dev/E2E com a
mesma função byte a byte de produção (nunca versões divergentes entre ambientes, disciplina desta
REF inteira).

## Limitação residual, documentada sem esconder

Uma ferramenta HTTP não-navegador (curl/Postman) ainda pode forjar o header `Origin`. Não é
resolvida por esta migration — é uma propriedade inerente de qualquer mecanismo puramente
anônimo/sem sessão: não existe hoje um jeito de emitir/validar identidade pra guest (mesma conclusão
da auditoria de `REF-ADDRESS-STOREID-01` Parte B). A mitigação fecha 100% dos ataques via JS/browser
(o vetor real observado — qualquer código rodando na página, mesmo comprometido, não consegue
sobrescrever Origin) e exige forjar um header específico pra qualquer tentativa via ferramenta crua,
em vez de só trocar um campo de formulário/JSON.

## Testes

**SQL simulado** (`BEGIN...ROLLBACK`, 2 `auth_user_id` reais sem customer prévio como atores,
telefones sintéticos sem colisão) — 10/10 casos, rodado em E2E e novamente em produção antes do
fechamento: A) auth mesmo tenant → ALLOW; B/C) auth cross-tenant (as duas direções) → DENY; D) auth
outro tenant mesmo → ALLOW; E) auth sem tenant → legado preservado; F/G) guest Origin correto,
`p_store_id` forjado → ignora o forjado, cria na loja do Origin (nas duas direções); H) guest Origin
desconhecido → DENY; I) guest sem Origin → DENY; K) `p_store_id` inexistente → DENY por FK.

**HTTP real** (não simulado) contra E2E e depois produção, replicando o ataque original exato
(forjar `p_store_id`) com um `Origin` genuíno via `curl`: nas duas lojas, o pedido foi gravado
seguindo o Origin real, ignorando completamente o `p_store_id` forjado no corpo da requisição — prova
definitiva, ponta a ponta, sem simulação.

**Regressão ampla** — suíte Playwright completa (todas as pastas, não só checkout): achado real
durante a 1ª rodada — 27 testes falharam porque o ambiente de teste roda em `http://localhost:PORT`
(sem domínio real, então `resolve_store_from_origin()` corretamente nega) e porque
`e2e/support/fixture-order.js` chama `create_order` direto do Node (sem navegador, sem Origin
nenhum) para semear pedidos de outras suítes (Admin, Fidelidade). Duas correções de infraestrutura de
teste (nunca da lógica de segurança): `playwright.config.js` passou a usar
`http://encanto.localhost:PORT` como `BASE_URL` padrão (`*.localhost` resolve sozinho pro loopback,
sem hosts file) — dá ao navegador real de teste um Origin que a função reconhece; `supabaseAnon()`
(client Node compartilhado) ganhou um header `Origin` fixo e realista, já que nunca teria um de
verdade rodando fora de um navegador. Confirmado via A/B (rollback completo da migration + reversão
do `BASE_URL`) que as 27 falhas eram 100% causadas por essas duas lacunas de ambiente, nunca por bug
na lógica da migration. Resultado final: 120 passaram, só 4 falhas — `checkout-logado.spec.js` (já
documentada como pré-existente antes desta REF) e 3 specs de Admin/Platform Console
(`admin-empresa-identidade-visual.spec.js`, `platform-console.spec.js` ×2) confirmadas
**pré-existentes e não relacionadas** via A/B rigoroso (mesmas falhas, idênticas, com a migration
totalmente revertida e o `BASE_URL` original).

## Produção

Pré-check (hash antes, grants, dados) → migration aplicada → introspecção pós-migration (hash novo,
grants inalterados) → matriz SQL simulada 10/10 → **smoke test real via HTTP** nas duas lojas
(Encanto e Bar da Sogra, forjando `p_store_id` com um `Origin` genuíno de cada uma) confirmando em
dados reais de produção que o pedido segue o Origin, nunca o parâmetro forjado → limpeza imediata dos
2 pedidos de smoke test → integridade final confirmada (18 customers/102 orders/103 order_items,
idêntico ao baseline) → `test:domain` + `build`/`build:admin` verdes. Nenhum deploy de frontend
necessário (mudança é 100% DB/RLS/RPC + infraestrutura de teste, zero código de produção do
frontend tocado).

## Rollback

`REF-ORDER-TENANT-01-onda1-create-order-tenant-rollback.sql` — restaura `create_order()` byte a byte
(sem a validação de tenant/derivação por Origin) e remove `resolve_store_from_origin()`. Testado via
A/B durante a investigação de regressão (aplicado e revertido em E2E múltiplas vezes).

## Relação com REF-ADDRESS-STOREID-01

Achado original (`orders.store_id` não era fonte confiável) motivou esta REF separada — não
misturada com o histórico daquela. Com `create_order()` agora validando/derivando `store_id` de uma
fonte confiável (tenant_id assinado ou Origin real), `orders.store_id` passa a ser, de fato,
confiável — o que reabre a possibilidade técnica de reconsiderar a Parte B daquela REF (derivar
`addresses.store_id` do guest a partir do pedido vinculado), mas isso fica registrado aqui como
dependência/integração futura, não implementado nesta REF nem misturado ao histórico de
`REF-ADDRESS-STOREID-01`.

## Resultado

`create_order()` agora impede, nas duas direções e para autenticado e guest, que uma sessão de uma
loja grave pedido/customer/order_items em outra loja — comprovado com dados reais em produção, não
só simulação. **Onda 1 = VERDE, em produção.**
