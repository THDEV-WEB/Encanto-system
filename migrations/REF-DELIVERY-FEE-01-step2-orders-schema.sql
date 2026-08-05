-- REF-DELIVERY-FEE-01 · Passo 2 — Persiste a taxa de entrega e o acrescimo de maquininha no PEDIDO.
-- Aditivo, idempotente, reversivel (companion: REF-DELIVERY-FEE-01-step2-orders-schema-rollback.sql).
--
-- POR QUE COLUNA DEDICADA (nao jsonb generico)? Auditoria confirmou que `orders` nunca teve campo JSON
-- generico — todo dado novo desta tabela sempre entrou como coluna tipada dedicada (endereco_id, request_id,
-- etc. — ver REF-ADDRESS-02 · Onda 1/6). Mantem o mesmo padrao: 2 colunas numericas, DEFAULT 0 (pedidos
-- antigos e retirada continuam com taxa 0, sem re-processar historico), CHECK >= 0 (defesa em profundidade,
-- mesmo que o servidor ja valide em create_order).
--
-- create_order: MESMA assinatura (p_customer, p_order, p_items, p_request_id) — so o CORPO passa a ler 2
-- chaves opcionais `delivery_fee`/`maquininha_fee` de dentro do p_order jsonb ja existente (mesmo veiculo de
-- `address`/`payment_method`/`endereco_id`). Ausentes -> 0 (compat total com qualquer chamador antigo).
-- NAO recalcula a taxa a partir da distancia (esse calculo e do CLIENTE, camada services/delivery/
-- deliveryFeeRules.js, Onda 2 desta ref) — mesma divisao de responsabilidade que ja existe para `total`
-- (calculado em pricing.js, o servidor so valida >=0/formato). Preserva o comportamento existente de nao
-- recalcular total a partir dos itens.
--
-- admin_orders_search: assinatura de PARAMETROS intacta; o RETURNS TABLE ganha 2 colunas -> exige DROP
-- (Postgres nao permite CREATE OR REPLACE mudar o formato de retorno), mesmo procedimento usado em
-- REF-DATETIME-01b quando o tipo do cursor mudou.
--
-- Ground truth via introspecao direta (2026-08-05): corpo de create_order confirmado identico ao capturado
-- em REF-ADDRESS-02-onda6-create-order.sql (ultima versao vigente); admin_orders_search confirmada como
-- redefinida pela ultima vez em REF-DATETIME-01b-schema-timestamptz.sql (assinatura com timestamptz).

BEGIN;

-- ── 1) Colunas novas em orders ────────────────────────────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_fee numeric NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0);
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS maquininha_fee numeric NOT NULL DEFAULT 0 CHECK (maquininha_fee >= 0);

-- ── 2) create_order: le delivery_fee/maquininha_fee (opcionais, default 0, valida >=0) e persiste. ──
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
    -- REF-DELIVERY-FEE-01: delivery_fee/maquininha_fee opcionais, lidos de dentro de p_order (mesmo veiculo
    -- dos demais campos livres). Ausentes -> 0, igual a qualquer pedido de hoje (retirada, ou entrega sem
    -- coordenadas — o calculo/decisao de aplicar taxa e do cliente, ver services/delivery/deliveryFeeRules.js).
    insert into public.orders (customer_id, total, status, payment_method, address, observacoes, request_id, endereco_id, delivery_fee, maquininha_fee)
      values (v_customer_id, v_total, v_status, v_pay, v_addr, v_obs, p_request_id,
              nullif(btrim(p_order->>'endereco_id'), '')::uuid, v_delivery_fee, v_maquininha_fee) returning id into v_order_id;
    insert into public.order_items (order_id, product_id, nome_produto, quantity, price, preco_unitario, adicionais, observacoes)
      select v_order_id, nullif(btrim(item->>'product_id'),'')::uuid, item->>'nome_produto',
             (item->>'quantity')::int, (item->>'price')::numeric,
             coalesce((item->>'preco_unitario')::numeric,(item->>'price')::numeric),
             coalesce(item->'adicionais','[]'::jsonb), nullif(btrim(item->>'observacoes'),'')
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

-- ── 3) admin_orders_search: RETURNS TABLE ganha delivery_fee/maquininha_fee -> exige DROP+CREATE. ──
DROP FUNCTION IF EXISTS public.admin_orders_search(text, text, int, timestamptz, uuid);

CREATE OR REPLACE FUNCTION public.admin_orders_search(
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit int DEFAULT 20,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid, customer_id uuid, total numeric, status text, payment_method text,
  address text, created_at timestamptz, observacoes text, request_id uuid,
  delivery_fee numeric, maquininha_fee numeric,
  customers jsonb, order_items jsonb
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT
    o.id, o.customer_id, o.total, o.status, o.payment_method, o.address, o.created_at,
    o.observacoes, o.request_id, o.delivery_fee, o.maquininha_fee,
    CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('name', c.name, 'phone', c.phone) END AS customers,
    coalesce(
      (SELECT jsonb_agg(to_jsonb(oi.*)) FROM public.order_items oi WHERE oi.order_id = o.id),
      '[]'::jsonb
    ) AS order_items
  FROM public.orders o
  LEFT JOIN public.customers c ON c.id = o.customer_id
  WHERE (p_status IS NULL OR o.status = p_status)
    AND (
      p_search IS NULL OR btrim(p_search) = ''
      OR c.name ILIKE '%' || p_search || '%'
      OR c.phone ILIKE '%' || p_search || '%'
      OR replace(o.id::text, '-', '') ILIKE '%' || replace(p_search, '-', '') || '%'
    )
    AND (
      p_cursor_created_at IS NULL
      OR (o.created_at, o.id) < (p_cursor_created_at, p_cursor_id)
    )
  ORDER BY o.created_at DESC, o.id DESC
  LIMIT greatest(1, least(coalesce(p_limit, 20), 100));
$$;

-- Grants: explicitos sempre (o DROP acima apagou o ACL antigo, precisa reemitir — mesmo padrao de
-- REF-DATETIME-01b). Mesma lista de grantees da versao anterior.
GRANT EXECUTE ON FUNCTION public.admin_orders_search(text, text, int, timestamptz, uuid) TO PUBLIC, anon, authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── VERIFICACAO (rodar manualmente apos aplicar) ──────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name IN ('delivery_fee','maquininha_fee');
-- SELECT count(*) FROM orders WHERE delivery_fee <> 0 OR maquininha_fee <> 0;  -- deve ser 0 ate o primeiro pedido novo
-- SELECT * FROM admin_orders_search(null,null,3,null,null);  -- confere que delivery_fee/maquininha_fee aparecem (0 nos pedidos antigos)
