-- REF-PROD-GOLIVE-01 -- fecha MT-01/MT-02 da auditoria pre-go-live (REF-PROD-READINESS-01).
--
-- Achado: create_order() e link_customer_to_auth() confiavam cegamente em p_store_id (parametro
-- do client) sempre que o JWT autenticado ainda nao tinha tenant_id -- condicao de QUALQUER conta
-- nova, sem historico de compra em loja nenhuma (basta um login por e-mail/OTP ou Google, gratis).
-- Nessa condicao, um atacante podia criar pedidos em qualquer loja da plataforma so trocando
-- p_store_id, ou vincular-se como cliente de uma loja alheia via link_customer_to_auth -- a mesma
-- vulnerabilidade cross-tenant que a REF-ORDER-TENANT-01 foi criada pra fechar, reaberta atras de
-- uma condicao (`auth.uid() is not null`) que qualquer visitante satisfaz de graca.
--
-- Correcao: quando tenant_id ESTA ausente do JWT, as duas RPCs passam a derivar a loja da MESMA
-- fonte confiavel ja usada no caminho guest (resolve_store_from_origin(), Origin real da
-- requisicao) -- nunca mais do parametro cru do client. Quando tenant_id esta presente, nada muda
-- (continua validando p_store_id contra o tenant assinado, comportamento ja correto e nao tocado).
--
-- resolve_store_from_origin() ganha 1 ramo aditivo: reconhece Origin "https://localhost" -- o UNICO
-- Origin que o app Android/Capacitor consegue emitir (confirmado no codigo-fonte do pacote
-- @capacitor/android instalado nesta versao do projeto: CapConfig.java define hostname default
-- "localhost", scheme "https" -- o WebView carrega os arquivos do zip local do APK, nunca via HTTPS
-- real) -- como o app nativo da Encanto, o UNICO tenant que esse app pode representar (appId
-- br.com.valionsistemas.encanto, sem UI de troca de loja). Sempre resolve para
-- default_store_id() (Encanto) nesse ramo, nunca aceita p_store_id do payload. Sem isto, esta
-- correcao quebraria o primeiro pedido de qualquer cliente novo dentro do app -- confirmado em uso
-- real hoje pelo dono.
--
-- Efeito colateral aceitavel e documentado: dev local puro (`vite --mode dev`,
-- http://localhost:5173, sem subdominio configurado em /etc/hosts) tambem cai neste ramo -- ja
-- caia em "loja nao identificada" ANTES desta correcao (nunca funcionou sem configurar
-- {slug}.localhost manualmente), agora passa a assumir Encanto por padrao. Nenhum ramo existente
-- (dominio explicito, legado {slug}.valionsistemas.com.br, novo
-- {slug}.lojas.valionsistemas.com.br, {slug}.localhost de dev/E2E) foi alterado.
--
-- Fora do escopo desta correcao, registrado como achado residual conhecido (nao corrigido aqui por
-- exigir mais analise de efeitos colaterais em fluxo legitimo, fora da prioridade "funcionamento da
-- Encanto amanha"): o INSERT ... ON CONFLICT (store_id, phone) DO UPDATE SET name = excluded.name
-- em create_order() nao verifica auth_user_id do customer existente -- um autenticado que descubra
-- o telefone de um cliente real da propria Encanto ainda pode sobrescrever o nome do cadastro dele.

BEGIN;

-- ===== 1. resolve_store_from_origin: ramo aditivo pro app nativo (Origin "https://localhost").
-- Corpo restante byte-identico a versao anterior (REF-STORE-ONBOARD-01 Onda 2).
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

  -- REF-PROD-GOLIVE-01: app Android/Capacitor -- unico Origin possivel, unico tenant que representa.
  IF v_hostname = 'localhost' THEN
    RETURN public.default_store_id();
  END IF;

  SELECT s.id INTO v_store_id
  FROM public.stores s
  WHERE s.id = COALESCE(
    (SELECT id FROM public.stores WHERE dominio = v_hostname),
    (SELECT id FROM public.stores
       WHERE slug = regexp_replace(v_hostname, '\.valionsistemas\.com\.br$', '')
         AND v_hostname ~ '^[a-z0-9-]+\.valionsistemas\.com\.br$'),
    (SELECT id FROM public.stores
       WHERE slug = regexp_replace(v_hostname, '\.lojas\.valionsistemas\.com\.br$', '')
         AND v_hostname ~ '^[a-z0-9-]+\.lojas\.valionsistemas\.com\.br$'),
    -- {slug}.localhost -- reservado IETF/navegador (RFC 6761), so pra permitir testar em dev/E2E
    -- com a MESMA funcao byte a byte de producao (comentario original de REF-ORDER-TENANT-01).
    (SELECT id FROM public.stores
       WHERE slug = regexp_replace(v_hostname, '\.localhost$', '')
         AND v_hostname ~ '^[a-z0-9-]+\.localhost$')
  );

  RETURN v_store_id;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

-- ===== 2. create_order(): so o bloco de resolucao de loja muda. Resto do corpo (validacoes,
-- inserts, loyalty, exception handling) byte-identico a versao anterior (REF-SEC-02 Onda 1).
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

  -- REF-SEC-02 · Onda 1: rate limit por IP (cf-connecting-ip), 60/10min. Fail-open embutido no helper.
  if not public._rate_limit_hit('create_order', 60, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'error', 'muitas tentativas, aguarde um momento');
  end if;

  -- REF-PROD-GOLIVE-01 (fecha MT-01): p_store_id so e confiavel quando ha tenant_id assinado pra
  -- compara-lo. Sem tenant_id (autenticado OU guest), a loja vem sempre de
  -- resolve_store_from_origin() -- nunca mais do parametro cru do client.
  if v_tenant is not null then
    -- mesma mensagem generica de 'loja invalida' usada em link_customer_to_auth (anti-enumeracao).
    if v_tenant <> p_store_id then
      return jsonb_build_object('ok', false, 'error', 'loja invalida');
    end if;
    v_store_id := p_store_id;
  else
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
        values('orders','create_order','order',null,p_request_id,'create_order','prod-golive-01',v_dur,'error',v_err,v_log,v_state,'unique_violation',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
    when others then
      v_err := sqlerrm; v_state := sqlstate; v_dur := extract(epoch from clock_timestamp()-v_t0)*1000;
      begin insert into public.application_logs(module,operation,entity,entity_id,request_id,rpc,version,duration_ms,level,message,payload,sqlstate,context,origin)
        values('orders','create_order','order',null,p_request_id,'create_order','prod-golive-01',v_dur,'error',v_err,v_log,v_state,'create_order',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
  end;
end;$function$;

-- ===== 3. link_customer_to_auth(): so o bloco de resolucao de loja muda. Resto do corpo (lock,
-- anti-takeover de telefone, guarda REF-LOYALTY-01a, casos a/b/c) byte-identico a versao anterior
-- (REF-AUTH-TENANT-01 Onda 6).
CREATE OR REPLACE FUNCTION public.link_customer_to_auth(p_phone text, p_email text DEFAULT NULL::text, p_name text DEFAULT NULL::text, p_store_id uuid DEFAULT public.default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_phone  text := public.normalize_phone(p_phone);
  v_email  text := lower(nullif(btrim(p_email), ''));
  v_name   text := nullif(btrim(p_name), '');
  v_store  uuid;
  v_tenant uuid := nullif(auth.jwt()->>'tenant_id', '')::uuid;
  v_cid    uuid;
  v_owner  uuid;
begin
  if v_uid   is null then return jsonb_build_object('ok', false, 'error', 'nao autenticado'); end if;
  if v_phone is null then return jsonb_build_object('ok', false, 'error', 'telefone invalido'); end if;

  -- REF-PROD-GOLIVE-01 (fecha MT-02): mesma correcao do create_order -- p_store_id so e confiavel
  -- quando ha tenant_id assinado pra compara-lo. Sem tenant_id, a loja vem de
  -- resolve_store_from_origin() -- nunca mais do parametro cru/default_store_id() do client.
  if v_tenant is not null then
    if p_store_id is null or v_tenant <> p_store_id then
      return jsonb_build_object('ok', false, 'error', 'loja invalida');
    end if;
    v_store := p_store_id;
  else
    v_store := public.resolve_store_from_origin();
    if v_store is null then
      return jsonb_build_object('ok', false, 'error', 'loja invalida');
    end if;
  end if;

  -- lock por telefone+loja: serializa concorrentes com o mesmo telefone NA MESMA loja (race-safe, sem
  -- duplicar). Duas lojas distintas com o mesmo telefone (cliente comum) nao contendem pelo mesmo lock.
  perform pg_advisory_xact_lock(hashtextextended(v_phone || ':' || v_store::text, 0));

  -- (a) existe customer com este TELEFONE nesta LOJA?
  select id, auth_user_id into v_cid, v_owner from public.customers where phone = v_phone and store_id = v_store limit 1;
  if v_cid is not null then
    if v_owner is not null and v_owner <> v_uid then
      return jsonb_build_object('ok', false, 'error', 'telefone ja vinculado a outra conta');
    end if;
    -- REF-LOYALTY-01a: NAO reivindicar automaticamente um cadastro-convidado (auth_user_id NULL) que ja
    -- possui HISTORICO (pedidos ou selos) sem prova de posse do telefone. Fecha o roubo; exige verificacao
    -- manual do admin. So afeta telefones COM historico; contas novas seguem normais. Re-link do proprio
    -- dono (v_owner = v_uid) NAO cai aqui (guarda so quando v_owner IS NULL).
    if v_owner is null and (
         exists (select 1 from public.orders where customer_id = v_cid)
      or exists (select 1 from public.loyalty_events where customer_id = v_cid)
    ) then
      return jsonb_build_object('ok', false, 'status', 'requer_verificacao',
        'error', 'Este telefone ja possui historico de pedidos. Para vincula-lo a sua conta, fale com a loja.');
    end if;
    update public.customers
       set auth_user_id = v_uid,
           email = coalesce(v_email, email),
           name  = coalesce(v_name, name)
     where id = v_cid;
    return jsonb_build_object('ok', true, 'customer_id', v_cid,
                              'status', case when v_owner = v_uid then 'ja_vinculado' else 'vinculado' end);
  end if;

  -- (b) este usuario ja tem customer NESTA LOJA (com outro telefone)? atualiza telefone/email/nome.
  select id into v_cid from public.customers where auth_user_id = v_uid and store_id = v_store limit 1;
  if v_cid is not null then
    update public.customers set phone = v_phone, email = coalesce(v_email, email), name = coalesce(v_name, name) where id = v_cid;
    return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'atualizado');
  end if;

  -- (c) cria novo (telefone identidade + email/nome), nesta loja.
  insert into public.customers(name, phone, email, auth_user_id, store_id)
    values (coalesce(v_name, 'Cliente'), v_phone, v_email, v_uid, v_store)
  returning id into v_cid;
  return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'criado');
end; $function$;

COMMIT;
