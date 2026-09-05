-- Rollback de REF-DELIVERY-FEE-05-onda3-2-fix-nome-rpc-postgrest.sql
BEGIN;

ALTER FUNCTION public.upsert_delivery_route_cache(uuid, double precision, double precision, double precision, double precision, numeric, numeric, text, text)
  RENAME TO _upsert_delivery_route_cache;

COMMIT;

NOTIFY pgrst, 'reload schema';
