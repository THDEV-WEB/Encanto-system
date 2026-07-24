-- Rollback do REF-ADMIN-03 · Onda 3. ATOMICO. Remove as 2 RPCs e o índice novos.
-- NAO toca dados, nem a tabela orders/customers/order_items em si.
BEGIN;

DROP FUNCTION IF EXISTS public.admin_orders_search(text, text, int, timestamp without time zone, uuid);
DROP FUNCTION IF EXISTS public.admin_orders_stats();
DROP INDEX IF EXISTS public.orders_status_created_at_idx;

COMMIT;
