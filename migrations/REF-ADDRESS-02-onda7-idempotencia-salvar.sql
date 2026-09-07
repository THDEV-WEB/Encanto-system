-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- REF-ADDRESS-02 · Onda 7 — save_structured_address() ganha idempotencia por client_token.
--
-- CONTEXTO: pedido real da Encanto (2026-09-07, id 2d198524-9183-4215-9fcc-4495aa85a917) chegou com
-- endereco_id NULL e delivery_fee=0.00 -- investigacao confirmou que o endereco nunca foi persistido
-- (nao existe em public.addresses). addressRepository.salvar() (client) tem timeout defensivo mas
-- NUNCA reitenta -- uma falha transitoria de rede (comum em conexao movel/wifi fraco, cenario comum
-- em delivery) e' silenciosa: o pedido segue sem bloquear (decisao correta, ja documentada desde
-- REF-ADDRESS-02 Onda 6), mas a taxa de entrega fica R$0 ate o dono resolver manualmente com o
-- cliente pelo WhatsApp.
--
-- DECISAO (dono, 2026-09-07): adicionar RETRY automatico no client para reduzir a chance desse
-- cenario -- SEM bloquear o "Finalizar Pedido" (opcao descartada: risco de perder vendas de clientes
-- com internet instavel e' maior que o risco de ocasionalmente perder uma taxa de entrega,
-- recuperavel manualmente).
--
-- POR QUE NAO BASTA UM RETRY "CEGO": save_structured_address() faz um INSERT puro, sem protecao
-- nenhuma contra duplicacao -- se o SERVIDOR salvar com sucesso mas a RESPOSTA nao voltar a tempo
-- (timeout na volta, nao na ida -- cenario real, nao hipotetico), um retry ingenuo criaria um
-- SEGUNDO endereco identico no banco. Corrigido com idempotencia de verdade (mesmo principio ja
-- usado em create_order via request_id): client_token opcional, gerado UMA VEZ por tentativa de
-- salvar (client, ver addressRepository.js) e reenviado identico em cada retry -- upsert por esse
-- token garante que retries NUNCA duplicam.
--
-- BACKWARD-COMPATIBLE: client_token e' OPCIONAL. Chamador que nao envia (nenhum client_token no
-- payload) mantem o comportamento EXATO de sempre -- sempre insere uma linha nova, nunca upsert.
-- Zero mudanca para os ~80+ enderecos ja salvos sem esse campo.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE public.addresses ADD COLUMN IF NOT EXISTS client_token uuid;

-- Indice UNICO PARCIAL: so' exige unicidade quando o token esta presente -- enderecos antigos
-- (client_token NULL) nunca conflitam entre si, nem com o novo fluxo.
CREATE UNIQUE INDEX IF NOT EXISTS addresses_client_token_key
  ON public.addresses (client_token) WHERE client_token IS NOT NULL;

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
  v_client_token uuid;
BEGIN
  IF p_address IS NULL OR jsonb_typeof(p_address) <> 'object' THEN
    RAISE EXCEPTION 'p_address ausente/invalido';
  END IF;

  IF NOT public._rate_limit_hit('save_structured_address', 60, interval '10 minutes') THEN
    RAISE EXCEPTION 'muitas tentativas, aguarde um momento';
  END IF;

  v_tenant_id := NULLIF(auth.jwt()->>'tenant_id', '')::uuid;
  v_customer_id := NULLIF(btrim(p_address->>'customer_id'), '')::uuid;
  v_client_token := NULLIF(btrim(p_address->>'client_token'), '')::uuid;

  IF v_customer_id IS NOT NULL THEN
    SELECT c.store_id INTO v_store_id
    FROM public.customers c
    WHERE c.id = v_customer_id
      AND c.auth_user_id = auth.uid()
      AND (v_tenant_id IS NULL OR c.store_id = v_tenant_id);

    IF v_store_id IS NULL THEN
      v_customer_id := NULL;
    END IF;
  END IF;

  IF v_store_id IS NULL THEN
    v_store_id := public.resolve_store_from_origin();
    IF v_store_id IS NULL THEN
      RAISE EXCEPTION 'loja nao identificada';
    END IF;
  END IF;

  -- REF-ADDRESS-02 · Onda 7: com client_token, upsert idempotente -- retry do mesmo client NUNCA
  -- duplica. Sem client_token (chamador antigo), comportamento intacto (sempre insere novo).
  IF v_client_token IS NOT NULL THEN
    INSERT INTO public.addresses (
      customer_id, store_id, rua, numero, bairro, cidade, complemento,
      estado, cep, referencia, latitude, longitude,
      place_id, formatted_address, provider, confidence, client_token
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
      NULLIF(btrim(p_address->>'confidence'), ''),
      v_client_token
    )
    ON CONFLICT (client_token) WHERE client_token IS NOT NULL DO UPDATE SET
      rua = excluded.rua, numero = excluded.numero, bairro = excluded.bairro,
      cidade = excluded.cidade, complemento = excluded.complemento, estado = excluded.estado,
      cep = excluded.cep, referencia = excluded.referencia, latitude = excluded.latitude,
      longitude = excluded.longitude, place_id = excluded.place_id,
      formatted_address = excluded.formatted_address, provider = excluded.provider,
      confidence = excluded.confidence
    RETURNING id INTO v_id;
  ELSE
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
  END IF;

  RETURN v_id;
END;
$function$;

COMMIT;
