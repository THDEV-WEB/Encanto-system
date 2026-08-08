-- REF-SAAS-01 · Onda 3 — Rollback: restaura create_order/link_customer_to_auth/
-- admin_link_customer_to_auth aos corpos originais, RLS sem predicado de loja, uniques globais,
-- store_id nullable/sem DEFAULT.

BEGIN;

ALTER POLICY "Cliente le proprio customer" ON public.customers USING (auth_user_id = auth.uid());
ALTER POLICY "Admin all customers" ON public.customers USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.admin_link_customer_to_auth(p_customer_id uuid, p_auth_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_owner uuid;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'sem permissao'); end if;
  if p_customer_id is null or p_auth_user_id is null then return jsonb_build_object('ok', false, 'error', 'parametros invalidos'); end if;
  select auth_user_id into v_owner from public.customers where id = p_customer_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'cliente nao encontrado'); end if;
  if v_owner is not null and v_owner <> p_auth_user_id then
    return jsonb_build_object('ok', false, 'error', 'cliente ja vinculado a outra conta');
  end if;
  update public.customers set auth_user_id = p_auth_user_id where id = p_customer_id;
  return jsonb_build_object('ok', true, 'customer_id', p_customer_id);
end; $function$;

-- Remove o overload de 4 args antes de recriar o de 3 -- do contrario as duas versoes coexistiriam
-- (mesmo cuidado da migration direta, ver nota la).
DROP FUNCTION IF EXISTS public.link_customer_to_auth(text, text, text, uuid);

CREATE OR REPLACE FUNCTION public.link_customer_to_auth(p_phone text, p_email text DEFAULT NULL::text, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_phone text := public.normalize_phone(p_phone);
  v_email text := lower(nullif(btrim(p_email), ''));
  v_name  text := nullif(btrim(p_name), '');
  v_cid   uuid;
  v_owner uuid;
begin
  if v_uid   is null then return jsonb_build_object('ok', false, 'error', 'nao autenticado'); end if;
  if v_phone is null then return jsonb_build_object('ok', false, 'error', 'telefone invalido'); end if;

  perform pg_advisory_xact_lock(hashtextextended(v_phone, 0));

  select id, auth_user_id into v_cid, v_owner from public.customers where phone = v_phone limit 1;
  if v_cid is not null then
    if v_owner is not null and v_owner <> v_uid then
      return jsonb_build_object('ok', false, 'error', 'telefone ja vinculado a outra conta');
    end if;
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

  select id into v_cid from public.customers where auth_user_id = v_uid limit 1;
  if v_cid is not null then
    update public.customers set phone = v_phone, email = coalesce(v_email, email), name = coalesce(v_name, name) where id = v_cid;
    return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'atualizado');
  end if;

  insert into public.customers(name, phone, email, auth_user_id)
    values (coalesce(v_name, 'Cliente'), v_phone, v_email, v_uid)
  returning id into v_cid;
  return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'criado');
end; $function$;

CREATE OR REPLACE FUNCTION public.create_order(p_customer jsonb, p_order jsonb, p_items jsonb, p_request_id uuid DEFAULT NULL::uuid)
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
begin
  if p_request_id is not null then
    select id into v_order_id from public.orders where request_id = p_request_id;
    if v_order_id is not null then return jsonb_build_object('ok', true, 'order_id', v_order_id, 'idempotent', true); end if;
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

    insert into public.customers (name, phone) values (v_name, v_phone)
      on conflict (phone) do update set name = excluded.name returning id into v_customer_id;
    insert into public.orders (customer_id, total, status, payment_method, address, observacoes, request_id, endereco_id, delivery_fee, maquininha_fee)
      values (v_customer_id, v_total, v_status, v_pay, v_addr, v_obs, p_request_id,
              nullif(btrim(p_order->>'endereco_id'), '')::uuid, v_delivery_fee, v_maquininha_fee) returning id into v_order_id;
    insert into public.order_items (order_id, product_id, nome_produto, quantity, price, preco_unitario, adicionais, observacoes)
      select v_order_id, nullif(btrim(item->>'product_id'),'')::uuid, item->>'nome_produto',
             (item->>'quantity')::int, (item->>'price')::numeric,
             coalesce((item->>'preco_unitario')::numeric,(item->>'price')::numeric),
             coalesce(item->'adicionais','[]'::jsonb), nullif(btrim(item->>'observacoes'),'')
      from jsonb_array_elements(p_items) as t(item);

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
        values('orders','create_order','order',null,p_request_id,'create_order','harden-05',v_dur,'error',v_err,v_log,v_state,'unique_violation',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
    when others then
      v_err := sqlerrm; v_state := sqlstate; v_dur := extract(epoch from clock_timestamp()-v_t0)*1000;
      begin insert into public.application_logs(module,operation,entity,entity_id,request_id,rpc,version,duration_ms,level,message,payload,sqlstate,context,origin)
        values('orders','create_order','order',null,p_request_id,'create_order','harden-05',v_dur,'error',v_err,v_log,v_state,'create_order',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
  end;
end;$function$;

DROP INDEX public.customers_store_auth_user_id_key;
CREATE UNIQUE INDEX customers_auth_user_id_key ON public.customers (auth_user_id) WHERE (auth_user_id IS NOT NULL);

DROP INDEX public.customers_store_email_key;
CREATE UNIQUE INDEX customers_email_key ON public.customers (lower(email)) WHERE (email IS NOT NULL);

DROP INDEX public.customers_store_phone_uniq;
CREATE UNIQUE INDEX customers_phone_uniq ON public.customers (phone);

ALTER TABLE public.customers ALTER COLUMN store_id DROP NOT NULL;
ALTER TABLE public.customers ALTER COLUMN store_id DROP DEFAULT;

COMMIT;
