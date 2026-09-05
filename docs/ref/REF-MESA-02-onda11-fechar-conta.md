# REF-MESA-02 — Onda 11: Fechamento da Conta

**Status: CONCLUÍDA.** Encerra uma sessão aberta (cliente pagou e foi embora) — grava forma de
pagamento e valor cobrado (snapshot de auditoria), libera TODAS as mesas físicas associadas
(inclusive juntadas na Onda 10 e a fechada-por-troca na Onda 9), e a sessão vira imutável (a
trigger `_mesa_sessions_no_reopen`, já existente desde a Onda 2, bloqueia qualquer alteração
depois).

## O que mudou
- **`_calcular_total_sessao_mesa(p_mesa_session_id, p_store_id)`** (nova, função interna, sem
  GRANT): extrai o cálculo `SUM(orders.total) FILTER (WHERE status <> 'cancelado')` que já existia
  duplicado dentro de `admin_consultar_conta_mesa` (Onda 8) — usada agora nas duas RPCs, uma única
  fonte da lógica.
- **`admin_consultar_conta_mesa`** (Onda 8) foi refeita com `CREATE OR REPLACE` (mesma
  assinatura/retorno, comportamento idêntico) para reaproveitar a função acima em vez de duplicar
  o cálculo — corrigido antes do commit, não deixado como dívida técnica.
- **`admin_fechar_conta_mesa(p_mesa_session_id, p_payment_method, p_store_id)`** (nova):
  `is_admin_of` + `WHERE store_id` explícito, lock `FOR UPDATE` na sessão (mesmo padrão das Ondas
  6/9/10). Forma de pagamento obrigatória (não vazia) somente se o total for `> 0` — mesma regra
  que a `CHECK mesa_sessions_coerencia_estado` da Onda 2 já impõe. O `UPDATE` de
  `mesa_sessions.status` dispara, por design, a trigger `trg_mesa_sessions_sync_child_status` (Onda
  2) que já sincroniza sozinha TODAS as linhas de `mesa_session_mesas` daquela sessão para
  `fechada` — a RPC não precisa tocar `mesa_session_mesas`/`public.mesas` diretamente.
- `mesasFisicas.js::fecharContaMesa()`.
- `AdminMesas.jsx`: seção "✅ Fechar conta" no modal (seletor das mesmas 4 formas de pagamento de
  `NovoPedidoMesaModal.jsx` + botão com o total).

## Decisões
- **`valor_cobrado_snapshot` continua sendo só auditoria** (já registrado na Onda 2, seção 3/R7 da
  auditoria) — nenhuma lógica desta onda soma essa coluna em relatório nenhum; `SUM(orders.total)`
  continua a única fonte de verdade de faturamento.
- **Nenhum enum fechado de formas de pagamento no banco** — mesmo padrão de `create_order()`, que
  só valida não-vazio. As opções conhecidas vêm do frontend (reaproveitadas de
  `NovoPedidoMesaModal.jsx`).

## Testes
`scripts/mesa-02-onda11-fechar-conta-test.mjs` (novo, 13/13): caso feliz com 1 mesa (snapshot/forma/
quem fechou corretos), caso feliz com mesas juntadas (as 2 liberam juntas via a trigger), forma de
pagamento obrigatória quando total > 0 (e nada muda na rejeição), sessão sem pedidos fecha sem
forma de pagamento, fechar 2 vezes é rejeitado (não sobrescreve o snapshot original), sessão
fechada é imutável (trigger da Onda 2 bloqueia `UPDATE` direto), cross-tenant, outsider sem
permissão.

Migration + rollback testados de verdade (aplicado → funções novas removidas confirmado via
`pg_proc`, `admin_consultar_conta_mesa` restaurada à forma da Onda 8 → reaplicado → tudo
restaurado, suíte da Onda 8 revalidada 12/12 após a refatoração).

## Regressão completa
lint (0 erros, 60 warnings pré-existentes), typecheck limpo, `build:admin` ok. Backend: MESA-01
(60/60) + interseção (10/10) + MESA-02 onda2-10 (112/112) + onda11 (13/13) + DELIVERY-FEE-05
(29/29) = **224/224** checks de banco + `npm run test:domain` verde + builds limpos.

## Produção
Não tocada. Migration aplicada SOMENTE no banco E2E dedicado (`db.e2e.env`, projeto `bgzcro`).
`create_order()`/`admin_orders_search()` seguem intocadas; `admin_consultar_conta_mesa` foi
refatorada (mesmo comportamento, verificado por regressão) mas nenhuma função crítica de escrita
mudou.
