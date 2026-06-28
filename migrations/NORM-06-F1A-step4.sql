-- NORM-06 · F1A · Etapa 4 — Constraints (categories STI/slug + product_collections UNIQUE/FK)
-- ATOMICO (BEGIN/COMMIT). Sem IF NOT EXISTS em ADD CONSTRAINT (1a aplicacao; rollback dedicado).
-- Corresponde ao ADR NORM-06 sec.7 F1A "Constraints" / NORM-06A sec.2.1 e sec.2.3 (verbatim).
-- NAO cria/altera tabela, coluna, indice (alem do indice implicito das UNIQUE), trigger ou policy.
-- NAO corrige dados (a Etapa 4 so adiciona restricoes; pre-validacao garante conformidade).
-- Rollback: migrations/NORM-06-F1A-step4-rollback.sql
BEGIN;

-- categories: slug obrigatorio + unico
ALTER TABLE public.categories ALTER COLUMN slug SET NOT NULL;
ALTER TABLE public.categories ADD CONSTRAINT categories_slug_uk UNIQUE (slug);

-- categories: CHECKs STI (NORM-06A sec.2.1, verbatim)
ALTER TABLE public.categories ADD CONSTRAINT categories_tipo_chk
  CHECK (tipo IN ('business','collection'));
ALTER TABLE public.categories ADD CONSTRAINT categories_estrategia_chk
  CHECK (estrategia IN ('manual','rule','smart'));
ALTER TABLE public.categories ADD CONSTRAINT categories_sti_coll_chk
  CHECK (tipo='collection' OR (estrategia IS NULL AND definicao IS NULL AND starts_at IS NULL AND ends_at IS NULL));
ALTER TABLE public.categories ADD CONSTRAINT categories_sti_biz_chk
  CHECK (tipo='business' OR estrategia IS NOT NULL);

-- product_collections: unicidade da associacao + FKs (NORM-06A sec.2.3)
ALTER TABLE public.product_collections ADD CONSTRAINT product_collections_uk
  UNIQUE (product_id, collection_id);
ALTER TABLE public.product_collections ADD CONSTRAINT product_collections_product_fk
  FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
ALTER TABLE public.product_collections ADD CONSTRAINT product_collections_collection_fk
  FOREIGN KEY (collection_id) REFERENCES public.categories(id) ON DELETE CASCADE;

COMMIT;
