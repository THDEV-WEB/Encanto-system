-- Rollback ADR REF-ADDRESS-02 · Onda 1
-- Desfaz exatamente o que REF-ADDRESS-02-onda1-schema.sql criou. NÃO toca orders.endereco_id
-- (coluna/FK pré-existentes a esta migration, não criados por ela).

BEGIN;

DROP INDEX IF EXISTS public.orders_endereco_id_idx;

REVOKE EXECUTE ON FUNCTION public.save_structured_address(jsonb) FROM anon, authenticated;
DROP FUNCTION IF EXISTS public.save_structured_address(jsonb);

DROP POLICY IF EXISTS "Auth all addresses" ON public.addresses;

ALTER TABLE public.addresses DROP CONSTRAINT IF EXISTS addresses_confidence_check;

ALTER TABLE public.addresses
  DROP COLUMN IF EXISTS estado,
  DROP COLUMN IF EXISTS cep,
  DROP COLUMN IF EXISTS referencia,
  DROP COLUMN IF EXISTS latitude,
  DROP COLUMN IF EXISTS longitude,
  DROP COLUMN IF EXISTS place_id,
  DROP COLUMN IF EXISTS formatted_address,
  DROP COLUMN IF EXISTS provider,
  DROP COLUMN IF EXISTS confidence;

COMMIT;
