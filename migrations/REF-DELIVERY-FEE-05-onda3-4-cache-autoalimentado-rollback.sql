-- Rollback de REF-DELIVERY-FEE-05-onda3-4-cache-autoalimentado.sql
BEGIN;

DROP FUNCTION IF EXISTS public.enc_dispatch_route_requests();
DROP FUNCTION IF EXISTS public._enfileirar_calculo_rota(uuid, double precision, double precision, double precision, double precision, text);
DROP TABLE IF EXISTS public.delivery_route_requests;

COMMIT;

SELECT cron.unschedule('enc-dispatch-route-requests') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'enc-dispatch-route-requests');

NOTIFY pgrst, 'reload schema';
