-- REF-SAAS-01 · Onda 4.1 — Pedidos + fidelidade concedida automaticamente (subfase 1 de 3 da Onda 4).
-- Escopo: orders/order_items/order_events/loyalty_accounts/loyalty_events/notification_outbox ganham
-- store_id NOT NULL; create_order ganha p_store_id explicito; todos os triggers/RPCs que escrevem
-- nessas 6 tabelas passam a propagar store_id; RLS troca is_admin() cego por is_admin_of(store_id) e
-- os "le proprios" ganham correlacao de loja (fecha um vazamento real entre lojas que a Onda 3 deixou
-- em aberto — ver auditoria no ledger). Onda 4.2 (fidelidade cliente-facing) e 4.3 (entrega/horario/
-- settings->store_settings) sao subfases separadas, cada uma com seu proprio ciclo completo.
-- Ver docs/adr/REF-SAAS-01-fundacao-multitenant.md §5/§6/§9/§10/§11 e
-- docs/ref/REF-SAAS-01-plano-ondas.md (secao "Onda 4.1") para a auditoria e o racional completos.

BEGIN;

-- ===== 1. Schema: store_id ganha DEFAULT (ponte, funcao ja existe desde a Onda 2) e vira NOT NULL nas
-- 6 tabelas desta subfase. Backfill 100% desde a Onda 0; sem isso, create_order/triggers criariam
-- linhas orfas assim que a Onda 0 acabar de cobrir so o passado. =====
ALTER TABLE public.orders               ALTER COLUMN store_id SET DEFAULT public.default_store_id();
ALTER TABLE public.order_items          ALTER COLUMN store_id SET DEFAULT public.default_store_id();
ALTER TABLE public.order_events         ALTER COLUMN store_id SET DEFAULT public.default_store_id();
ALTER TABLE public.loyalty_accounts     ALTER COLUMN store_id SET DEFAULT public.default_store_id();
ALTER TABLE public.loyalty_events       ALTER COLUMN store_id SET DEFAULT public.default_store_id();
ALTER TABLE public.notification_outbox  ALTER COLUMN store_id SET DEFAULT public.default_store_id();

ALTER TABLE public.orders               ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE public.order_items          ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE public.order_events         ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE public.loyalty_accounts     ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE public.loyalty_events       ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE public.notification_outbox  ALTER COLUMN store_id SET NOT NULL;

-- ===== 2. create_order ganha p_store_id explicito (ADR §10.1) =====
-- LICAO DA ONDA 3: CREATE OR REPLACE com um parametro A MAIS cria um OVERLOAD, nao substitui a funcao
-- (Postgres identifica por nome+tipos). Sem o DROP explicito abaixo, a chamada real de checkout
-- (4 argumentos) ficaria ambigua entre a assinatura antiga e a nova. Aplicado proativamente aqui.
DROP FUNCTION IF EXISTS public.create_order(jsonb, jsonb, jsonb, uuid);

CREATE OR REPLACE FUNCTION public.create_order(p_customer jsonb, p_order jsonb, p_items jsonb, p_request_id uuid DEFAULT NULL::uuid, p_store_id uuid DEFAULT public.default_store_id())
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

    insert into public.customers (name, phone, store_id) values (v_name, v_phone, p_store_id)
      on conflict (store_id, phone) do update set name = excluded.name returning id into v_customer_id;
    insert into public.orders (customer_id, total, status, payment_method, address, observacoes, request_id, endereco_id, delivery_fee, maquininha_fee, store_id)
      values (v_customer_id, v_total, v_status, v_pay, v_addr, v_obs, p_request_id,
              nullif(btrim(p_order->>'endereco_id'), '')::uuid, v_delivery_fee, v_maquininha_fee, p_store_id) returning id into v_order_id;
    insert into public.order_items (order_id, product_id, nome_produto, quantity, price, preco_unitario, adicionais, observacoes, store_id)
      select v_order_id, nullif(btrim(item->>'product_id'),'')::uuid, item->>'nome_produto',
             (item->>'quantity')::int, (item->>'price')::numeric,
             coalesce((item->>'preco_unitario')::numeric,(item->>'price')::numeric),
             coalesce(item->'adicionais','[]'::jsonb), nullif(btrim(item->>'observacoes'),''), p_store_id
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

-- ===== 3. Triggers de auditoria/notificacao: propagam store_id (da propria linha, sem precisar de
-- ponte -- orders/order_items ja carregam seu store_id real, gracas ao create_order acima) =====

