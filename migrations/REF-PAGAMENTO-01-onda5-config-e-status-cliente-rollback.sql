-- ============================================================================
-- REF-PAGAMENTO-01 · Onda 5 — ROLLBACK
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.consultar_status_pagamento(uuid);
DROP FUNCTION IF EXISTS public.get_pagamento_config(uuid);

NOTIFY pgrst, 'reload schema';

COMMIT;
