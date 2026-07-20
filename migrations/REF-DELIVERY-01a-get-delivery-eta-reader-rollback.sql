-- Rollback REF-DELIVERY-01a — remove o leitor dedicado get_delivery_eta().
BEGIN;
DROP FUNCTION IF EXISTS public.get_delivery_eta();
COMMIT;
NOTIFY pgrst, 'reload schema';
