-- ADR REF-ADDRESS-02 · Onda 1 — Schema estruturado de endereço (fundação)
-- Aditivo, idempotente, reversível (companion: REF-ADDRESS-02-onda1-schema-rollback.sql).
-- NÃO altera orders.address (texto), NÃO altera create_order, NÃO altera checkout.
-- Ground truth via introspecção direta (2026-07-27): addresses = {id, customer_id, rua, numero,
-- bairro, cidade, complemento, created_at}, 0 linhas, RLS ligada SEM NENHUMA policy (grants de
-- authenticated já existiam, mas ficavam bloqueados pela RLS por falta de policy). orders já tem
-- endereco_id uuid + FK orders_endereco_id_fkey -> addresses(id) (0/80 pedidos usam) — reaproveitada
-- aqui em vez de criar uma coluna nova.

BEGIN;

-- 1) Colunas novas em addresses (modelo já usado em memória por addressModel.js, faltando persistir)
ALTER TABLE public.addresses
  ADD COLUMN IF NOT EXISTS estado text,
  ADD COLUMN IF NOT EXISTS cep text,
  ADD COLUMN IF NOT EXISTS referencia text,
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS place_id text,
  ADD COLUMN IF NOT EXISTS formatted_address text,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS confidence text;

-- 2) Confidence só pode ser um dos 3 níveis definidos no ADR §4.1 (ou NULL, p/ dado legado)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'addresses_confidence_check') THEN
    ALTER TABLE public.addresses
      ADD CONSTRAINT addresses_confidence_check
      CHECK (confidence IS NULL OR confidence IN ('exact', 'street_level', 'approximate'));
  END IF;
END $$;

-- 3) Policy authenticated (admin) — grants de tabela já existiam; faltava a policy (RLS sem policy = deny total)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'addresses' AND policyname = 'Auth all addresses'
  ) THEN
    CREATE POLICY "Auth all addresses" ON public.addresses FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 4) RPC única de escrita (mesmo molde de create_order): anon não tem grant de tabela em addresses
--    (revogado desde HARDEN-ORDERS-RLS-step2.sql) — só cria endereço estruturado via esta função.
CREATE OR REPLACE FUNCTION public.save_structured_address(p_address jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF p_address IS NULL OR jsonb_typeof(p_address) <> 'object' THEN
    RAISE EXCEPTION 'p_address ausente/invalido';
  END IF;

  INSERT INTO public.addresses (
    customer_id, rua, numero, bairro, cidade, complemento,
    estado, cep, referencia, latitude, longitude,
    place_id, formatted_address, provider, confidence
  ) VALUES (
    NULLIF(btrim(p_address->>'customer_id'), '')::uuid,
    NULLIF(btrim(p_address->>'rua'), ''),
    NULLIF(btrim(p_address->>'numero'), ''),
    NULLIF(btrim(p_address->>'bairro'), ''),
    NULLIF(btrim(p_address->>'cidade'), ''),
    NULLIF(btrim(p_address->>'complemento'), ''),
    NULLIF(btrim(p_address->>'estado'), ''),
    NULLIF(btrim(p_address->>'cep'), ''),
    NULLIF(btrim(p_address->>'referencia'), ''),
    NULLIF(p_address->>'latitude', '')::double precision,
    NULLIF(p_address->>'longitude', '')::double precision,
    NULLIF(btrim(p_address->>'place_id'), ''),
    NULLIF(btrim(p_address->>'formatted_address'), ''),
    NULLIF(btrim(p_address->>'provider'), ''),
    NULLIF(btrim(p_address->>'confidence'), '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_structured_address(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_structured_address(jsonb) TO anon, authenticated;

-- 5) Índice p/ joins do admin (coluna/FK já existiam sem índice)
CREATE INDEX IF NOT EXISTS orders_endereco_id_idx ON public.orders (endereco_id);

COMMIT;

-- Verificação pós-aplicação (rodar manualmente se aplicar fora do runner administrativo):
-- SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='addresses' ORDER BY ordinal_position;
-- SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='addresses';
-- SELECT proname FROM pg_proc WHERE proname='save_structured_address';
