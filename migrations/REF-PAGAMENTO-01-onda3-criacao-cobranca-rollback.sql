-- ============================================================================
-- REF-PAGAMENTO-01 · Onda 3 — ROLLBACK
-- ----------------------------------------------------------------------------
-- Remove as 2 funções desta onda. Não mexe em payment_intents/orders (schema
-- da Onda 1, fora do escopo deste rollback) nem nas funções da Onda 2.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public._registrar_criacao_pagamento(uuid, uuid, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.iniciar_pagamento_pedido(uuid, uuid);

NOTIFY pgrst, 'reload schema';

COMMIT;
