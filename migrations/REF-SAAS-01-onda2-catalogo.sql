-- REF-SAAS-01 · Onda 2 — RLS + policies do catálogo (products/categories/adicionais/product_collections)
-- com predicado de store_id. Ver docs/adr/REF-SAAS-01-fundacao-multitenant.md §5/§6/§9/§11 e
-- docs/ref/REF-SAAS-01-plano-ondas.md (seção "Onda 2") para a auditoria e o racional completos.
--
-- Achado de auditoria que molda esta migration: nenhuma das 4 tabelas de catálogo é escrita via RPC
-- SECURITY DEFINER (diferente do resto do sistema) — o Admin escreve DIRETO via
-- supabase-js .insert()/.update()/.delete(), então toda a autorização de escrita mora nas policies
-- RLS. Os 3 upserts do Admin (upsertCat/upsertProd/upsertAd em src/services/DataService.js) NUNCA
-- setam store_id no payload — por isso store_id precisa de DEFAULT antes de qualquer policy passar
-- a exigi-lo, senão todo produto/categoria/adicional novo nasceria órfão (sem loja) e sumiria do
-- catálogo assim que a policy de leitura pública deixasse de ser `USING (true)`.

BEGIN;

-- Ponte de compatibilidade Onda 2→6 (mesmo papel do wrapper is_admin() da Onda 1): ancora a leitura
-- pública e o DEFAULT de store_id na loja "encanto" até o frontend resolver a loja explicitamente
-- (get_store_by_domain, Onda 6). SECURITY DEFINER pq `stores` está trancada sem policy (Onda 0) —
-- sem isso, a subconsulta abaixo executada como `anon`/`authenticated` sempre voltaria vazia.
CREATE FUNCTION public.default_store_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT id FROM public.stores WHERE slug = 'encanto';
$$;

-- store_id ganha DEFAULT nas 4 tabelas de catálogo — nenhum INSERT hoje o informa explicitamente.
ALTER TABLE public.products            ALTER COLUMN store_id SET DEFAULT public.default_store_id();
ALTER TABLE public.categories          ALTER COLUMN store_id SET DEFAULT public.default_store_id();
ALTER TABLE public.adicionais          ALTER COLUMN store_id SET DEFAULT public.default_store_id();
ALTER TABLE public.product_collections ALTER COLUMN store_id SET DEFAULT public.default_store_id();

-- Onda 0 já garantiu backfill 100% (zero NULL). Com o DEFAULT acima cobrindo todo INSERT futuro,
-- promove a NOT NULL agora (ADR §9.1) — nada mais depende da coluna ficar nullable nestas 4 tabelas.
ALTER TABLE public.products            ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE public.categories          ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE public.adicionais          ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE public.product_collections ALTER COLUMN store_id SET NOT NULL;

-- Uniques que hoje seriam globais passam a incluir store_id (ADR §9.4) — sem isso, a 2a loja nunca
-- poderia ter uma categoria "bebidas" ou um produto com o mesmo (nome, categoria) da 1a loja.
ALTER TABLE public.categories DROP CONSTRAINT categories_slug_uk;
ALTER TABLE public.categories ADD CONSTRAINT categories_store_slug_uk UNIQUE (store_id, slug);

ALTER TABLE public.products DROP CONSTRAINT unique_nome_categoria;
ALTER TABLE public.products ADD CONSTRAINT products_store_nome_categoria_uniq UNIQUE (store_id, nome, categoria_id);

ALTER TABLE public.adicionais DROP CONSTRAINT adicionais_nome_grupo_cat_uniq;
ALTER TABLE public.adicionais ADD CONSTRAINT adicionais_store_nome_grupo_cat_uniq UNIQUE (store_id, nome, grupo, aplica_categoria_id);

ALTER TABLE public.product_collections DROP CONSTRAINT product_collections_uk;
ALTER TABLE public.product_collections ADD CONSTRAINT product_collections_store_product_collection_uk UNIQUE (store_id, product_id, collection_id);

-- Leitura pública: era `USING (true)` — qualquer role, qualquer loja, sem predicado nenhum. Passa a
-- exigir ser a loja padrão (ponte Onda 2-6) OU ser admin daquela loja — padrão sugerido pelo ADR §11
-- (`store_id = <predicado> OR is_admin_of(store_id)`), que já deixa o admin de uma 2a loja futura
-- enxergar o próprio catálogo mesmo antes da Onda 5 trazer o seletor de loja no Admin.
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

DROP POLICY "Leitura pública coleções" ON public.product_collections;
CREATE POLICY "Leitura pública coleções" ON public.product_collections
  FOR SELECT
  USING (store_id = public.default_store_id() OR public.is_admin_of(store_id));

-- Escrita administrativa: is_admin() (boolean cego, nunca olhava a loja da linha) → is_admin_of(store_id)
-- — um admin de uma loja deixa de conseguir escrever linha de outra loja; super admin continua
-- passando em qualquer uma (composição já embutida em is_admin_of, ADR §4).
ALTER POLICY "Auth insert products" ON public.products WITH CHECK (public.is_admin_of(store_id));
ALTER POLICY "Auth update products" ON public.products USING (public.is_admin_of(store_id)) WITH CHECK (public.is_admin_of(store_id));
ALTER POLICY "Auth delete products" ON public.products USING (public.is_admin_of(store_id));

ALTER POLICY "Auth insert categories" ON public.categories WITH CHECK (public.is_admin_of(store_id));
ALTER POLICY "Auth update categories" ON public.categories USING (public.is_admin_of(store_id)) WITH CHECK (public.is_admin_of(store_id));
ALTER POLICY "Auth delete categories" ON public.categories USING (public.is_admin_of(store_id));

ALTER POLICY "Auth insert adicionais" ON public.adicionais WITH CHECK (public.is_admin_of(store_id));
ALTER POLICY "Auth update adicionais" ON public.adicionais USING (public.is_admin_of(store_id)) WITH CHECK (public.is_admin_of(store_id));
ALTER POLICY "Auth delete adicionais" ON public.adicionais USING (public.is_admin_of(store_id));

ALTER POLICY "Auth insert product_collections" ON public.product_collections WITH CHECK (public.is_admin_of(store_id));
ALTER POLICY "Auth update product_collections" ON public.product_collections USING (public.is_admin_of(store_id)) WITH CHECK (public.is_admin_of(store_id));
ALTER POLICY "Auth delete product_collections" ON public.product_collections USING (public.is_admin_of(store_id));

COMMIT;
