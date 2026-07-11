-- Rollback da AUTH-01 · Etapa 3b — restaura as policies "Auth all" (FOR ALL TO authenticated USING(true))
-- em orders/customers/order_items (estado pre-AUTH-01). ATOMICO. As policies de leitura propria da
-- Etapa 1 nao sao tocadas aqui (removidas pelo rollback da Etapa 1).
BEGIN;

DROP POLICY IF EXISTS "Admin all orders" ON public.orders;
CREATE POLICY "Auth all orders" ON public.orders FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin all customers" ON public.customers;
CREATE POLICY "Auth all customers" ON public.customers FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin all order_items" ON public.order_items;
CREATE POLICY "Auth all order_items" ON public.order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;
