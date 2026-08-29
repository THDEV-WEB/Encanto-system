# REF-PRICE-SOURCE-01 — Auditoria de fonte de verdade dos preços

**Status: AUDITORIA CONCLUÍDA (só leitura) — deu origem à Onda 1** (`REF-PRICE-SOURCE-01-onda1-preco-autoritativo.md`).

## Objetivo

Validar a premissa "banco = fonte de verdade dos preços; frontend/Admin só consultam e solicitam
alterações pelos mecanismos oficiais" — sem alterar código, banco, preços ou fazer deploy.

## O que foi confirmado como correto

- **Exibição** (vitrine, Admin, carrinho no momento da adição): banco único, sem hardcode em
  produção normal. `products.preco/preco_promo/tamanhos` é a única fonte; `adicionais` idem.
- Admin lê (`DataService.getAllProds`) e grava (`DataService.upsertProd`) direto em `products`; RLS
  (`is_admin_of(store_id)`) impõe que só o admin da própria loja edita. Confirmado por E2E real
  (`e2e/tests/admin/admin-produtos-crud.spec.js`) e por `tests/price-domain-01.smoke.mjs`.
- Multi-tenant: `products.store_id`/`adicionais.store_id` isolam por loja; sem achado de vazamento de
  preço cross-tenant (mecanismo já blindado por `REF-SAAS-01`/`REF-ORDER-TENANT-01`).

## Achado crítico — a origem da Onda 1

`create_order()` recebia `price`/`preco_unitario` de cada item **direto do client**, validando só
`price > 0`. Nenhuma reconciliação contra `products.preco/preco_promo/tamanhos[].preco`. Um client
podia enviar qualquer preço positivo para qualquer produto (ex.: via DevTools/curl, sem passar pela
UI) e o pedido era criado com esse valor — mesma classe de vulnerabilidade já fechada para `store_id`
(`REF-ORDER-TENANT-01`) e para `delivery_fee`/localização (`REF-DELIVERY-FEE-02`), nunca estendida a
preço de item. `orders.total` tinha o mesmo problema (vinha cru de `p_order->>'total'`, sem bater com
a soma dos itens).

## Achados secundários (registrados, endereçados ou não pela Onda 1 — ver documento da onda)

- `src/data/mockCatalog.js` (`MOCK_PRODS`) tem preços reais hardcoded e pode ficar visível/comprável
  em produção real em falha transitória de rede/resolução de loja, não só em ambiente offline de
  dev — sem aviso visível ao cliente.
- Carrinho "congela" o preço no momento da adição (localStorage, TTL 12h); checkout nunca relê o
  banco antes de montar o payload.
- Colunas monetárias (`products.preco/preco_promo`, `order_items.price/preco_unitario`,
  `orders.total/delivery_fee/maquininha_fee`) são `numeric` sem escala fixa declarada (só
  `adicionais.preco` é `numeric(10,2)`) — sem impacto observado, lacuna de schema.
- Admin não bloqueia preço negativo em produto simples (valida truthy, não `> 0`); sem `CHECK` no
  banco para `products.preco`.

## Relatório completo

O relatório de 11 seções (fonte de verdade / banco / frontend / fluxo cliente / fluxo Admin /
precisão monetária / produtos especiais / mock / multi-tenant / achados classificados / recomendação)
foi entregue na conversa que originou esta REF — este arquivo resume o essencial para quem só
precisa do contexto da correção aplicada na Onda 1.
