-- ROLLBACK — REF-SAAS-01 · Onda 6.1 (resolucao de loja no storefront por dominio)

BEGIN;

-- 3. Restaura a ancora de compatibilidade na leitura do proprio customer (Onda 3).
ALTER POLICY "Cliente le proprio customer" ON public.customers
  USING ((auth_user_id = auth.uid()) AND (store_id = public.default_store_id()));

-- 2. Restaura a leitura publica do catalogo ao estado da Onda 2 (so a loja padrao, ou a(s) loja(s)
-- que o requisitante administra).
DROP POLICY "Leitura pública produtos" ON public.products;
CREATE POLICY "Leitura pública produtos" ON public.products
  FOR SELECT
  USING (store_id = public.default_store_id() OR public.is_admin_of(store_id));

DROP POLICY "Leitura pública categorias" ON public.categories;
CREATE POLICY "Leitura pública categorias" ON public.categories
  FOR SELECT
  USING (store_id = public.default_store_id() OR public.is_admin_of(store_id));

DROP POLICY "Leitura pública adicionais" ON public.adicionais;
CREATE POLICY "Leitura pública adicionais" ON public.adicionais
  FOR SELECT
  USING (store_id = public.default_store_id() OR public.is_admin_of(store_id));

-- 1b. Remove store_ativo (predicado auxiliar das policies acima).
DROP FUNCTION IF EXISTS public.store_ativo(uuid);

-- 1. Remove get_store_by_domain.
DROP FUNCTION IF EXISTS public.get_store_by_domain(text);

COMMIT;
