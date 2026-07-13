-- ROLLBACK REF-BUSINESS-HOURS-03 — remove os RPCs de store_mode. NAO remove a chave 'store_mode' de
-- settings por padrao (preserva o dado). Descomente a ultima linha se quiser apagar tambem a configuracao.
BEGIN;

DROP FUNCTION IF EXISTS public.set_store_mode(text);
DROP FUNCTION IF EXISTS public.get_store_mode();

-- DELETE FROM public.settings WHERE chave = 'store_mode';   -- opcional: apaga a config persistida

COMMIT;

NOTIFY pgrst, 'reload schema';
