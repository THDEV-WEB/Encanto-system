-- REF-SEC-02 · Onda 1 -- rate limiting nas RPCs publicas mais sensiveis (create_order,
-- save_structured_address), ambas anon-callable sem sessao alguma. Ate aqui, um script poderia
-- martelar essas RPCs sem nenhuma friccao -- alem de poluir dados, o pipeline de notificacao
-- WhatsApp (pg_cron, ver REF-ORDER-01) dispararia pra CADA pedido forjado, potencial spam real no
-- WhatsApp do dono da loja.
--
-- Chave de identidade: cf-connecting-ip (header que o proprio Cloudflare da borda do Supabase
-- SEMPRE sobrescreve com o IP real da conexao TCP, nunca confia no que o client manda -- testado
-- empiricamente em ambiente E2E: enviei X-Forwarded-For/X-Real-IP forjados via curl, cf-connecting-ip
-- continuou refletindo meu IP real). Mais forte que Origin (que so e' protegido pelo navegador --
-- curl/scripts ainda conseguem forjar Origin; cf-connecting-ip nao, nem por eles).
--
-- Limiar: 60 chamadas por IP a cada 10 minutos, por bucket (RPC). Calibrado empiricamente: a propria
-- suite E2E completa (fixtures de ~15-20 specs, todas da MESMA maquina/IP) gerou 33 chamadas reais de
-- create_order em ~9 minutos -- um primeiro limiar de 20/10min cascateou falha em varios specs sem
-- nenhum bug real por tras, so calibracao conservadora demais. 60/10min folga com margem confortavel
-- sobre esse pico real observado, e continua MUITO abaixo do volume real da loja hoje (1-3 pedidos/
-- HORA no total) e de qualquer flood de verdade (um script malicioso tentaria centenas/milhares por
-- minuto, nao dezenas em 10min) -- nunca pegaria clientes reais mesmo atras de CGNAT compartilhado
-- (comum em operadora movel no Brasil).
--
-- Fail-open: qualquer erro dentro do proprio rate limiter (GUC ausente, tabela indisponivel, etc.)
-- SEMPRE libera a chamada -- nunca um bug no limiter pode bloquear um pedido real.

