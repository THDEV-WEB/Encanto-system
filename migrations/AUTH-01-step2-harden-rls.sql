-- AUTH-01 · Onda 0 · Etapa 2 — ENDURECIMENTO das policies de ESCRITA do catalogo (is_admin()).
-- Remove a premissa antiga "authenticated == admin": agora so ADMIN (linha em public.admins) escreve.
-- Cliente autenticado comum NAO edita produtos/categorias/adicionais/collections.
--
-- >>> BREAKING <<< PRE-REQUISITOS OBRIGATORIOS antes de aplicar (senao o Admin perde escrita):
--   1) Etapa 1 (AUTH-01-step1-fundacao.sql) aplicada.
--   2) Registrar o admin ATUAL em public.admins:
--        SELECT id, email FROM auth.users ORDER BY created_at;   -- ache o uuid do admin
--        INSERT INTO public.admins(user_id) VALUES ('<uuid-do-admin>') ON CONFLICT DO NOTHING;
--        SELECT public.is_admin();  -- (logado como admin) deve retornar true
--   3) AUDITORIA — confirmar os NOMES reais das policies de escrita antes de trocar:
--        SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
--         WHERE tablename IN ('products','categories','adicionais','product_collections')
--         ORDER BY tablename, cmd;
--      Se algum nome divergir dos abaixo, ajuste os DROP/CREATE correspondentes (nao deixe policy
--      permissiva TO authenticated USING(true)/WITH CHECK(true) sobrando).
--
-- ATOMICO. Idempotente (DROP IF EXISTS + CREATE). Leitura publica (SELECT) PRESERVADA (nao tocada).
-- Rollback: AUTH-01-step2-harden-rls-rollback.sql
BEGIN;

-- ── products ──
DROP POLICY IF EXISTS "Auth insert products" ON public.products;
CREATE POLICY "Auth insert products" ON public.products FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Auth update products" ON public.products;
CREATE POLICY "Auth update products" ON public.products FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Auth delete products" ON public.products;
CREATE POLICY "Auth delete products" ON public.products FOR DELETE TO authenticated USING (public.is_admin());

-- ── categories ──
DROP POLICY IF EXISTS "Auth insert categories" ON public.categories;
CREATE POLICY "Auth insert categories" ON public.categories FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Auth update categories" ON public.categories;
CREATE POLICY "Auth update categories" ON public.categories FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Auth delete categories" ON public.categories;
CREATE POLICY "Auth delete categories" ON public.categories FOR DELETE TO authenticated USING (public.is_admin());

-- ── adicionais ──
DROP POLICY IF EXISTS "Auth insert adicionais" ON public.adicionais;
CREATE POLICY "Auth insert adicionais" ON public.adicionais FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Auth update adicionais" ON public.adicionais;
CREATE POLICY "Auth update adicionais" ON public.adicionais FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Auth delete adicionais" ON public.adicionais;
CREATE POLICY "Auth delete adicionais" ON public.adicionais FOR DELETE TO authenticated USING (public.is_admin());

-- ── product_collections ──
DROP POLICY IF EXISTS "Auth insert product_collections" ON public.product_collections;
CREATE POLICY "Auth insert product_collections" ON public.product_collections FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Auth update product_collections" ON public.product_collections;
CREATE POLICY "Auth update product_collections" ON public.product_collections FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Auth delete product_collections" ON public.product_collections;
CREATE POLICY "Auth delete product_collections" ON public.product_collections FOR DELETE TO authenticated USING (public.is_admin());

COMMIT;

-- POS-VALIDACAO (rodar apos aplicar):
--   SELECT public.is_admin();  -- true logado como admin; false p/ cliente comum
--   npm run test:auth-rls      -- gate automatizado
