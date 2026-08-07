-- REF-SAAS-01 · Onda 0 — Rollback: remove `store_id` das 13 tabelas + tabela `stores`
-- Desfaz integralmente REF-SAAS-01-onda0-schema.sql. Seguro a qualquer momento enquanto
-- nenhuma RPC/RLS/frontend (Ondas 1+) depender de `store_id` — nesta onda, nada em `src/`
-- ainda le essa coluna.

BEGIN;

DROP INDEX IF EXISTS public.customers_store_id_idx;
DROP INDEX IF EXISTS public.products_store_id_idx;
DROP INDEX IF EXISTS public.categories_store_id_idx;
DROP INDEX IF EXISTS public.adicionais_store_id_idx;
DROP INDEX IF EXISTS public.product_collections_store_id_idx;
DROP INDEX IF EXISTS public.orders_store_id_idx;
DROP INDEX IF EXISTS public.order_items_store_id_idx;
DROP INDEX IF EXISTS public.order_events_store_id_idx;
DROP INDEX IF EXISTS public.loyalty_accounts_store_id_idx;
DROP INDEX IF EXISTS public.loyalty_events_store_id_idx;
DROP INDEX IF EXISTS public.notification_outbox_store_id_idx;
DROP INDEX IF EXISTS public.addresses_store_id_idx;
DROP INDEX IF EXISTS public.application_logs_store_id_idx;

ALTER TABLE public.customers            DROP COLUMN IF EXISTS store_id;
ALTER TABLE public.products             DROP COLUMN IF EXISTS store_id;
ALTER TABLE public.categories           DROP COLUMN IF EXISTS store_id;
ALTER TABLE public.adicionais           DROP COLUMN IF EXISTS store_id;
ALTER TABLE public.product_collections  DROP COLUMN IF EXISTS store_id;
ALTER TABLE public.orders               DROP COLUMN IF EXISTS store_id;
ALTER TABLE public.order_items          DROP COLUMN IF EXISTS store_id;
ALTER TABLE public.order_events         DROP COLUMN IF EXISTS store_id;
ALTER TABLE public.loyalty_accounts     DROP COLUMN IF EXISTS store_id;
ALTER TABLE public.loyalty_events       DROP COLUMN IF EXISTS store_id;
ALTER TABLE public.notification_outbox  DROP COLUMN IF EXISTS store_id;
ALTER TABLE public.addresses            DROP COLUMN IF EXISTS store_id;
ALTER TABLE public.application_logs     DROP COLUMN IF EXISTS store_id;

DROP TABLE IF EXISTS public.stores;

COMMIT;