CREATE TABLE IF NOT EXISTS public.rate_limit_hits (
  id bigserial PRIMARY KEY,
  bucket text NOT NULL,
  ip_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rate_limit_hits_bucket_ip_created_idx
  ON public.rate_limit_hits (bucket, ip_key, created_at);

ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;
-- Zero policy de proposito (default-deny): so a funcao SECURITY DEFINER abaixo toca esta tabela.
-- Nunca fica exposta via /rest/v1/rate_limit_hits mesmo que o schema tenha default privilege pra
-- anon/authenticated (mesmo padrao observado em application_logs).

CREATE OR REPLACE FUNCTION public._rate_limit_hit(p_bucket text, p_max int, p_window interval)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_ip    text;
  v_count int;
BEGIN
  v_ip := current_setting('request.headers', true)::json->>'cf-connecting-ip';
  IF v_ip IS NULL OR btrim(v_ip) = '' THEN
    RETURN true; -- sem IP identificavel (fora do PostgREST/Cloudflare, ex.: teste local) -> nao bloqueia
  END IF;

  INSERT INTO public.rate_limit_hits (bucket, ip_key) VALUES (p_bucket, v_ip);

  SELECT count(*) INTO v_count
  FROM public.rate_limit_hits
  WHERE bucket = p_bucket AND ip_key = v_ip AND created_at > now() - p_window;

  RETURN v_count <= p_max;
EXCEPTION WHEN OTHERS THEN
  RETURN true; -- fail-open
END;
$function$;
-- REVOKE explicito: Supabase concede EXECUTE a anon/authenticated por padrao em toda funcao nova do
-- schema public (achado real, confirmado por introspeccao apos a 1a aplicacao) -- sem isto,
-- _rate_limit_hit(text,int,interval) viraria uma RPC publica chamavel direto
-- (/rest/v1/rpc/_rate_limit_hit) com p_bucket/p_max/p_window arbitrarios do client, quebrando a
-- intencao de ser so alcancavel de dentro de create_order/save_structured_address (mesmo padrao ja
-- usado por loyalty_grant/enc_dispatch_notifications/purge_old_logs, todas so postgres/service_role).
REVOKE EXECUTE ON FUNCTION public._rate_limit_hit(text, int, interval) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rate_limit_purge()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  DELETE FROM public.rate_limit_hits WHERE created_at < now() - interval '1 hour';
$function$;
REVOKE EXECUTE ON FUNCTION public.rate_limit_purge() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('encanto-rate-limit-purge', '0 * * * *', 'SELECT public.rate_limit_purge();');

-- === create_order(): rate-check logo apos o curto-circuito de idempotencia, antes de qualquer
-- resolucao de loja/validacao de negocio. Corpo restante byte-identico ao anterior (ORDER-TENANT-01),
-- so a chamada nova + o branch de retorno foram inseridos. ===
CREATE OR REPLACE FUNCTION public.create_order(p_customer jsonb, p_order jsonb, p_items jsonb, p_request_id uuid DEFAULT NULL::uuid, p_store_id uuid DEFAULT default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_customer_id uuid; v_order_id uuid;
  v_name   text := nullif(btrim(p_customer->>'name'), '');
  v_phone  text := public.normalize_phone(p_customer->>'phone');
  v_total  numeric;
  v_pay    text := nullif(btrim(p_order->>'payment_method'), '');
  v_addr   text := nullif(btrim(p_order->>'address'), '');
  v_status text := coalesce(nullif(btrim(p_order->>'status'), ''), 'recebido');
  v_obs    text := nullif(btrim(p_order->>'observacoes'), '');
  v_delivery_fee    numeric := coalesce(nullif(btrim(p_order->>'delivery_fee'), '')::numeric, 0);
  v_maquininha_fee  numeric := coalesce(nullif(btrim(p_order->>'maquininha_fee'), '')::numeric, 0);
  v_elem   jsonb; v_err text; v_state text;
  v_t0     timestamptz := clock_timestamp(); v_dur numeric;
  v_log    jsonb := jsonb_build_object(
              'n_items', case when jsonb_typeof(p_items)='array' then jsonb_array_length(p_items) else null end,
              'total', p_order->>'total', 'has_request_id', (p_request_id is not null));
  -- REF-ORDER-TENANT-01 · Onda 1: fonte confiável de tenant, nunca o p_store_id cru do client.
  v_tenant       uuid := nullif(auth.jwt()->>'tenant_id', '')::uuid;
  v_store_id     uuid;
begin
  if p_request_id is not null then
    select id into v_order_id from public.orders where request_id = p_request_id;
    if v_order_id is not null then return jsonb_build_object('ok', true, 'order_id', v_order_id, 'idempotent', true); end if;
  end if;

  -- REF-SEC-02 · Onda 1: rate limit por IP (cf-connecting-ip), 20/10min. Fail-open embutido no helper.
  if not public._rate_limit_hit('create_order', 60, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'error', 'muitas tentativas, aguarde um momento');
  end if;

  -- REF-ORDER-TENANT-01 · Onda 1: resolve a loja ANTES de qualquer validacao de negocio.
  if auth.uid() is not null then
    -- autenticado: tenant_id assinado (Onda 6 de REF-AUTH-TENANT-01) e quem manda quando presente.
    -- mesma mensagem generica de 'loja invalida' usada em link_customer_to_auth (anti-enumeracao).
    if v_tenant is not null and v_tenant <> p_store_id then
      return jsonb_build_object('ok', false, 'error', 'loja invalida');
    end if;
    v_store_id := p_store_id; -- bate com v_tenant quando presente; legado preservado quando ausente
  else
    -- guest: p_store_id do client NUNCA e usado. Deriva do header Origin real da requisicao.
    v_store_id := public.resolve_store_from_origin();
    if v_store_id is null then
      return jsonb_build_object('ok', false, 'error', 'loja nao identificada');
    end if;
  end if;

  begin
    if p_customer is null or jsonb_typeof(p_customer) <> 'object' then raise exception 'p_customer ausente/invalido'; end if;
    if v_name  is null then raise exception 'name do cliente e obrigatorio'; end if;
    if v_phone is null then raise exception 'telefone do cliente e obrigatorio'; end if;
    if p_order is null or jsonb_typeof(p_order) <> 'object' then raise exception 'p_order ausente/invalido'; end if;
    if nullif(btrim(p_order->>'total'), '') is null then raise exception 'total e obrigatorio'; end if;
    v_total := (p_order->>'total')::numeric;
    if v_total <= 0 then raise exception 'total deve ser > 0 (recebido %)', v_total; end if;
    if v_delivery_fee < 0 then raise exception 'delivery_fee nao pode ser negativo (recebido %)', v_delivery_fee; end if;
    if v_maquininha_fee < 0 then raise exception 'maquininha_fee nao pode ser negativo (recebido %)', v_maquininha_fee; end if;
    if v_pay  is null then raise exception 'payment_method e obrigatorio'; end if;
    if v_addr is null then raise exception 'address e obrigatorio'; end if;
    if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'p_items deve ser um array'; end if;
    if jsonb_array_length(p_items) = 0 then raise exception 'p_items nao pode ser vazio'; end if;
    for v_elem in select value from jsonb_array_elements(p_items) loop
      if nullif(btrim(v_elem->>'nome_produto'), '') is null then raise exception 'item sem nome_produto'; end if;
      if nullif(btrim(v_elem->>'quantity'), '') is null or (v_elem->>'quantity')::numeric <= 0 then
        raise exception 'item "%" com quantity invalida', v_elem->>'nome_produto'; end if;
      if nullif(btrim(v_elem->>'price'), '') is null or (v_elem->>'price')::numeric <= 0 then
        raise exception 'item "%" com price invalido', v_elem->>'nome_produto'; end if;
    end loop;

    insert into public.customers (name, phone, store_id) values (v_name, v_phone, v_store_id)
      on conflict (store_id, phone) do update set name = excluded.name returning id into v_customer_id;
    insert into public.orders (customer_id, total, status, payment_method, address, observacoes, request_id, endereco_id, delivery_fee, maquininha_fee, store_id)
      values (v_customer_id, v_total, v_status, v_pay, v_addr, v_obs, p_request_id,
              nullif(btrim(p_order->>'endereco_id'), '')::uuid, v_delivery_fee, v_maquininha_fee, v_store_id) returning id into v_order_id;
    insert into public.order_items (order_id, product_id, nome_produto, quantity, price, preco_unitario, adicionais, observacoes, store_id)
      select v_order_id, nullif(btrim(item->>'product_id'),'')::uuid, item->>'nome_produto',
             (item->>'quantity')::int, (item->>'price')::numeric,
             coalesce((item->>'preco_unitario')::numeric,(item->>'price')::numeric),
             coalesce(item->'adicionais','[]'::jsonb), nullif(btrim(item->>'observacoes'),''), v_store_id
      from jsonb_array_elements(p_items) as t(item);

    -- REF-LOYALTY-01: concede 1 selo por pedido VALIDO (mesma transacao). Best-effort:
    -- fidelidade NUNCA reverte um pedido ja persistido (savepoint implicito no sub-bloco).
    begin
      perform public.loyalty_grant(v_customer_id, v_order_id);
    exception when others then
      null;
    end;

    return jsonb_build_object('ok', true, 'order_id', v_order_id);
  exception
    when unique_violation then
      if p_request_id is not null then
        select id into v_order_id from public.orders where request_id = p_request_id;
        if v_order_id is not null then return jsonb_build_object('ok', true, 'order_id', v_order_id, 'idempotent', true); end if;
      end if;
      v_err := sqlerrm; v_state := sqlstate; v_dur := extract(epoch from clock_timestamp()-v_t0)*1000;
      begin insert into public.application_logs(module,operation,entity,entity_id,request_id,rpc,version,duration_ms,level,message,payload,sqlstate,context,origin)
        values('orders','create_order','order',null,p_request_id,'create_order','sec-02',v_dur,'error',v_err,v_log,v_state,'unique_violation',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
    when others then
      v_err := sqlerrm; v_state := sqlstate; v_dur := extract(epoch from clock_timestamp()-v_t0)*1000;
      begin insert into public.application_logs(module,operation,entity,entity_id,request_id,rpc,version,duration_ms,level,message,payload,sqlstate,context,origin)
        values('orders','create_order','order',null,p_request_id,'create_order','sec-02',v_dur,'error',v_err,v_log,v_state,'create_order',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
  end;
end;$function$;

-- === save_structured_address(): rate-check logo apos a validacao de payload, antes de qualquer
-- resolucao de customer/loja. Corpo restante byte-identico ao anterior (ADDRESS-STOREID-01). ===
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

  -- REF-SEC-02 · Onda 1: rate limit por IP (cf-connecting-ip), 20/10min. Fail-open embutido no helper.
  IF NOT public._rate_limit_hit('save_structured_address', 60, interval '10 minutes') THEN
    RAISE EXCEPTION 'muitas tentativas, aguarde um momento';
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
