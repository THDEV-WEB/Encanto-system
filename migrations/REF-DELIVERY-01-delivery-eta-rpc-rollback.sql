-- Rollback REF-DELIVERY-01 — remove o RPC set_delivery_eta e a chave 'delivery_eta_min' de public.settings.
-- get_setting/is_admin sao pre-existentes e NAO sao tocados aqui.

BEGIN;

DROP FUNCTION IF EXISTS public.set_delivery_eta(int);
DELETE FROM public.settings WHERE chave = 'delivery_eta_min';

COMMIT;

NOTIFY pgrst, 'reload schema';
