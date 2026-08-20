-- REF-ORDER-TENANT-01 — Onda 1: create_order() passa a validar/derivar o store_id de uma fonte
-- confiável de tenant, em vez de confiar cegamente em p_store_id vindo do client.
--
-- Achado (auditoria REF-ORDER-TENANT-01): p_store_id sempre foi um parâmetro do client
-- (buildStorefrontRpcParam(), alimentado por window.location.hostname -> get_store_by_domain() ->
-- singleton JS local) e create_order() usava esse valor DIRETO em customers/orders/order_items, sem
-- nenhuma validação. Confirmado empiricamente: sessão autenticada no tenant Encanto conseguia criar
-- pedido/customer/order_items reais atribuídos à Bar da Sogra só trocando o parâmetro — e vice-versa.
-- Efeitos em cascata reais: notification_outbox (fila de WhatsApp) e order_events herdam o store_id
-- manipulado; loyalty_grant() também (dormente hoje, loyalty_enabled=false em produção).
--
-- DUAS FONTES DE VERDADE, dependendo de quem chama:
--
-- AUTENTICADO (auth.uid() IS NOT NULL): usa o MESMO mecanismo já existente e em produção desde a
-- Onda 6 de REF-AUTH-TENANT-01 -- tenant_id assinado no JWT (Hook + activate_tenant). Quando presente,
-- p_store_id PRECISA bater com ele, senão DENY (mesma mensagem genérica de sempre, anti-enumeração).
-- Quando ausente (tenant ainda não sincronizado nesta sessão), comportamento LEGADO preservado --
-- p_store_id como seletor, exatamente como hoje. Não compromete a solução do guest (que nunca usa
-- p_store_id de jeito nenhum, ver abaixo).
--
-- GUEST (auth.uid() IS NULL): p_store_id do client NUNCA é usado. O servidor deriva a loja do header
-- HTTP Origin real da requisição -- current_setting('request.headers', true)::json->>'origin' é um
-- GUC que o PostgREST preenche automaticamente a cada request (confirmado: mesmo padrão usado pelo
-- pacote comunitário pg_headerkit em projetos Supabase, sem precisar de Edge Function nem config
-- especial). Origin é uma requisição CROSS-ORIGIN de verdade aqui (o frontend em
-- *.valionsistemas.com.br chama a API em *.supabase.co) -- o navegador SEMPRE envia esse header
-- nesse cenário, e nenhum JavaScript rodando na página consegue sobrescrevê-lo (é um "forbidden
-- header name" da própria especificação Fetch, imposto pelo navegador, não pela aplicação). Uma
-- ferramenta HTTP não-navegador (curl/Postman) ainda pode forjar esse header -- registrado como
-- limitação residual, não resolvida por esta migration (documentado no relatório final, não
-- escondido). Sem Origin reconhecido -> DENY (fail-closed), nunca cai pro default antigo
-- (default_store_id()/Encanto).
--
-- resolve_store_from_origin() reaproveita EXATAMENTE a mesma lógica de casamento de domínio/
-- subdomínio de get_store_by_domain() -- só que sem o fallback pra default_store_id() no final
-- (fail-closed em vez de assumir Encanto quando não casa com nada). Também reconhece o padrão
-- {slug}.localhost -- ".localhost" é reservado pela IETF (RFC 6761) e todo navegador SÓ resolve
-- esse sufixo para o próprio loopback da máquina que fez a requisição; um Origin desse padrão
-- chegando de verdade só pode significar que o navegador está genuinamente rodando algo local
-- (mesma garantia estrutural que já vale pro resto deste desenho -- não é uma nova confiança cega,
-- é reconhecer mais um valor legítimo que o Origin pode assumir). Existe SÓ pra permitir testar
-- create_order() em ambiente de desenvolvimento/E2E (que roda em localhost) com a MESMA função
-- byte a byte que roda em produção -- nunca versões divergentes entre ambientes.

-- Resto do corpo de create_order() (validações de entrada, lock/idempotência por request_id, upsert
-- de customer, insert de order/order_items, loyalty_grant, tratamento de unique_violation/others)
-- permanece IDÊNTICO -- nenhuma proteção existente foi tocada.

BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_store_from_origin()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_origin   text;
  v_hostname text;
  v_store_id uuid;
BEGIN
  v_origin := current_setting('request.headers', true)::json->>'origin';
  IF v_origin IS NULL OR btrim(v_origin) = '' THEN
    RETURN NULL;
  END IF;

  v_hostname := regexp_replace(lower(v_origin), '^https?://([^/:]+).*$', '\1');

  SELECT s.id INTO v_store_id
  FROM public.stores s
  WHERE s.id = COALESCE(
    (SELECT id FROM public.stores WHERE dominio = v_hostname),
    (SELECT id FROM public.stores
       WHERE slug = regexp_replace(v_hostname, '\.valionsistemas\.com\.br$', '')
         AND v_hostname ~ '^[a-z0-9-]+\.valionsistemas\.com\.br$'),
    -- {slug}.localhost -- reservado IETF/navegador (RFC 6761), so pra permitir testar em dev/E2E
    -- com a MESMA funcao byte a byte de producao (ver comentario no topo do arquivo desta migration).
    (SELECT id FROM public.stores
       WHERE slug = regexp_replace(v_hostname, '\.localhost$', '')
         AND v_hostname ~ '^[a-z0-9-]+\.localhost$')
  );

  RETURN v_store_id;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.resolve_store_from_origin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_store_from_origin() TO anon, authenticated;

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
        values('orders','create_order','order',null,p_request_id,'create_order','order-tenant-01',v_dur,'error',v_err,v_log,v_state,'unique_violation',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
    when others then
      v_err := sqlerrm; v_state := sqlstate; v_dur := extract(epoch from clock_timestamp()-v_t0)*1000;
      begin insert into public.application_logs(module,operation,entity,entity_id,request_id,rpc,version,duration_ms,level,message,payload,sqlstate,context,origin)
        values('orders','create_order','order',null,p_request_id,'create_order','order-tenant-01',v_dur,'error',v_err,v_log,v_state,'create_order',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
  end;
end;$function$;

COMMIT;
