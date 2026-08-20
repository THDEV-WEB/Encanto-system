-- REF-ADDRESS-STOREID-01 · Onda 1 (Parte B) — save_structured_address() passa a derivar store_id
-- do Origin real da requisicao (mesma tecnica/funcao ja validada em producao pelo create_order(),
-- ver REF-ORDER-TENANT-01) sempre que nao ha customer_id valido (guest, ou fallback de
-- ownership/tenant que ja existia). Nunca confia em store_id vindo do client -- p_address nunca
-- carregou esse campo, e continua sem carregar.
--
-- Comportamento anterior: quando v_customer_id ficava NULL (guest, ou ownership/tenant coherence
-- falhou), v_store_id tambem ficava NULL -- endereco gravado orfao, sem loja (mesmo drift que a
-- Parte A desta REF corrigiu retroativamente pra 8 linhas historicas).
--
-- Comportamento novo: nesse mesmo caso, deriva v_store_id de resolve_store_from_origin() (fail-closed
-- -- sem Origin reconhecido, rejeita com excecao). addressRepository.salvar() ja trata qualquer erro
-- do RPC como falha silenciosa (retorna null) -- o checkout nunca foi bloqueado por isso e continua
-- nao sendo (CheckoutPage.jsx: enderecoId fica null, pedido segue com o texto do endereco mesmo assim).
--
-- Caso autenticado com customer_id valido (ownership + coerencia de tenant quando presente) continua
-- 100% intocado -- so o ramo que ja ficava com store_id NULL passa a resolver via Origin.

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

  -- REF-ADDRESS-STOREID-01 Parte B: guest (ou fallback acima) deriva store_id do Origin real da
  -- requisição via resolve_store_from_origin() -- nunca de parâmetro do client, que este payload
  -- nem carrega. Fail-closed: Origin desconhecido/ausente rejeita em vez de gravar órfão de novo.
  IF v_store_id IS NULL THEN
    v_store_id := public.resolve_store_from_origin();
    IF v_store_id IS NULL THEN
      RAISE EXCEPTION 'loja nao identificada';
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
