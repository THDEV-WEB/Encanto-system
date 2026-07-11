-- Rollback da AUTH-01 · Onda 0 · Etapa 1 (fundacao aditiva). ATOMICO.
-- Remove funcoes/policies/tabela criadas. A coluna customers.auth_user_id NAO e dropada por padrao
-- (preserva vinculos ja criados / evita perda de dados); descomente a ultima linha p/ removê-la.
BEGIN;

DROP FUNCTION IF EXISTS public.link_customer_to_auth(text);

DROP POLICY IF EXISTS "Cliente le proprios order_items" ON public.order_items;
DROP POLICY IF EXISTS "Cliente le proprios orders"      ON public.orders;
DROP POLICY IF EXISTS "Cliente le proprio customer"     ON public.customers;

DROP FUNCTION IF EXISTS public.is_admin();

DROP POLICY IF EXISTS "admins self read" ON public.admins;
DROP TABLE IF EXISTS public.admins;

-- Preserva o vinculo por padrao. Para reverter 100% o schema, descomente:
-- DROP INDEX IF EXISTS public.customers_auth_user_id_key;
-- ALTER TABLE public.customers DROP COLUMN IF EXISTS auth_user_id;

COMMIT;
