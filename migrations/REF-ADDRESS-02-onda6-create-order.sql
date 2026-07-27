-- ADR REF-ADDRESS-02 · Onda 6 — Liga o endereço estruturado ao pedido (create_order)
-- Aditivo, idempotente, reversível (companion: REF-ADDRESS-02-onda6-create-order-rollback.sql).
-- Assinatura de create_order NÃO muda (mesmos 4 parâmetros) — só o CORPO passa a ler uma chave
-- opcional `endereco_id` de dentro do p_order jsonb já existente (mesmo veículo de `address`,
-- `payment_method`, `observacoes`) e gravá-la em orders.endereco_id (coluna/FK já existentes desde
-- antes da Onda 1, sempre NULL até aqui — 0/80 pedidos). Pedidos antigos e chamadas que não enviarem
-- essa chave continuam idênticos a hoje (nullif(btrim(null),'')::uuid = NULL, mesmo default da coluna).
-- O cast ::uuid fica DENTRO do bloco protegido (begin...exception when others), no mesmo padrão já
-- usado para `item->>'product_id'` — um uuid malformado devolve {ok:false,...} em vez de propagar erro
-- cru, igual a qualquer outra validação desta função.
-- Ground truth via introspecção direta (2026-07-27): corpo ANTERIOR de create_order confirmado
-- idêntico ao capturado na Onda 1; orders.endereco_id existe com FK -> addresses(id), 80/80 pedidos
-- com endereco_id NULL (nenhum caminho grava nele hoje).

BEGIN;

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
    -- REF-ADDRESS-02 · Onda 6: endereco_id opcional, lido de dentro de p_order (mesmo veiculo dos
    -- demais campos livres). Ausente/invalido -> NULL, igual a qualquer pedido de hoje.
    insert into public.orders (customer_id, total, status, payment_method, address, observacoes, request_id, endereco_id)
      values (v_customer_id, v_total, v_status, v_pay, v_addr, v_obs, p_request_id,
              nullif(btrim(p_order->>'endereco_id'), '')::uuid) returning id into v_order_id;
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

COMMIT;

-- Verificação pós-aplicação (rodar manualmente se aplicar fora do runner administrativo):
-- SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='create_order';
-- SELECT count(*) FROM orders WHERE endereco_id IS NOT NULL;  -- deve crescer só a partir de pedidos novos com entrega
