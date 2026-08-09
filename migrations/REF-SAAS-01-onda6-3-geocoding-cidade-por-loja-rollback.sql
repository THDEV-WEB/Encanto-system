-- REF-SAAS-01 · Onda 6.3 — ROLLBACK. Remove as chaves cidade/estado semeadas para a Encanto,
-- restaurando o company_info exatamente ao estado anterior a esta migration (nenhuma dessas 2 chaves
-- existia antes).

BEGIN;

UPDATE public.store_settings
SET valor = (valor::jsonb - 'cidade' - 'estado')::text
WHERE store_id = (SELECT id FROM public.stores WHERE slug = 'encanto')
  AND chave = 'company_info';

COMMIT;
