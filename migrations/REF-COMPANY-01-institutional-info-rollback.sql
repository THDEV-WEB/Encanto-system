-- Rollback REF-COMPANY-01 — remove get_company_info/set_company_info e a chave 'company_info' de
-- public.settings. is_admin/enc_normalize_phone_br sao pre-existentes e NAO sao tocados aqui.

BEGIN;

DROP FUNCTION IF EXISTS public.set_company_info(jsonb);
DROP FUNCTION IF EXISTS public.get_company_info();
DELETE FROM public.settings WHERE chave = 'company_info';

COMMIT;

NOTIFY pgrst, 'reload schema';
