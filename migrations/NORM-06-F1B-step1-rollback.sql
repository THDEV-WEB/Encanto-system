-- Rollback da Etapa 2 da F1B (NORM-06). ATOMICO. Remove apenas as 4 triggers + 4 funcoes STI.
-- NAO toca tabela, coluna, indice, constraint, policy ou dados. O schema da F1A permanece intacto.
BEGIN;

DROP TRIGGER IF EXISTS trg_sti_categoria_tipo     ON public.categories;
DROP TRIGGER IF EXISTS trg_sti_adicional_categoria ON public.adicionais;
DROP TRIGGER IF EXISTS trg_sti_product_categoria   ON public.products;
DROP TRIGGER IF EXISTS trg_sti_pc_collection       ON public.product_collections;

DROP FUNCTION IF EXISTS public.trg_sti_categoria_tipo_guard();
DROP FUNCTION IF EXISTS public.trg_sti_adicional_categoria_is_business();
DROP FUNCTION IF EXISTS public.trg_sti_product_categoria_is_business();
DROP FUNCTION IF EXISTS public.trg_sti_pc_collection_is_collection();

COMMIT;
