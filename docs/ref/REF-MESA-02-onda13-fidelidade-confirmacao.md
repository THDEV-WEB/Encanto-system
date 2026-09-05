# REF-MESA-02 — Onda 13: Fidelidade (Confirmação)

**Status: CONCLUÍDA — sem mudança de código de produção.** O plano mestre já previa esta onda como
"só testes de confirmação, nenhuma mudança de lógica esperada". Confirmado por leitura de código
ANTES de escrever qualquer teste: `loyalty_grant(p_customer_id, p_order_id)`
(`migrations/REF-LOYALTY-01-loyalty.sql:95`) é chamado dentro de `create_order()` de forma 100%
agnóstica a `tipo_pedido`/`origem_pedido`/`mesa_session_id`; `loyalty_void_on_cancel()` (trigger
`AFTER UPDATE OF status ON orders`) também é agnóstica. Nenhuma migration foi necessária.

## O que foi confirmado (com teste real, não só leitura de código)
- Um pedido de mesa (`admin_garcom`) concede exatamente 1 selo — mesmo comportamento de
  entrega/retirada.
- Uma sessão com 3 pedidos concede **3 selos** (1 por pedido, nunca 1 por sessão/conta) — prova
  que a fidelidade nunca olha para `mesa_session_id`.
- **Fechar a conta (Onda 11) não concede nem revoga selo nenhum por si só** — só os pedidos
  individuais geram evento de fidelidade, o fechamento é invisível para esse subsistema.
- Cancelar um pedido de mesa reverte exatamente 1 selo — mesmo trigger `cancel_trigger` de sempre.
- Cartela cheia (`stamps >= loyalty_required`) não acumula além, mesmo em pedido de mesa — nenhum
  evento `earned` é gravado para o pedido que excederia o limite.

## Testes
`scripts/mesa-02-onda13-fidelidade-confirmacao-test.mjs` (novo, 12/12).

## Regressão completa
lint (0 erros, 60 warnings pré-existentes), typecheck limpo. Backend: MESA-01 (60/60) +
interseção (10/10) + MESA-02 onda2-12 (135/135) + onda13 (12/12) + DELIVERY-FEE-05 (29/29) =
**246/246** checks de banco + `npm run test:domain` verde.

## Produção
Não tocada — nenhuma migration nesta onda (nenhum código de produção mudou, só um teste novo).
