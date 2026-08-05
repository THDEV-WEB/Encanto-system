-- Rollback de REF-DELIVERY-FEE-01-step1-fee-config-rpc.sql
-- Remove as 2 funcoes novas e a chave de configuracao. NAO reverte nada fora deste passo.
BEGIN;

DROP FUNCTION IF EXISTS public.set_delivery_fee_config(jsonb);
DROP FUNCTION IF EXISTS public.get_delivery_fee_config();
DELETE FROM public.settings WHERE chave = 'delivery_fee_config';

COMMIT;

NOTIFY pgrst, 'reload schema';