CREATE OR REPLACE FUNCTION public.trg_order_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'INSERT' then
    insert into public.order_events(order_id, tipo, status_anterior, status_novo, store_id)
      values (new.id, 'PEDIDO_CRIADO', null, new.status, new.store_id);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.order_events(order_id, tipo, status_anterior, status_novo, store_id)
      values (new.id,
              case new.status when 'cancelado' then 'PEDIDO_CANCELADO'
                              when 'entregue'  then 'PEDIDO_ENTREGUE'
                              else 'STATUS_ALTERADO' end,
              old.status, new.status, new.store_id);
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.trg_order_edit_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.payment_method is distinct from old.payment_method then
    insert into public.order_events(order_id,tipo,usuario,payload,store_id)
      values(new.id,'PAGAMENTO_ALTERADO',current_user,jsonb_build_object('antes',old.payment_method,'depois',new.payment_method),new.store_id);
  end if;
  if new.address is distinct from old.address then
    insert into public.order_events(order_id,tipo,usuario,payload,store_id)
      values(new.id,'ENDERECO_ALTERADO',current_user,jsonb_build_object('antes',old.address,'depois',new.address),new.store_id);
  end if;
  if new.observacoes is distinct from old.observacoes then
    insert into public.order_events(order_id,tipo,usuario,payload,store_id)
      values(new.id,'OBS_ALTERADA',current_user,jsonb_build_object('antes',old.observacoes,'depois',new.observacoes),new.store_id);
  end if;
  if new.total is distinct from old.total then
    insert into public.order_events(order_id,tipo,usuario,payload,store_id)
      values(new.id,'PEDIDO_EDITADO',current_user,jsonb_build_object('campo','total','antes',old.total,'depois',new.total),new.store_id);
  end if;
  return null;
end;$function$;

CREATE OR REPLACE FUNCTION public.trg_order_item_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op='UPDATE' then
    insert into public.order_events(order_id,tipo,usuario,payload,store_id)
      values(new.order_id,'ITEM_ALTERADO',current_user,
        jsonb_build_object('item_id',new.id,
          'antes',jsonb_build_object('nome',old.nome_produto,'qtd',old.quantity,'price',old.price),
          'depois',jsonb_build_object('nome',new.nome_produto,'qtd',new.quantity,'price',new.price)),
        new.store_id);
  elsif tg_op='DELETE' then
    if exists (select 1 from public.orders o where o.id=old.order_id) then  -- pedido ainda existe => delete direto
      insert into public.order_events(order_id,tipo,usuario,payload,store_id)
        values(old.order_id,'ITEM_REMOVIDO',current_user,
          jsonb_build_object('item_id',old.id,'nome',old.nome_produto,'qtd',old.quantity,'price',old.price),
          old.store_id);
    end if;
  end if;
  return null;
end;$function$;

-- ===== 4. Fidelidade concedida automaticamente: loyalty_grant/loyalty_void_on_cancel/
-- admin_adjust_loyalty passam a propagar store_id (derivado do customer_id ou de NEW.store_id da
-- propria orders, conforme o caso). get_my_loyalty/redeem_reward/admin_find_loyalty (fidelidade
-- CLIENTE-FACING) ficam para a Onda 4.2, deliberadamente. =====

