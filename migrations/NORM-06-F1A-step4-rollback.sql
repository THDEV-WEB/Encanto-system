-- Rollback da Etapa 4 da F1A (NORM-06). ATOMICO. Remove apenas as constraints da Etapa 4.
-- Nao toca dados, tabela, coluna (exceto desfazer slug NOT NULL), indice de apoio, trigger ou policy.
BEGIN;

ALTER TABLE public.product_collections DROP CONSTRAINT IF EXISTS product_collections_collection_fk;
ALTER TABLE public.product_collections DROP CONSTRAINT IF EXISTS product_collections_product_fk;
ALTER TABLE public.product_collections DROP CONSTRAINT IF EXISTS product_collections_uk;

ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_sti_biz_chk;
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_sti_coll_chk;
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_estrategia_chk;
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_tipo_chk;
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_slug_uk;
ALTER TABLE public.categories ALTER COLUMN slug DROP NOT NULL;

COMMIT;
