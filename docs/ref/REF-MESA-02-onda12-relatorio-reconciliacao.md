# REF-MESA-02 — Onda 12: Relatório/Reconciliação (resolve R7)

**Status: CONCLUÍDA.** Resolve o achado R7 da auditoria (`docs/ref/REF-MESA-02-auditoria.md`,
seção 3, "BI — 2ª fonte de forma de pagamento"): o card "Forma de pagamento" do BI
(`admin_reports_summary::por_pagamento`) agrupava por `orders.payment_method` (por pedido) — certo
para entrega/retirada (1 pedido = 1 pagamento), mas **errado** para uma mesa com
`mesa_sessao_habilitada`, onde vários pedidos (bebida, prato, sobremesa) compartilham UM único
pagamento real, registrado só no fechamento (`mesa_sessions.payment_method`, Onda 11). O
`payment_method` de cada pedido individual de mesa é só um valor operacional escolhido no
lançamento (ex.: sempre "dinheiro" por padrão no formulário do garçom), não a forma real usada
para pagar a conta inteira.

## O que mudou
- **`admin_reports_summary`** (`CREATE OR REPLACE`, mesma assinatura/retorno — sem `DROP`
  necessário): `base` ganhou `LEFT JOIN mesa_sessions` (status + payment_method). `por_pagamento`
  agora usa, por pedido:
  - sem `mesa_session_id` → `orders.payment_method` (**idêntico** ao comportamento de sempre para
    entrega/retirada/mesa sem sessão — zero regressão).
  - `mesa_session_id` com sessão **fechada** → `mesa_sessions.payment_method` (a forma REAL, única,
    da conta inteira).
  - `mesa_session_id` com sessão ainda **aberta** → bucket dedicado `(conta em aberto)` — não
    adivinha, deixa visivelmente separado até a conta fechar.
- `AdminRelatorios.jsx`: rótulo amigável "🍽️ Conta em aberto (mesa)" para o novo bucket em
  `LABEL_PAGAMENTO` (mesmo padrão dos rótulos existentes).

## Prova formal de não-duplicação (item pendente da auditoria)
`total_receita` continua `SUM(orders.total)` — `valor_cobrado_snapshot` (`mesa_sessions`) **nunca**
é somado em lugar nenhum desta função (reforça o que a Onda 2/11 já documentaram). O teste desta
onda prova isso numericamente: abre sessão, cria 3 pedidos com `payment_method` DIFERENTES entre
si (dinheiro/pix/cartão de crédito, R$10 cada), fecha a conta com uma 4ª forma
(`cartao_debito`) — confirma que `total_receita = 30` exato (nunca 60, nunca duplica), e que
`por_pagamento` atribui os 3 pedidos inteiros a `cartao_debito` (a forma real do fechamento),
sem vazar nada para as 3 formas originais do lançamento.

## Testes
`scripts/mesa-02-onda12-relatorio-reconciliacao-test.mjs` (novo, 10/10): prova formal acima,
bucket `(conta em aberto)` para sessão ainda aberta (não aparece sob a forma do lançamento),
regressão de entrega/retirada (continuam agrupadas por `orders.payment_method` exatamente como
antes).

Migration + rollback testados de verdade (aplicado → suíte pré-existente
`mesa-01-onda6-admin-reports-test.mjs` revalidada 5/5 → rollback aplicado → marcador da lógica nova
confirmado ausente via `pg_proc.prosrc` → reaplicado → marcador confirmado presente de novo).

## Regressão completa
lint (0 erros, 60 warnings pré-existentes), typecheck limpo, `build:admin` ok. Backend: MESA-01
(60/60) + interseção (10/10) + MESA-02 onda2-11 (125/125) + onda12 (10/10) + DELIVERY-FEE-05
(29/29) = **234/234** checks de banco + `npm run test:domain` verde + builds limpos.

## Produção
Não tocada. Migration aplicada SOMENTE no banco E2E dedicado (`db.e2e.env`, projeto `bgzcro`).
`create_order()`/`admin_orders_search()` seguem intocadas; `admin_reports_summary` foi corrigida
(comportamento mudou APENAS para pedidos com `mesa_session_id` — entrega/retirada idênticos,
verificado por regressão).
