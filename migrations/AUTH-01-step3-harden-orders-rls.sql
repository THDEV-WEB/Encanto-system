-- AUTH-01 · Onda 0 · Etapa 3b — ENDURECIMENTO do lado de PEDIDOS (orders/customers/order_items).
-- ACHADO na ativacao: policies "Auth all <tabela>" (FOR ALL TO authenticated USING(true)) davam a
-- QUALQUER autenticado (inclusive cliente logado) leitura/escrita de TODOS os pedidos/clientes -> vazamento
-- e privilegio administrativo indevido. Restringe essas policies a is_admin(); o cliente comum mantem
-- apenas a LEITURA PROPRIA (policies "Cliente le proprio(s) ..." da Etapa 1).
--
-- Guest checkout INTOCADO: create_order e SECURITY DEFINER (roda como owner, bypassa RLS). O vinculo
-- link_customer_to_auth tambem e SECURITY DEFINER. Admin (is_admin) mantem acesso total (getPedidos/setStatus).
-- Pre-requisito: Etapa 1 (is_admin) aplicada. ATOMICO. Idempotente. Rollback: -rollback.sql
BEGIN;

-- orders
DROP POLICY IF EXISTS "Auth all orders" ON public.orders;
CREATE POLICY "Admin all orders" ON public.orders FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- customers
DROP POLICY IF EXISTS "Auth all customers" ON public.customers;
CREATE POLICY "Admin all customers" ON public.customers FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- order_items
DROP POLICY IF EXISTS "Auth all order_items" ON public.order_items;
CREATE POLICY "Admin all order_items" ON public.order_items FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMIT;
