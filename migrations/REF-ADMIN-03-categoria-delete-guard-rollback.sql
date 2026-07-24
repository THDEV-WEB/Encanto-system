-- Rollback do REF-ADMIN-03 · Onda 1. ATOMICO. Remove a trigger, a funcao e o indice adicionados.
-- NAO toca nenhuma outra tabela/coluna/constraint/policy/dado. As triggers STI do NORM-06-F1B
-- permanecem intactas (arquivos separados).
BEGIN;

DROP TRIGGER IF EXISTS trg_categoria_delete ON public.categories;
DROP FUNCTION IF EXISTS public.trg_categoria_delete_guard();
DROP INDEX IF EXISTS public.products_categoria_ids_gin_idx;

COMMIT;
