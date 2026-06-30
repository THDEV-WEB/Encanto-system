-- NORM-06.1 · HARDEN-RLS (=F1C) — policies de RLS do catálogo. ATÔMICO. Idempotente (DROP IF EXISTS + CREATE).
-- Conforme ADR NORM-06.1-harden-rls.md §3 (congelado). PRÉ-REQUISITO BLOQUEANTE SATISFEITO (verificado 2026-06-29/30):
--   disable_signup=true (POST /auth/v1/signup -> 422 signup_disabled) E external_anonymous_users_enabled=false
--   (POST /auth/v1/signup {} -> 422 anonymous_provider_disabled). 0 SSO, 1 user (admin) -> authenticated == só admin.
-- DEPENDE da F1B-ERRATA-01 (funções STI SECURITY DEFINER): sem ela, escritas authenticated que referenciam
--   categoria falham (FOR SHARE não enxerga categoria sob RLS). A errata decoupla o STI da RLS.
-- D1 PRESERVA leitura pública (anon lê todos, incl. indisponíveis) — products/categories/adicionais READ inalterados.
-- D2 NÃO toca orders/customers/order_items (HARDEN-ORDERS-RLS próprio).
-- D3 adiciona escrita 'authenticated' em categories/adicionais (corrige bug: writes do admin negados por RLS) + product_collections.
-- Substitui a provisória pc_public_read (F1A) por permanente equivalente. NÃO toca tabela/coluna/índice/constraint/trigger/dado.
-- Nomes de policy de escrita seguem o padrão existente "Auth insert products" (nome da tabela).
-- Rollback: migrations/NORM-06.1-step1-rollback.sql
BEGIN;

-- categories: escrita authenticated (espelha products; fecha bug latente)
DROP POLICY IF EXISTS "Auth insert categories" ON public.categories;
CREATE POLICY "Auth insert categories" ON public.categories FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth update categories" ON public.categories;
CREATE POLICY "Auth update categories" ON public.categories FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Auth delete categories" ON public.categories;
CREATE POLICY "Auth delete categories" ON public.categories FOR DELETE TO authenticated USING (true);

-- adicionais: escrita authenticated
DROP POLICY IF EXISTS "Auth insert adicionais" ON public.adicionais;
CREATE POLICY "Auth insert adicionais" ON public.adicionais FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth update adicionais" ON public.adicionais;
CREATE POLICY "Auth update adicionais" ON public.adicionais FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Auth delete adicionais" ON public.adicionais;
CREATE POLICY "Auth delete adicionais" ON public.adicionais FOR DELETE TO authenticated USING (true);

-- product_collections: substitui a provisória pc_public_read por permanente + escrita authenticated (F2 backfill / F4 editor)
DROP POLICY IF EXISTS pc_public_read ON public.product_collections;
DROP POLICY IF EXISTS "Leitura pública coleções" ON public.product_collections;
CREATE POLICY "Leitura pública coleções" ON public.product_collections FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS "Auth insert product_collections" ON public.product_collections;
CREATE POLICY "Auth insert product_collections" ON public.product_collections FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth update product_collections" ON public.product_collections;
CREATE POLICY "Auth update product_collections" ON public.product_collections FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Auth delete product_collections" ON public.product_collections;
CREATE POLICY "Auth delete product_collections" ON public.product_collections FOR DELETE TO authenticated USING (true);

COMMIT;
