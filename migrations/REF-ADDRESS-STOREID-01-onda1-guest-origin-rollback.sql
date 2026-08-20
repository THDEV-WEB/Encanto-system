-- Rollback de REF-ADDRESS-STOREID-01-onda1-guest-origin.sql
-- Restaura save_structured_address() ao estado exato de antes (guest/fallback volta a gravar
-- store_id NULL, sem derivar do Origin).

CREATE OR REPLACE FUNCTION public.save_structured_address(p_address jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_id uuid;
  v_customer_id uuid;
  v_tenant_id uuid;
  v_store_id uuid;
BEGIN
  IF p_address IS NULL OR jsonb_typeof(p_address) <> 'object' THEN
    RAISE EXCEPTION 'p_address ausente/invalido';
  END IF;

  v_tenant_id := NULLIF(auth.jwt()->>'tenant_id', '')::uuid;
  v_customer_id := NULLIF(btrim(p_address->>'customer_id'), '')::uuid;

  IF v_customer_id IS NOT NULL THEN
    -- Deriva store_id do PRÓPRIO customer validado (nunca de parâmetro do client). Quando há
    -- tenant_id no JWT, exige coerência extra: o customer precisa pertencer à loja do tenant ativo
    -- (sessão da Encanto não pode gravar endereço vinculado ao customer da Bar, mesmo sendo a MESMA
    -- pessoa nas duas). Sem tenant_id (Hook desligado, caso de produção hoje), cai pro comportamento
    -- já correto de confiar no customers.store_id do customer_id validado.
    SELECT c.store_id INTO v_store_id
    FROM public.customers c
    WHERE c.id = v_customer_id
      AND c.auth_user_id = auth.uid()
      AND (v_tenant_id IS NULL OR c.store_id = v_tenant_id);

    IF v_store_id IS NULL THEN
      v_customer_id := NULL; -- ownership ou coerencia de tenant falhou -> mesmo fallback silencioso de sempre (vira orfao)
    END IF;
  END IF;

  INSERT INTO public.addresses (
    customer_id, store_id, rua, numero, bairro, cidade, complemento,
    estado, cep, referencia, latitude, longitude,
    place_id, formatted_address, provider, confidence
  ) VALUES (
    v_customer_id, v_store_id,
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
