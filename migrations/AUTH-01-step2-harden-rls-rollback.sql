-- Rollback da AUTH-01 · Onda 0 · Etapa 2 — restaura as policies de escrita ao estado NORM-06.1
-- (TO authenticated USING(true)/WITH CHECK(true) — "authenticated == admin"). ATOMICO.
-- Use apenas se precisar reverter o endurecimento (ex.: admin nao registrado a tempo).
BEGIN;

-- ── products ──
DROP POLICY IF EXISTS "Auth insert products" ON public.products;
CREATE POLICY "Auth insert products" ON public.products FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth update products" ON public.products;
CREATE POLICY "Auth update products" ON public.products FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Auth delete products" ON public.products;
CREATE POLICY "Auth delete products" ON public.products FOR DELETE TO authenticated USING (true);

-- ── categories ──
DROP POLICY IF EXISTS "Auth insert categories" ON public.categories;
CREATE POLICY "Auth insert categories" ON public.categories FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth update categories" ON public.categories;
CREATE POLICY "Auth update categories" ON public.categories FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Auth delete categories" ON public.categories;
CREATE POLICY "Auth delete categories" ON public.categories FOR DELETE TO authenticated USING (true);

-- ── adicionais ──
DROP POLICY IF EXISTS "Auth insert adicionais" ON public.adicionais;
CREATE POLICY "Auth insert adicionais" ON public.adicionais FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth update adicionais" ON public.adicionais;
CREATE POLICY "Auth update adicionais" ON public.adicionais FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Auth delete adicionais" ON public.adicionais;
CREATE POLICY "Auth delete adicionais" ON public.adicionais FOR DELETE TO authenticated USING (true);

-- ── product_collections ──
DROP POLICY IF EXISTS "Auth insert product_collections" ON public.product_collections;
CREATE POLICY "Auth insert product_collections" ON public.product_collections FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth update product_collections" ON public.product_collections;
CREATE POLICY "Auth update product_collections" ON public.product_collections FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Auth delete product_collections" ON public.product_collections;
CREATE POLICY "Auth delete product_collections" ON public.product_collections FOR DELETE TO authenticated USING (true);

COMMIT;
