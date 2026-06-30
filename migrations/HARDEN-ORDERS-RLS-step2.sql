-- HARDEN-ORDERS-RLS · Step 2 — fecha a exposição pública dos pedidos. ATÔMICO. Idempotente.
-- D-ANON-READ: anon perde leitura/escrita direta de orders/customers/order_items/v_order_reconciliation.
-- D-GRANTS:    revoga grants de tabela do anon (defesa em profundidade além do RLS).
-- D-VIEW:      v_order_reconciliation -> security_invoker (respeita RLS do chamador) + sem acesso anon.
-- Admin (authenticated) ganha acesso pleno (FOR ALL) — o painel lê via getPedidos/setStatus como authenticated.
-- DEPENDE do Step 1 (create_order SECURITY DEFINER): o checkout anon continua via RPC, que insere como dono.
-- orders/customers/order_items: 'Allow all public' REMOVIDA. order_events: mantém read-auth (só revoga grants anon).
-- addresses: mantém SEM policy (app não usa) — só revoga grants do anon. application_logs: INTOCADA (anon insere log).
-- Rollback: migrations/HARDEN-ORDERS-RLS-step2-rollback.sql
BEGIN;

-- 1) remover policies permissivas (anon deixa de ler/editar via RLS)
DROP POLICY IF EXISTS "Allow all operations on orders"      ON public.orders;
DROP POLICY IF EXISTS "Allow all operations on customers"   ON public.customers;
DROP POLICY IF EXISTS "Allow all operations on order_items" ON public.order_items;

-- 2) admin (authenticated) acesso pleno
DROP POLICY IF EXISTS "Auth all orders"      ON public.orders;
CREATE POLICY "Auth all orders"      ON public.orders      FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Auth all customers"   ON public.customers;
CREATE POLICY "Auth all customers"   ON public.customers   FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Auth all order_items" ON public.order_items;
CREATE POLICY "Auth all order_items" ON public.order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3) defesa em profundidade: revogar grants de tabela do anon (RLS já bloqueia; isto é a 2a camada)
REVOKE ALL ON public.orders       FROM anon;
REVOKE ALL ON public.customers    FROM anon;
REVOKE ALL ON public.order_items  FROM anon;
REVOKE ALL ON public.order_events FROM anon;
REVOKE ALL ON public.addresses    FROM anon;

-- 4) fechar a view que bypassa RLS (security_invoker=true respeita a RLS do chamador) + sem acesso anon
ALTER VIEW public.v_order_reconciliation SET (security_invoker = true);
REVOKE ALL ON public.v_order_reconciliation FROM anon;

COMMIT;
