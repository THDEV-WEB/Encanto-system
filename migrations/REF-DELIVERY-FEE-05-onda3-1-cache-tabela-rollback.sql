-- Rollback de REF-DELIVERY-FEE-05-onda3-1-cache-tabela.sql
-- Seguro: nenhuma outra funcao depende de delivery_route_cache/upsert_delivery_route_cache ate a
-- Onda 3.3 (_resolve_delivery_fee) e a Onda 3.2 (Edge Function) serem aplicadas por cima. Rodar este
-- rollback ANTES delas reverte 100% sem deixar resíduo.
-- ATUALIZADO apos REF-DELIVERY-FEE-05-onda3-2-fix-nome-rpc-postgrest.sql: a funcao foi renomeada de
-- _upsert_delivery_route_cache para upsert_delivery_route_cache (PostgREST oculta da API REST qualquer
-- funcao com prefixo underscore) -- este DROP usa o nome ATUAL, senao rodaria sem efeito (IF EXISTS).
BEGIN;

DROP FUNCTION IF EXISTS public.upsert_delivery_route_cache(uuid, double precision, double precision, double precision, double precision, numeric, numeric, text, text);
DROP FUNCTION IF EXISTS public._upsert_delivery_route_cache(uuid, double precision, double precision, double precision, double precision, numeric, numeric, text, text);
DROP TABLE IF EXISTS public.delivery_route_cache;

COMMIT;

NOTIFY pgrst, 'reload schema';
