# REF-DASHBOARD-01 — BI/relatórios reais no Admin

- **Status:** ✅ **CONCLUÍDA (2026-08-10).** Frente do [[encanto-roadmap-paralelo-saas01]] (Grupo 1,
  favorito nº1 do ranking de impacto), escolhida pelo dono para começar após o fechamento da Onda 7.1
  da REF-SAAS-01. Multi-tenant desde o dia 1 (a REF-SAAS-01 já é a fundação em produção).

## Auditoria

- Dashboard atual (`AdminDashboard.jsx`) é um snapshot "de hoje": 5 cards + últimos 10 pedidos, via
  `admin_orders_stats`. "Saúde" (`AdminHealth.jsx`) é observabilidade técnica (erros/divergências),
  não BI de negócio. Nenhuma tela permite escolher um período nem ver tendência, top produtos, forma de
  pagamento ou entrega vs. retirada.
- `orders`/`order_items` já têm todo dado necessário (total, payment_method, address, created_at,
  nome_produto, quantity, preco_unitario) — nenhuma coluna nova precisa nascer.
- "entrega vs. retirada" não é uma coluna — é um classificador de texto sobre `orders.address`
  (`comandaModel.js::RE_RETIRADA`, `/retirada\s+na\s+loja/i`). Replicado inline na SQL (comentado como
  fonte de verdade a manter em sincronia, mesmo espírito de `dia_loja()`).
- **Decisão de escopo confirmada com o dono**: pedidos **cancelados são excluídos** de toda soma de
  receita/quantidade nos novos relatórios — diferente de `admin_orders_stats`/`orders_health` (que somam
  tudo, por serem "snapshot operacional", não BI). Números propositalmente diferentes entre as 2 telas.

## Plano técnico

**Backend** (`migrations/REF-DASHBOARD-01-admin-reports.sql` + rollback): nova RPC
`admin_reports_summary(p_period_start, p_period_end, p_store_id DEFAULT default_store_id())` —
`SECURITY DEFINER`, gate `is_admin_of(p_store_id)`, sem `REVOKE`/`GRANT` explícito (mesmo padrão de
`admin_orders_stats`/`orders_health` — grants default do projeto, autorização real é o gate interno).
Retorna jsonb com `serie_dia` (faturamento/pedidos por dia via `dia_loja()`, reaproveitada de
REF-DATETIME-01), `top_produtos` (top 10 por receita), `por_pagamento`, `por_tipo` (entrega/retirada).

**Frontend**: `DS.getRelatorios(inicio, fim)` (DataService.js) + `AdminRelatorios.jsx` (nova aba
"Relatórios" no AdminPanel, entre Dashboard e Pedidos) — presets 7d/30d/90d + período personalizado
(`<input type="date">`), gráfico de barras reaproveitando o MESMO estilo inline já usado em
`AdminHealth.jsx` (nenhuma lib de gráfico nova), tabela de top produtos, breakdown de forma de pagamento
e de entrega/retirada. Rótulos de forma de pagamento espelham (só apresentação, não lógica) o array
`pays` já existente em `CheckoutPage.jsx`.

## Testes

- **Backend** (`scripts/dashboard01-admin-reports-test.mjs`, `npm run test:dashboard01-admin-reports`):
  **13/13 PASS** — isolamento entre lojas (A nunca vê produto/receita de B, e vice-versa), cancelados
  excluídos de toda soma, filtro de período (pedido fora do range nunca entra), classificação
  entrega/retirada correta, agregação de top produtos e forma de pagamento corretas, autorização
  (`is_admin_of`) nos 2 sentidos, período inválido rejeitado, zero mutação líquida em produção.
- **E2E** (`e2e/tests/admin/admin-relatorios.spec.js`, novo; `AdminPanel.page.js` ganhou a aba
  `relatorios` na allowlist): pedido real do fixture aparece no relatório do período padrão (30d), troca
  de preset recarrega sem erro, período sem nenhum pedido mostra o estado vazio.
- `npm run test:domain` → exit 0. `npm run test:db-guards` completo (24 scripts, incluindo os desta
  ref) → **100% verde, zero `[FAIL]`**. Suíte **E2E completa — 117/117 PASS** (115 pré-existentes + 2
  novos).
- **Achado operacional, não um bug**: a nova RPC precisou ser aplicada tanto em produção quanto no
  projeto Supabase dedicado a E2E (rotina já estabelecida desde a REF-SAAS-01 — toda RPC nova nasce nos
  dois ambientes, não só em produção).

## Commit / Push

Commit único cobrindo: migration + rollback, `DataService.js` (`getRelatorios`), `AdminRelatorios.jsx`
(novo), `AdminPanel.jsx` (nova aba), script de teste dedicado (13/13), `package.json`, spec E2E novo +
`AdminPanel.page.js` (allowlist), este ledger.

## Relatório técnico

**Objetivo cumprido**: o Admin agora tem BI de negócio real — faturamento por dia com período
escolhido pelo admin, produtos mais vendidos, forma de pagamento e entrega vs. retirada, tudo excluindo
pedidos cancelados (numérico correto para decisão de negócio, diferente do snapshot operacional do
Dashboard/Saúde). Zero coluna/tabela nova — só 1 RPC agregadora, reaproveitando `dia_loja()` (já
existente desde REF-DATETIME-01) e o mesmo estilo visual de gráfico de barras já usado em "Saúde".
Multi-tenant desde a primeira linha de código (gate `is_admin_of`, mesmo padrão de toda RPC administrativa
desta base desde a REF-SAAS-01) — nenhuma migração futura de "tornar multi-tenant" será necessária aqui.

**Decisão de escopo mais relevante**: excluir cancelados da receita — uma correção de precisão que o
resto do Admin (Dashboard/Saúde) não tem, deliberadamente deixada como está (fora do escopo desta ref,
mudar o comportamento de telas já em produção usadas todos os dias não era o pedido).

**Sem achados inesperados desta vez** — diferente das últimas subfases da REF-SAAS-01, esta foi a
primeira migration+feature desta sessão a fechar sem nenhum gap de ambiente descoberto no meio do
caminho (a única ação de sincronização necessária, aplicar a RPC nova no E2E, é rotina já esperada, não
uma surpresa).

**Próximo passo**: outra frente do Grupo 1 do roadmap paralelo (REF-OBS-02, REF-SEC-02, REF-DEVEX-01,
REF-CI-02, REF-PERF-02) quando o dono priorizar, ou retomar a Onda 7.2 da REF-SAAS-01 se explicitamente
pedido.
