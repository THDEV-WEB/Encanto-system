-- Rollback de REF-ADDRESS-SEC-01-isolamento.sql — volta a policy antiga (INSEGURA, USING(true)) e o
-- comportamento anterior de save_structured_address (confia no customer_id cru do payload). Usar
-- SOMENTE se a migration nova causar uma regressao real e inesperada — reintroduz o vazamento
-- documentado na auditoria (qualquer autenticado le/altera/apaga endereco de qualquer outro cliente).
-- O indice em customer_id e mantido mesmo em rollback (aditivo, inofensivo, nao reintroduz o problema).

BEGIN;

DROP POLICY IF EXISTS "addresses_select_own" ON public.addresses;
DROP POLICY IF EXISTS "addresses_insert_own" ON public.addresses;
DROP POLICY IF EXISTS "addresses_update_own" ON public.addresses;
DROP POLICY IF EXISTS "addresses_delete_own" ON public.addresses;

GRANT TRUNCATE, REFERENCES, TRIGGER ON public.addresses TO authenticated;

CREATE POLICY "Auth all addresses" ON public.addresses FOR ALL TO authenticated USING (true) WITH CHECK (true);

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

COMMIT;