CREATE OR REPLACE FUNCTION public.loyalty_grant(p_customer_id uuid, p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_required int     := coalesce(nullif(public.get_setting('loyalty_required','10'),'')::int, 10);
  v_enabled  boolean := lower(coalesce(public.get_setting('loyalty_enabled','true'),'true')) <> 'false';
  v_stamps   int;
  v_store    uuid;
begin
  if not v_enabled or p_customer_id is null or p_order_id is null then return; end if;
  -- idempotencia macia (o indice unico parcial e o backstop duro)
  if exists (select 1 from public.loyalty_events where order_id = p_order_id and tipo = 'earned') then return; end if;

  select store_id into v_store from public.customers where id = p_customer_id;
  if v_store is null then return; end if;

  insert into public.loyalty_accounts (customer_id, store_id) values (p_customer_id, v_store)
    on conflict (customer_id) do nothing;
  select stamps into v_stamps from public.loyalty_accounts where customer_id = p_customer_id for update;

  if coalesce(v_stamps, 0) >= v_required then return; end if;   -- cartela cheia: nao acumula alem

  update public.loyalty_accounts
     set stamps = stamps + 1, earned_total = earned_total + 1, updated_at = now()
   where customer_id = p_customer_id
   returning stamps into v_stamps;

  insert into public.loyalty_events (customer_id, order_id, tipo, delta, stamps_after, origem, note, store_id)
    values (p_customer_id, p_order_id, 'earned', 1, v_stamps, 'create_order', 'pedido valido', v_store);
end;
$function$;

CREATE OR REPLACE FUNCTION public.loyalty_void_on_cancel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_stamps   int;
  v_required int := coalesce(nullif(public.get_setting('loyalty_required','10'),'')::int, 10);
  v_contrib  int;
  v_earned   boolean;
begin
  if new.status = 'cancelado' and coalesce(old.status,'') <> 'cancelado' then
    begin
      select coalesce(sum(delta),0) into v_contrib from public.loyalty_events
        where order_id = new.id and origem in ('create_order','cancel_trigger');
      if v_contrib > 0 then
        update public.loyalty_accounts
           set stamps = greatest(0, stamps - v_contrib), earned_total = greatest(0, earned_total - v_contrib), updated_at = now()
         where customer_id = new.customer_id
         returning stamps into v_stamps;
        insert into public.loyalty_events (customer_id, order_id, tipo, delta, stamps_after, origem, note, store_id)
          values (new.customer_id, new.id, 'revoked', -v_contrib, v_stamps, 'cancel_trigger', 'pedido cancelado', new.store_id);
      end if;
    exception when others then
      null;
    end;
  elsif coalesce(old.status,'') = 'cancelado' and new.status <> 'cancelado' then
    begin
      select exists (select 1 from public.loyalty_events where order_id = new.id and tipo = 'earned') into v_earned;
      select coalesce(sum(delta),0) into v_contrib from public.loyalty_events
        where order_id = new.id and origem in ('create_order','cancel_trigger');
      if v_earned and v_contrib <= 0 then
        select stamps into v_stamps from public.loyalty_accounts where customer_id = new.customer_id for update;
        if coalesce(v_stamps,0) < v_required then
          update public.loyalty_accounts
             set stamps = stamps + 1, earned_total = earned_total + 1, updated_at = now()
           where customer_id = new.customer_id
           returning stamps into v_stamps;
          insert into public.loyalty_events (customer_id, order_id, tipo, delta, stamps_after, origem, note, store_id)
            values (new.customer_id, new.id, 'adjustment', 1, v_stamps, 'cancel_trigger', 'pedido reativado', new.store_id);
        end if;
      end if;
    exception when others then
      null;
    end;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_adjust_loyalty(p_customer_id uuid, p_delta integer, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_required int := coalesce(nullif(public.get_setting('loyalty_required','10'),'')::int, 10);
  v_stamps int;
  v_store uuid;
begin
  if p_customer_id is null or coalesce(p_delta,0) = 0 then return jsonb_build_object('ok', false, 'error', 'parametros invalidos'); end if;
  select store_id into v_store from public.customers where id = p_customer_id;
  if v_store is null then return jsonb_build_object('ok', false, 'error', 'cliente nao encontrado'); end if;
  if not public.is_admin_of(v_store) then return jsonb_build_object('ok', false, 'error', 'sem permissao'); end if;

  insert into public.loyalty_accounts (customer_id, store_id) values (p_customer_id, v_store) on conflict (customer_id) do nothing;
  select stamps into v_stamps from public.loyalty_accounts where customer_id = p_customer_id for update;

  v_stamps := greatest(0, coalesce(v_stamps,0) + p_delta);
  update public.loyalty_accounts
     set stamps = v_stamps,
         earned_total = greatest(0, earned_total + greatest(p_delta, 0)),
         updated_at = now()
   where customer_id = p_customer_id;
  insert into public.loyalty_events (customer_id, tipo, delta, stamps_after, origem, note, store_id)
    values (p_customer_id, 'adjustment', p_delta, v_stamps, 'admin', coalesce(nullif(btrim(p_note),''), 'ajuste manual'), v_store);

  return jsonb_build_object('ok', true, 'stamps', v_stamps, 'required', v_required, 'reward_available', (v_stamps >= v_required));
end;
$function$;

-- ===== 5. reconcile_orders: order_events tambem precisa de store_id -- derivado via join de volta a
-- orders (v_order_reconciliation nao expoe store_id, so orders_id/total/itens_sum/diff) =====
CREATE OR REPLACE FUNCTION public.reconcile_orders(p_order_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(order_id uuid, total numeric, itens_sum numeric, diff numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  return query
    select v.order_id, v.total, v.itens_sum, v.diff
    from public.v_order_reconciliation v
    where (p_order_id is null or v.order_id=p_order_id) and abs(v.diff) > 0.005;

  insert into public.order_events(order_id,tipo,usuario,payload,store_id)
    select v.order_id,'RECONCILIACAO_DIVERGENTE','reconcile_orders',
           jsonb_build_object('total',v.total,'itens_sum',v.itens_sum,'diff',v.diff),
           o.store_id
    from public.v_order_reconciliation v
    join public.orders o on o.id = v.order_id
    where (p_order_id is null or v.order_id=p_order_id) and abs(v.diff) > 0.005
      and not exists (
        select 1 from public.order_events e
        where e.order_id=v.order_id and e.tipo='RECONCILIACAO_DIVERGENTE'
          and e.created_at = (select max(e2.created_at) from public.order_events e2
                              where e2.order_id=v.order_id and e2.tipo='RECONCILIACAO_DIVERGENTE')
          and (e.payload->>'total')::numeric    = v.total
          and (e.payload->>'itens_sum')::numeric = v.itens_sum
          and (e.payload->>'diff')::numeric     = v.diff
      );
end;$function$;

-- Nota deliberada: reconcile_and_alert() NAO muda -- e um job de observabilidade de PLATAFORMA (varre
-- divergencia financeira em TODAS as lojas de proposito, mesmo papel de alert_* em settings global,
-- ADR §14). Nao e "esquecido", e decisao explicita: a VALION quer saber de qualquer divergencia,
-- de qualquer loja, sem precisar rodar o job uma vez por tenant.

-- ===== 6. enc_enqueue_notification: notification_outbox herda store_id da propria orders =====
CREATE OR REPLACE FUNCTION public.enc_enqueue_notification(p_order_id uuid, p_customer_id uuid, p_status text, p_address text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_phone text; v_name text; v_empresa text; v_store uuid;
BEGIN
  IF p_status NOT IN ('recebido','preparo','pronto','entrega','entregue') THEN RETURN; END IF;
  SELECT c.phone, c.name INTO v_phone, v_name FROM public.customers c WHERE c.id = p_customer_id;
  SELECT o.store_id INTO v_store FROM public.orders o WHERE o.id = p_order_id;
  SELECT public.get_company_info()->>'nomeCurto' INTO v_empresa;
  INSERT INTO public.notification_outbox (order_id, to_phone, status, vars, store_id)
  VALUES (
    p_order_id, v_phone, p_status,
    jsonb_build_object(
      'cliente', COALESCE(v_name, ''),
      'numero',  UPPER(LEFT(REPLACE(p_order_id::text, '-', ''), 8)),
      'tempo',   public.enc_tempo_estimado(p_address),
      'empresa', COALESCE(v_empresa, 'Encanto')
    ),
    v_store
  );
END;
$function$;

-- ===== 7. orders_health: achado de seguranca PRE-EXISTENTE (nao introduzido por esta onda) -- e
-- SECURITY DEFINER (bypassa RLS) e NUNCA checava is_admin(), so exigia estar autenticado. Qualquer
-- cliente logado podia ver faturamento/contagem de pedidos da loja. Corrigido aqui porque a mesma
-- mudanca (adicionar p_store_id) ja e necessaria pra escopar por loja -- 2 problemas, 1 correcao.
-- application_logs (erros_24h/taxa_erro_pct/logs_total) permanece GLOBAL de proposito (observabilidade
-- de plataforma, ADR §6 -- log nem sempre carrega store_id hoje).
DROP FUNCTION IF EXISTS public.orders_health();

CREATE OR REPLACE FUNCTION public.orders_health(p_store_id uuid DEFAULT public.default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.is_admin_of(p_store_id) then
    raise exception 'apenas administradores podem ver o painel de saude' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'pedidos_hoje',      (select count(*) from public.orders where store_id = p_store_id and public.dia_loja(created_at) = public.dia_loja(now())),
    'faturamento_hoje',  (select coalesce(sum(total),0) from public.orders where store_id = p_store_id and public.dia_loja(created_at) = public.dia_loja(now())),
    'ticket_medio_hoje', (select coalesce(avg(total),0) from public.orders where store_id = p_store_id and public.dia_loja(created_at) = public.dia_loja(now())),
    'pedidos_24h',       (select count(*) from public.orders where store_id = p_store_id and created_at >= now() - interval '24 hours'),
    'pedidos_7d',        (select count(*) from public.orders where store_id = p_store_id and created_at >= now() - interval '7 days'),
    'pedidos_total',     (select count(*) from public.orders where store_id = p_store_id),
    'por_status',        (select coalesce(jsonb_object_agg(status, n),'{}'::jsonb) from (select status, count(*) n from public.orders where store_id = p_store_id group by status) s),
    'erros_24h',         (select count(*) from public.application_logs where level='error' and created_at >= now() - interval '24 hours'),
    'taxa_erro_pct',     (select case when (p+e)=0 then 0 else round(100.0*e/(p+e),1) end
                          from (select (select count(*) from public.orders where store_id = p_store_id and created_at>=now()-interval '24 hours') p,
                                       (select count(*) from public.application_logs where level='error' and created_at>=now()-interval '24 hours') e) x),
    'divergencias',      (select count(*) from public.v_order_reconciliation v join public.orders o on o.id=v.order_id where o.store_id = p_store_id and abs(v.diff) > 0.005),
    'logs_total',        (select count(*) from public.application_logs),
    'serie_7d',          (select jsonb_agg(jsonb_build_object('dia',to_char(d,'DD/MM'),
                            'n',(select count(*) from public.orders o where o.store_id = p_store_id and public.dia_loja(o.created_at) = d::date)) order by d)
                          from generate_series(public.dia_loja(now()) - 6, public.dia_loja(now()), interval '1 day') d),
    'serie_30d',         (select jsonb_agg(jsonb_build_object('dia',to_char(d,'DD/MM'),
                            'n',(select count(*) from public.orders o where o.store_id = p_store_id and public.dia_loja(o.created_at) = d::date)) order by d)
                          from generate_series(public.dia_loja(now()) - 29, public.dia_loja(now()), interval '1 day') d),
    'gerado_em',         now()
  );
end;
$function$;

-- ===== 8. RLS: is_admin() cego -> is_admin_of(store_id); "le proprios" ganham correlacao de loja =====
-- admin_orders_search/admin_orders_stats/admin_order_endereco NAO sao SECURITY DEFINER -- herdam a
-- nova escopagem automaticamente via RLS de orders/order_items, sem precisar de nenhuma mudanca no
-- proprio codigo delas (validado no script de teste).

ALTER POLICY "Admin all orders" ON public.orders USING (public.is_admin_of(store_id)) WITH CHECK (public.is_admin_of(store_id));
DROP POLICY "Cliente le proprios orders" ON public.orders;
CREATE POLICY "Cliente le proprios orders" ON public.orders
  FOR SELECT TO authenticated
  USING (customer_id IN (SELECT c.id FROM public.customers c WHERE c.auth_user_id = auth.uid() AND c.store_id = orders.store_id));

ALTER POLICY "Admin all order_items" ON public.order_items USING (public.is_admin_of(store_id)) WITH CHECK (public.is_admin_of(store_id));
DROP POLICY "Cliente le proprios order_items" ON public.order_items;
CREATE POLICY "Cliente le proprios order_items" ON public.order_items
  FOR SELECT TO authenticated
  USING (order_id IN (
    SELECT o.id FROM public.orders o
    WHERE o.customer_id IN (SELECT c.id FROM public.customers c WHERE c.auth_user_id = auth.uid() AND c.store_id = o.store_id)
  ));

DROP POLICY "order_events_read_own" ON public.order_events;
CREATE POLICY "order_events_read_own" ON public.order_events
  FOR SELECT TO authenticated
  USING (
    public.is_admin_of(store_id)
    OR order_id IN (
      SELECT o.id FROM public.orders o
      WHERE o.customer_id IN (SELECT c.id FROM public.customers c WHERE c.auth_user_id = auth.uid() AND c.store_id = o.store_id)
    )
  );

ALTER POLICY "loyalty_accounts_admin_all" ON public.loyalty_accounts USING (public.is_admin_of(store_id)) WITH CHECK (public.is_admin_of(store_id));
DROP POLICY "loyalty_accounts_read_own" ON public.loyalty_accounts;
CREATE POLICY "loyalty_accounts_read_own" ON public.loyalty_accounts
  FOR SELECT TO authenticated
  USING (
    public.is_admin_of(store_id)
    OR customer_id IN (SELECT c.id FROM public.customers c WHERE c.auth_user_id = auth.uid() AND c.store_id = loyalty_accounts.store_id)
  );

ALTER POLICY "loyalty_events_admin_all" ON public.loyalty_events USING (public.is_admin_of(store_id)) WITH CHECK (public.is_admin_of(store_id));
DROP POLICY "loyalty_events_read_own" ON public.loyalty_events;
CREATE POLICY "loyalty_events_read_own" ON public.loyalty_events
  FOR SELECT TO authenticated
  USING (
    public.is_admin_of(store_id)
    OR customer_id IN (SELECT c.id FROM public.customers c WHERE c.auth_user_id = auth.uid() AND c.store_id = loyalty_events.store_id)
  );

ALTER POLICY "notification_outbox_admin_read" ON public.notification_outbox USING (public.is_admin_of(store_id));

COMMIT;
