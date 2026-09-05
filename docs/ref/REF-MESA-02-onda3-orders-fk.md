# REF-MESA-02 — Onda 3: `orders.mesa_session_id`

**Status: CONCLUÍDA.** Execução autônoma noturna autorizada (2026-09-05) — sem pausa obrigatória
entre ondas; hard constraints da REF-MESA-01 continuam valendo (nunca produção, nunca push, commit
por subfase, registrar-não-corrigir bug fora de escopo, parar nos 8 STOP conditions).

## O que foi feito
- `ALTER TABLE orders ADD COLUMN mesa_session_id uuid NULL REFERENCES mesa_sessions(id) ON DELETE RESTRICT`.
- `CHECK orders_mesa_session_id_coerente`: só preenchido quando `tipo_pedido='mesa'`.
- Trigger `_orders_mesa_session_check_store` (BEFORE INSERT OR UPDATE OF mesa_session_id): `orders.store_id` precisa bater com o `store_id` real da `mesa_sessions` referenciada (defesa cross-tenant, risco R9 da auditoria).
- Trigger `_orders_mesa_session_immutable` (BEFORE UPDATE OF mesa_session_id): uma vez gravado, nunca pode ser reatribuído nem limpo (risco R6 — impede o mesmo pedido ser contado em 2 fechamentos).
- `create_order()`/`admin_orders_search()` **não foram tocadas** — coluna fica sempre NULL até uma onda futura popular isso.

## Testes (E2E, `scripts/mesa-02-onda3-orders-fk-test.mjs`)
8/8: regressão de `create_order()` intocado, CHECK de coerência, cross-tenant bloqueado, imutabilidade (reatribuir e limpar), `status` continua livre de mudar, `ON DELETE RESTRICT` bloqueia apagar sessão referenciada. Corrigi 1 bug no meu script (dependência entre savepoints, mesma classe já vista antes) antes de fechar.

## Regressão
MESA-01 (7 suítes) 60/60 + interseção 10/10 + Onda 2 (mesa_sessions) 27/27 + DELIVERY-FEE-05 29/29 + `test:domain` verde. Zero regressão.

## Rollback
Testado de verdade (aplicado, coluna some, reaplicado, E2E fica com a Onda 3 de volta).

## Produção
Não tocada. Só E2E.

## Nota
Enquanto eu trabalhava, outra sessão commitou `REF-DELIVERY-FEE-05 Onda 3` (distância viária via
cache) — confirmei que preserva a assinatura e o formato de retorno de `_resolve_delivery_fee()`
que `create_order()` reconciliado usa; regressão continua verde.
