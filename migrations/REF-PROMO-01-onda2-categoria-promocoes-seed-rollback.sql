-- ROLLBACK · REF-PROMO-01 · Onda 2
-- Remove a categoria "Promoções" -- so' e' seguro rodar se nenhum produto ainda referenciar 'promocoes'
-- em categoria_id/categoria_ids (trg_categoria_delete_guard ja bloqueia o DELETE nesse caso, fail-safe).

BEGIN;

DELETE FROM public.categories WHERE id = 'promocoes' AND store_id = '8604324d-0529-443d-aa79-4337057bfa01';

COMMIT;
