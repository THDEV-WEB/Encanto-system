-- REF-SAAS-01 · Onda 2 — Rollback: restaura policies originais (is_admin() sem predicado de loja,
-- leitura pública USING(true)), uniques globais sem store_id, store_id nullable/sem DEFAULT, remove
-- default_store_id().

BEGIN;

-- Escrita administrativa: volta a is_admin() (sem checar a loja da linha).
ALTER POLICY "Auth insert products" ON public.products WITH CHECK (public.is_admin());
ALTER POLICY "Auth update products" ON public.products USING (public.is_admin()) WITH CHECK (public.is_admin());
ALTER POLICY "Auth delete products" ON public.products USING (public.is_admin());

ALTER POLICY "Auth insert categories" ON public.categories WITH CHECK (public.is_admin());
ALTER POLICY "Auth update categories" ON public.categories USING (public.is_admin()) WITH CHECK (public.is_admin());
ALTER POLICY "Auth delete categories" ON public.categories USING (public.is_admin());

ALTER POLICY "Auth insert adicionais" ON public.adicionais WITH CHECK (public.is_admin());
ALTER POLICY "Auth update adicionais" ON public.adicionais USING (public.is_admin()) WITH CHECK (public.is_admin());
ALTER POLICY "Auth delete adicionais" ON public.adicionais USING (public.is_admin());

ALTER POLICY "Auth insert product_collections" ON public.product_collections WITH CHECK (public.is_admin());
ALTER POLICY "Auth update product_collections" ON public.product_collections USING (public.is_admin()) WITH CHECK (public.is_admin());
ALTER POLICY "Auth delete product_collections" ON public.product_collections USING (public.is_admin());

-- Leitura pública: volta a USING(true).
DROP POLICY "Leitura pública produtos" ON public.products;
CREATE POLICY "Leitura pública produtos" ON public.products FOR SELECT USING (true);

DROP POLICY "Leitura pública categorias" ON public.categories;
CREATE POLICY "Leitura pública categorias" ON public.categories FOR SELECT USING (true);

DROP POLICY "Leitura pública adicionais" ON public.adicionais;
CREATE POLICY "Leitura pública adicionais" ON public.adicionais FOR SELECT USING (true);

DROP POLICY "Leitura pública coleções" ON public.product_collections;
CREATE POLICY "Leitura pública coleções" ON public.product_collections FOR SELECT USING (true);

-- Uniques voltam ao formato global (sem store_id).
ALTER TABLE public.product_collections DROP CONSTRAINT product_collections_store_product_collection_uk;
ALTER TABLE public.product_collections ADD CONSTRAINT product_collections_uk UNIQUE (product_id, collection_id);

ALTER TABLE public.adicionais DROP CONSTRAINT adicionais_store_nome_grupo_cat_uniq;
ALTER TABLE public.adicionais ADD CONSTRAINT adicionais_nome_grupo_cat_uniq UNIQUE (nome, grupo, aplica_categoria_id);

ALTER TABLE public.products DROP CONSTRAINT products_store_nome_categoria_uniq;
ALTER TABLE public.products ADD CONSTRAINT unique_nome_categoria UNIQUE (nome, categoria_id);

ALTER TABLE public.categories DROP CONSTRAINT categories_store_slug_uk;
ALTER TABLE public.categories ADD CONSTRAINT categories_slug_uk UNIQUE (slug);

-- store_id volta a nullable, sem DEFAULT.
ALTER TABLE public.product_collections ALTER COLUMN store_id DROP NOT NULL;
ALTER TABLE public.adicionais            ALTER COLUMN store_id DROP NOT NULL;
ALTER TABLE public.categories            ALTER COLUMN store_id DROP NOT NULL;
ALTER TABLE public.products              ALTER COLUMN store_id DROP NOT NULL;

ALTER TABLE public.product_collections ALTER COLUMN store_id DROP DEFAULT;
ALTER TABLE public.adicionais            ALTER COLUMN store_id DROP DEFAULT;
ALTER TABLE public.categories            ALTER COLUMN store_id DROP DEFAULT;
ALTER TABLE public.products              ALTER COLUMN store_id DROP DEFAULT;

DROP FUNCTION IF EXISTS public.default_store_id();

COMMIT;
