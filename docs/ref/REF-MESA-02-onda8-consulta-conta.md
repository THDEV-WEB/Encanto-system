# REF-MESA-02 — Onda 8: Total/Consulta da Conta

**Status: CONCLUÍDA.** Primeira RPC de leitura sobre `mesa_sessions`/`mesa_session_mesas`
(schema criado na Onda 2, sem consumidor além de `create_order()` até agora) — permite ao
garçom/admin ver o que já foi pedido numa mesa com sessão aberta e o total corrente, sem fechar
nada.

## O que mudou
- **`admin_consultar_conta_mesa(p_mesa_identificador, p_store_id)`** (nova, `STABLE SECURITY
  DEFINER`, somente leitura): `is_admin_of(p_store_id)` + `WHERE store_id` explícito em toda
  tabela tocada (mesmo padrão corrigido nas Ondas 2/3/4 após o veredito adversarial da auditoria).
  - Mesa inexistente no catálogo → `{ok:false, error:'mesa nao encontrada'}`.
  - Sem permissão → `{ok:false, error:'sem permissao'}`.
  - Mesa cadastrada sem sessão aberta agora → `{ok:true, aberta:false, mesas:[], pedidos:[], total:0}`
    (estado normal, não é erro).
  - Sessão aberta → `{ok:true, aberta:true, sessao_id, origem_abertura, opened_at, mesas:[...],
    pedidos:[{id,created_at,status,total,itens:[...]}], total}`. `mesas` já devolve TODOS os
    identificadores da mesma sessão (suporta a junção de mesas da Onda 10 sem mudar o formato de
    resposta). `total` é `SUM(orders.total)` **excluindo pedidos cancelados** — mesmo critério já
    usado no BI (REF-DASHBOARD-01, "cancelados excluídos") — mas o pedido cancelado continua
    aparecendo na lista `pedidos` (transparência: o garçom vê que existiu e foi cancelado).
- `mesasFisicas.js`: `consultarContaMesa(identificador)`.
- `AdminMesas.jsx`: botão "🧾 Ver conta" (só aparece quando `m.ocupada`, derivado do que
  `admin_listar_mesas` já calculava) abre um modal com a lista de pedidos/itens e o total.

## Decisões
- **Não criei RPC de fechamento nem qualquer escrita** — esta onda é 100% leitura, por design.
  Fechamento é a Onda 11.
- **Cancelado aparece na lista mas não soma no total**: decidido para espelhar exatamente o
  critério já estabelecido no BI, evitando duas fontes de verdade divergentes sobre "o que conta
  como receita".
- **`mesas` como array de identificadores** (não um único campo escalar): decisão deliberada desde
  a Onda 2 — a estrutura de dados já suporta junção de mesas, esta RPC só respeita isso ao
  devolver todos os identificadores da sessão, não presumir 1:1.

## Testes
- `scripts/mesa-02-onda8-consulta-conta-test.mjs` (novo, 12/12): mesa sem sessão, mesa
  inexistente, outsider sem permissão, sessão real com 2 pedidos (um cancelado) confirmando total
  correto, `mesas` da sessão, cross-tenant (mesmo identificador em loja diferente não vê a
  sessão), e confirmação de que a RPC não cria nenhuma linha nova (somente leitura).
- Migration + rollback testados de verdade (aplicado → função removida confirmada via
  `pg_proc` → reaplicado → função restaurada confirmada).

## Regressão completa
lint (0 erros, 60 warnings pré-existentes), typecheck limpo, `build:admin` ok. Backend: MESA-01
(60/60) + interseção (10/10) + MESA-02 onda2-7 (73/73) + onda8 (12/12) + DELIVERY-FEE-05 (29/29) =
**184/184** checks de banco + `npm run test:domain` verde + builds limpos.

## Produção
Não tocada. Migration aplicada SOMENTE no banco E2E dedicado (`db.e2e.env`, projeto `bgzcro`).
Aditiva pura — nenhuma função existente foi alterada, `create_order()`/`admin_orders_search()`
seguem intocadas.
