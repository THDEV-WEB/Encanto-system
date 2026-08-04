-- ROLLBACK REF-BUSINESS-HOURS-04 — remove os RPCs do cronograma semanal. NAO remove a chave
-- 'business_hours_schedule' de settings por padrao (preserva o dado, mesmo criterio de HB-03/store_mode).
-- Descomente a ultima linha se quiser apagar tambem a configuracao.
BEGIN;

DROP FUNCTION IF EXISTS public.set_business_hours_schedule(jsonb);
DROP FUNCTION IF EXISTS public.get_business_hours_schedule();

-- DELETE FROM public.settings WHERE chave = 'business_hours_schedule';   -- opcional: apaga a config persistida

COMMIT;

NOTIFY pgrst, 'reload schema';
