-- Rollback da NORM-06.1 (HARDEN-RLS). ATÔMICO. Remove as policies novas e RESTAURA a provisória pc_public_read.
-- Volta exatamente ao estado pré-NORM-06.1 (§0 do ADR). NÃO toca tabela/coluna/dado/trigger.
-- ⚠️ NOTA: reverter DROPa a escrita authenticated de categories — combinado com a F1B (FOR SHARE), reverter
--   SEM reverter também a errata-01 deixa o STI dependente de RLS de novo. Para reverter o bloco F1 inteiro,
--   reverter na ordem: NORM-06.1-step1-rollback -> NORM-06-F1B-errata-01-...-rollback -> NORM-06-F1B-step1-rollback.
BEGIN;

DROP POLICY IF EXISTS "Auth insert categories" ON public.categories;
DROP POLICY IF EXISTS "Auth update categories" ON public.categories;
DROP POLICY IF EXISTS "Auth delete categories" ON public.categories;

DROP POLICY IF EXISTS "Auth insert adicionais" ON public.adicionais;
DROP POLICY IF EXISTS "Auth update adicionais" ON public.adicionais;
DROP POLICY IF EXISTS "Auth delete adicionais" ON public.adicionais;

DROP POLICY IF EXISTS "Auth insert product_collections" ON public.product_collections;
DROP POLICY IF EXISTS "Auth update product_collections" ON public.product_collections;
DROP POLICY IF EXISTS "Auth delete product_collections" ON public.product_collections;
DROP POLICY IF EXISTS "Leitura pública coleções" ON public.product_collections;

-- restaura a policy provisória da F1A
DROP POLICY IF EXISTS pc_public_read ON public.product_collections;
CREATE POLICY pc_public_read ON public.product_collections FOR SELECT TO public USING (true);

COMMIT;
