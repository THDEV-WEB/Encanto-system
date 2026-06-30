-- Rollback da Etapa 3 da F1A (NORM-06). ATOMICO. Remove apenas os 2 indices criados na Etapa 3.
-- Nao toca tabela/colunas/constraints/policy/trigger.
BEGIN;
DROP INDEX IF EXISTS public.pc_product_idx;
DROP INDEX IF EXISTS public.pc_collection_idx;
COMMIT;
