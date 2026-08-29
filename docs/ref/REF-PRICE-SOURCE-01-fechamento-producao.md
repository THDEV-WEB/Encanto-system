# REF-PRICE-SOURCE-01 — Fechamento em produção

**Status: CONCLUÍDA — Ondas 1 e 2 ao vivo em produção (2026-08-29).**

## Sequência de deploy

1. Auditoria (só leitura) → achou que `create_order()` confiava em `price`/`preco_unitario`/`total`
   do client, sem reconciliação contra o banco.
2. Onda 1 → `create_order()` passa a resolver o preço de itens **com** `product_id` no servidor
   (produto simples, promoção, tamanhos, adicionais com franquia grátis). Commit local `faa0b61`.
3. Onda 2 → investigação provou (teste Playwright real) que item **sem** `product_id` ainda permitia
   um pedido real com preço do `mockCatalog.js`. Fechado: `product_id` passa a ser obrigatório em todo
   item, sem exceção. Commit local `79347a0`.
4. **Pré-check de produção**: descoberto que os commits não estavam publicados — aplicar as migrations
   antes do frontend (que envia `tamanho_label`) estar no ar cobraria clientes reais pelo preço do 1º
   tamanho em produtos com tamanho não-padrão. Publicado (`git push origin main`) primeiro; deploy do
   Vercel confirmado por **bundle ao vivo** (`assets/CheckoutPage-BFeYDac3.js` contém `tamanho_label` e
   o texto do gate de catálogo indisponível), não só pelo push em si. CI: 5/5 checks verdes (Testes de
   domínio, Lint+typecheck, Build, Lighthouse CI, E2E Playwright completo).
5. Migrations aplicadas em produção, na ordem: `REF-PRICE-SOURCE-01-onda1-server-side-pricing.sql`,
   depois `REF-PRICE-SOURCE-01-onda2-exige-product-id.sql`.
6. Validação pós-migration por leitura direta + testes funcionais em `BEGIN...ROLLBACK` (líquido zero
   confirmado por contagem antes/durante/depois em `orders`/`order_items`/`customers`/`loyalty_events`/
   `products`/`categories`/`adicionais`/`stores`).

## Evidência da validação em produção

- Preço autoritativo: item com `product_id` real (Açaí, tamanho 500ml) e `price` adulterado para
  R$1,00 → persistido com **R$26,90** (preço real do tamanho).
- Total autoritativo: `total` adulterado para R$0,01 → `orders.total` recalculado para **R$17,90**.
- Produto inexistente → rejeitado (`"produto invalido"`).
- Produto de outro tenant (Aquarios Bar) → rejeitado (mesma mensagem, anti-enumeração).
- Item sem `product_id` → rejeitado (`"item ... sem produto valido"`) — confirma que o vetor do
  `mockCatalog` está fechado também em produção, não só no E2E.
- Contagens antes = depois em todas as tabelas verificadas — nenhuma mutação líquida.

## Achado registrado durante a Fase 3 (não corrigido nesta ação — fora do escopo autorizado)

`_resolve_item_pricing()` (função interna, criada pela Onda 1) aparece com `EXECUTE` concedido a
`anon`/`authenticated` na ACL, apesar do `REVOKE ... FROM PUBLIC` da migration. Causa: o schema
`public` deste projeto tem `ALTER DEFAULT PRIVILEGES` configurado (visível em `pg_default_acl`) que
concede `EXECUTE` automaticamente a `anon`/`authenticated`/`service_role` em **toda função nova** —
`REVOKE FROM PUBLIC` não neutraliza um grant nomeado direto. Risco classificado **BAIXO**: a função é
só leitura/cálculo (sem `INSERT`/`UPDATE`/`DELETE`), devolve preço de um produto — dado já público via
o catálogo normal — e exige `store_id`+`product_id` válidos para retornar algo. Não há ganho financeiro
possível chamando-a diretamente (ela nunca cria pedido). Recomendação para uma futura ação pontual de
hardening: `REVOKE EXECUTE ON FUNCTION public._resolve_item_pricing(uuid,uuid,text,jsonb) FROM anon,
authenticated;` — não executado aqui por estar fora do escopo desta ação ("aplicar SOMENTE as
migrations").

## Estado do mockCatalog.js

Confirmado ao vivo em produção (não só em E2E): serve exclusivamente para navegação/fallback visual.
Nenhum item vindo dele (sem `product_id` real) consegue mais gerar um pedido financeiro.

## Regressão

Coberta por: CI completo do commit publicado (5/5 verde, incluindo suíte E2E Playwright inteira contra
o projeto dedicado), mais a validação funcional direta em produção acima (transacional, revertida).
Nenhum teste adicional destrutivo foi executado contra produção.

## Limitações que seguem fora de escopo (não resolvidas por esta REF)

- `delivery_fee`/`maquininha_fee` sem validação server-side (achado da auditoria original).
- Grant de `_resolve_item_pricing` a `anon`/`authenticated` (achado desta ação, ver acima).
- UX de aviso "preço mudou desde que você adicionou ao carrinho" — não implementada.
- `NUMERIC(10,2)` nas colunas monetárias sem escala fixa.
- `saas01-onda4-1-pedidos-test.mjs`/`harden-orders-rls-test.mjs` continuam falhando em produção por
  falta de simulação de `Origin` — dívida de `REF-ORDER-TENANT-01`, não desta REF.

## Fechamento

`REF-PRICE-SOURCE-01` está concluída em produção. O banco é, agora, a fonte de verdade autoritativa
do preço em todo o ciclo: Admin altera → banco persiste → storefront/carrinho apresentam → checkout
envia contexto (nunca preço) → `create_order()` recalcula do banco → `order_items`/`orders.total`
recebem o valor autoritativo → relatórios/fidelidade refletem o que foi de fato persistido.
