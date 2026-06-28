-- Rollback da Etapa 2 da F1A (NORM-06). ATOMICO. Desfaz exatamente o NORM-06-F1A-step2.sql.
-- (Restaurar tambem o snapshot da Etapa 0 se necessario: snapshot-NORM-06-F1A-*.json)
BEGIN;

DROP POLICY IF EXISTS pc_public_read ON public.product_collections;
DROP TABLE IF EXISTS public.product_collections;

ALTER TABLE public.categories
  DROP COLUMN IF EXISTS ends_at,
  DROP COLUMN IF EXISTS starts_at,
  DROP COLUMN IF EXISTS definicao,
  DROP COLUMN IF EXISTS estrategia,
  DROP COLUMN IF EXISTS tipo,
  DROP COLUMN IF EXISTS banner,
  DROP COLUMN IF EXISTS imagem,
  DROP COLUMN IF EXISTS descricao,
  DROP COLUMN IF EXISTS slug;

COMMIT;
