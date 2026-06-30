-- Rollback do Step 2 (HARDEN-ORDERS-RLS). Restaura EXATAMENTE o estado §0 (exposição pública). ATÔMICO.
-- Reverter este step ANTES do step1-rollback (assim o checkout anon continua funcionando durante a reversão).
BEGIN;

-- 4') reabrir a view
ALTER VIEW public.v_order_reconciliation RESET (security_invoker);
GRANT ALL ON public.v_order_reconciliation TO anon;

-- 3') restaurar grants de tabela do anon
GRANT ALL ON public.orders       TO anon;
GRANT ALL ON public.customers    TO anon;
GRANT ALL ON public.order_items  TO anon;
GRANT ALL ON public.order_events TO anon;
GRANT ALL ON public.addresses    TO anon;

-- 2') remover policies authenticated
DROP POLICY IF EXISTS "Auth all orders"      ON public.orders;
DROP POLICY IF EXISTS "Auth all customers"   ON public.customers;
DROP POLICY IF EXISTS "Auth all order_items" ON public.order_items;

-- 1') restaurar as policies permissivas originais
DROP POLICY IF EXISTS "Allow all operations on orders"      ON public.orders;
CREATE POLICY "Allow all operations on orders"      ON public.orders      FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all operations on customers"   ON public.customers;
CREATE POLICY "Allow all operations on customers"   ON public.customers   FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all operations on order_items" ON public.order_items;
CREATE POLICY "Allow all operations on order_items" ON public.order_items FOR ALL TO public USING (true) WITH CHECK (true);

COMMIT;
