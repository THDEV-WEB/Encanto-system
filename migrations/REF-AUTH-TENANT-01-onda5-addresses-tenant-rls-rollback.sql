-- Rollback da Onda 5 de REF-AUTH-TENANT-01.
-- Restaura EXATAMENTE as 4 policies da SEC-01 (customer_id -> auth.uid(), sem escopo de loja) e a
-- versao de save_structured_address anterior a esta onda (sem store_id/tenant_id).

BEGIN;

DROP POLICY IF EXISTS "addresses_select_tenant" ON public.addresses;
DROP POLICY IF EXISTS "addresses_insert_tenant" ON public.addresses;
DROP POLICY IF EXISTS "addresses_update_tenant" ON public.addresses;
DROP POLICY IF EXISTS "addresses_delete_tenant" ON public.addresses;

CREATE POLICY "addresses_select_own" ON public.addresses FOR SELECT TO authenticated
  USING (customer_id IN (SELECT c.id FROM public.customers c WHERE c.auth_user_id = auth.uid()));
CREATE POLICY "addresses_insert_own" ON public.addresses FOR INSERT TO authenticated
  WITH CHECK (customer_id IS NULL OR customer_id IN (SELECT c.id FROM public.customers c WHERE c.auth_user_id = auth.uid()));
CREATE POLICY "addresses_update_own" ON public.addresses FOR UPDATE TO authenticated
  USING (customer_id IN (SELECT c.id FROM public.customers c WHERE c.auth_user_id = auth.uid()))
  WITH CHECK (customer_id IN (SELECT c.id FROM public.customers c WHERE c.auth_user_id = auth.uid()));
CREATE POLICY "addresses_delete_own" ON public.addresses FOR DELETE TO authenticated
  USING (customer_id IN (SELECT c.id FROM public.customers c WHERE c.auth_user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.save_structured_address(p_address jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_id uuid;
  v_customer_id uuid;
BEGIN
  IF p_address IS NULL OR jsonb_typeof(p_address) <> 'object' THEN
    RAISE EXCEPTION 'p_address ausente/invalido';
  END IF;

  v_customer_id := NULLIF(btrim(p_address->>'customer_id'), '')::uuid;
  IF v_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers c WHERE c.id = v_customer_id AND c.auth_user_id = auth.uid()
  ) THEN
    v_customer_id := NULL;
  END IF;

  INSERT INTO public.addresses (
    customer_id, rua, numero, bairro, cidade, complemento,
    estado, cep, referencia, latitude, longitude,
    place_id, formatted_address, provider, confidence
  ) VALUES (
    v_customer_id,
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

COMMIT;
