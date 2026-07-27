-- Rollback ADR REF-ADDRESS-02 · Onda 4
-- Desfaz exatamente o que REF-ADDRESS-02-onda4-gazetteer.sql criou. NÃO remove a extensão pg_trgm
-- (barata de manter; outra coisa pode passar a depender dela — dropar é o passo mais arriscado e
-- menos necessário de desfazer).

BEGIN;

REVOKE EXECUTE ON FUNCTION public.buscar_gazetteer(text, text, int) FROM anon, authenticated;
DROP FUNCTION IF EXISTS public.buscar_gazetteer(text, text, int);

DROP POLICY IF EXISTS "Leitura publica gazetteer" ON public.address_gazetteer;
DROP POLICY IF EXISTS "Escrita admin gazetteer" ON public.address_gazetteer;

DROP TABLE IF EXISTS public.address_gazetteer;

DROP FUNCTION IF EXISTS public.immutable_unaccent(text);

COMMIT;
