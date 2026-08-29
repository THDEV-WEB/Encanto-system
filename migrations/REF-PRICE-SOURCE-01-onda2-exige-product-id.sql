-- REF-PRICE-SOURCE-01 · Onda 2 -- fecha o vetor residual documentado na Onda 1: item SEM product_id
-- ainda confiava no price enviado pelo client.
--
-- INVESTIGACAO (antes de qualquer mudanca de codigo): provado com teste Playwright real
-- (e2e/tests/checkout/_prova-mock-catalog.spec.js, descartado apos a prova) que o caminho E' real e
-- perigoso, nao apenas fallback visual:
--   1. get_store_by_domain() falha/expira (StorefrontProvider.jsx, RPC_TIMEOUT) -- pode acontecer com
--      o resto do Supabase 100% saudavel (timeout so' dessa RPC, erro pontual, resposta inesperada).
--   2. Quando isso ocorre, useProducts/useCategories/useAdicionais caem TODOS no mockCatalog.js (preco
--      real hardcoded, ex.: "Marmita Média + Açaí 300 ml" = R$29,90) -- storefrontResolvedBus.js emite
--      false, storefrontResolutionSucceeded()===false.
--   3. O client NUNCA usa esse sinal para bloquear nada: StoreApp.jsx extrai catSrc/prodSrc dos hooks
--      mas nunca os LE (confirmado pelo proprio lint: "'catSrc'/'prodSrc' is assigned a value but
--      never used") -- nenhum bloqueio de checkout existia antes desta onda.
--   4. create_order() continua 100% operacional (deriva a loja do header Origin real do navegador,
--      nunca do estado de resolucao client-side) -- so' o CATALOGO caiu no mock, nao o backend inteiro.
--   5. Itens do mock tem id nao-uuid (ex. 'pd1') -> isUuid() falha -> product_id vira null no payload
--      -> ate a Onda 1, create_order() aceitava o price do client para esse caso ("comportamento
--      legado preservado").
--   PROVA EMPIRICA (teste real via browser, RPC get_store_by_domain abortada via page.route, resto do
--   Supabase saudavel): checkout finalizou normalmente ("Pedido realizado com sucesso!") e um pedido
--   REAL foi persistido no banco com total=R$29,90 -- exatamente o preco do mock, para um produto que
--   NAO existe na tabela products. Nao e' fallback visual: participa efetivamente da criacao de
--   pedido financeiro real.
--
-- CORRECAO: create_order() passa a EXIGIR product_id valido (uuid) em TODO item, sem excecao --
-- remove o branch "sem product_id, confia no price do client" introduzido/preservado na Onda 1. Item
-- sem product_id valido rejeita o PEDIDO INTEIRO (fail-closed, mesmo padrao ja usado para produto
-- inexistente/de outro tenant). Nenhum item financeiro real escapa mais da resolucao server-side por
-- omitir product_id -- a autoridade do preco fica 100% fechada no servidor, sem excecao.
--
-- Efeito colateral desejado (fecha o achado do mockCatalog documentado na Onda 1): um pedido com
-- QUALQUER item vindo do catalogo mock passa a ser rejeitado pelo servidor, mesmo que o client tente
-- enviar o payload direto (bypass de UI, curl, app modificado). A camada complementar no client
-- (CheckoutPage.jsx: bloqueia o SUBMIT quando o catalogo nao veio do banco, ver commit desta onda)
-- evita que o cliente sequer tente -- mas quem fecha a vulnerabilidade de verdade e' esta migration.
--
-- ADAPTACAO NECESSARIA (nao mencionada como opcional -- exigencia desta onda, "nao apagar testes"):
-- scripts/saas01-onda4-1-pedidos-test.mjs (CHECKOUT-P1/P2) e scripts/harden-orders-rls-test.mjs
-- (AC1/AC2) chamavam create_order() com item sem product_id -- ajustados neste commit para usar um
-- product_id real (produto de teste inserido dentro da MESMA transacao ROLLBACK, nunca persistido),
-- preservando o proposito original de cada teste (RLS/ACL/idempotencia; isolamento multi-tenant;
-- fidelidade) sem depender mais do comportamento que esta migration remove.
--
-- Resto do corpo de create_order() (resolucao de loja/tenant, idempotencia, upsert de customer,
-- loyalty_grant, log de erro) permanece IDENTICO a Onda 1 -- so o tratamento de product_id ausente
-- muda, de "aceita o price do client" para "rejeita o pedido".

BEGIN;

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
  v_tenant       uuid := nullif(auth.jwt()->>'tenant_id', '')::uuid;
  v_store_id     uuid;
  v_items_resolved jsonb := '[]'::jsonb;
  v_pid            uuid;
  v_calc           jsonb;
  v_item_price     numeric;
begin
  if p_request_id is not null then
    select id into v_order_id from public.orders where request_id = p_request_id;
    if v_order_id is not null then return jsonb_build_object('ok', true, 'order_id', v_order_id, 'idempotent', true); end if;
  end if;

  if not public._rate_limit_hit('create_order', 60, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'error', 'muitas tentativas, aguarde um momento');
  end if;

  if v_tenant is not null then
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

      -- REF-PRICE-SOURCE-01 · Onda 2: product_id deixa de ser opcional. Nenhum item financeiro real
      -- pode mais escapar da resolucao server-side omitindo product_id -- fail-closed, mesma mensagem
      -- de "produto invalido" ja usada para produto inexistente/de outro tenant (anti-enumeracao).
      v_pid := nullif(btrim(v_elem->>'product_id'), '')::uuid;
      if v_pid is null then
        raise exception 'item "%" sem produto valido', v_elem->>'nome_produto';
      end if;

      -- preco autoritativo -- nunca confia em v_elem->>'price'. _resolve_item_pricing lanca excecao
      -- (capturada abaixo) se o produto/adicional for invalido, inativo ou de outra loja.
      v_calc := public._resolve_item_pricing(v_store_id, v_pid, nullif(btrim(v_elem->>'tamanho_label'), ''),
                                              coalesce(v_elem->'adicionais', '[]'::jsonb));
      v_item_price := (v_calc->>'preco_unitario')::numeric;
      v_items_resolved := v_items_resolved || jsonb_build_array(jsonb_build_object(
        'product_id', v_pid, 'nome_produto', v_elem->>'nome_produto',
        'quantity', (v_elem->>'quantity')::int, 'price', v_item_price, 'preco_unitario', v_item_price,
        'adicionais', v_calc->'adicionais', 'observacoes', nullif(btrim(v_elem->>'observacoes'), '')
      ));
    end loop;

    -- orders.total: soma dos itens (todos autoritativos agora) + delivery_fee/maquininha_fee (fora de
    -- escopo, seguem vindas do client sem validacao adicional -- achado documentado separadamente).
    select coalesce(sum((item->>'preco_unitario')::numeric * (item->>'quantity')::numeric), 0)
      into v_total
      from jsonb_array_elements(v_items_resolved) as t(item);
    v_total := v_total + v_delivery_fee + v_maquininha_fee;
    if v_total <= 0 then raise exception 'total deve ser > 0 (recebido %)', v_total; end if;

    -- REF-PROD-GOLIVE-01 (complemento, fecha vetor secundario): so sobrescreve o nome quando o
    -- customer existente ainda nao tem dono (guest/orfao) ou o dono e o proprio chamador -- nunca
    -- mais quando pertence a outra conta autenticada.
    insert into public.customers (name, phone, store_id) values (v_name, v_phone, v_store_id)
      on conflict (store_id, phone) do update
        set name = case
          when public.customers.auth_user_id is null or public.customers.auth_user_id = auth.uid()
            then excluded.name
          else public.customers.name
        end
      returning id into v_customer_id;
    insert into public.orders (customer_id, total, status, payment_method, address, observacoes, request_id, endereco_id, delivery_fee, maquininha_fee, store_id)
      values (v_customer_id, v_total, v_status, v_pay, v_addr, v_obs, p_request_id,
              nullif(btrim(p_order->>'endereco_id'), '')::uuid, v_delivery_fee, v_maquininha_fee, v_store_id) returning id into v_order_id;
    insert into public.order_items (order_id, product_id, nome_produto, quantity, price, preco_unitario, adicionais, observacoes, store_id)
      select v_order_id, (item->>'product_id')::uuid, item->>'nome_produto',
             (item->>'quantity')::int, (item->>'price')::numeric, (item->>'preco_unitario')::numeric,
             coalesce(item->'adicionais','[]'::jsonb), item->>'observacoes', v_store_id
      from jsonb_array_elements(v_items_resolved) as t(item);

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
        values('orders','create_order','order',null,p_request_id,'create_order','price-source-01-onda2',v_dur,'error',v_err,v_log,v_state,'unique_violation',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
    when others then
      v_err := sqlerrm; v_state := sqlstate; v_dur := extract(epoch from clock_timestamp()-v_t0)*1000;
      begin insert into public.application_logs(module,operation,entity,entity_id,request_id,rpc,version,duration_ms,level,message,payload,sqlstate,context,origin)
        values('orders','create_order','order',null,p_request_id,'create_order','price-source-01-onda2',v_dur,'error',v_err,v_log,v_state,'create_order',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
  end;
end;$function$;

COMMIT;
