-- Rollback de REF-DELIVERY-FEE-05-onda3-1-cache-tabela.sql
-- Seguro: nenhuma outra funcao depende de delivery_route_cache/_upsert_delivery_route_cache ate a
-- Onda 3.3 (_resolve_delivery_fee) e a Onda 3.2 (Edge Function) serem aplicadas por cima. Rodar este
-- rollback ANTES delas reverte 100% sem deixar resíduo.
BEGIN;

DROP FUNCTION IF EXISTS public._upsert_delivery_route_cache(uuid, double precision, double precision, double precision, double precision, numeric, numeric, text, text);
DROP TABLE IF EXISTS public.delivery_route_cache;

COMMIT;

NOTIFY pgrst, 'reload schema';
