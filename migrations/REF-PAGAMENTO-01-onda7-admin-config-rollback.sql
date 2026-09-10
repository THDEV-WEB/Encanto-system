-- ============================================================================
-- REF-PAGAMENTO-01 · Onda 7 — ROLLBACK
-- set_pagamento_config nao existia antes desta onda -- rollback e' DROP puro.
-- get_pagamento_config (Onda 5) e store_settings NAO sao tocados.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.set_pagamento_config(boolean, text, uuid);

NOTIFY pgrst, 'reload schema';

COMMIT;
