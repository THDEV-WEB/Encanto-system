-- ============================================================================
-- REF-MESA-01 · Onda 8 — Reconciliação com REF-DELIVERY-FEE-05
-- ----------------------------------------------------------------------------
-- CONFLITO ENCONTRADO (precheck da REF-MESA-02, Onda 1, 2026-09-04): a migration
-- migrations/REF-DELIVERY-FEE-05-onda2-adicional-pagamento.sql reescreveu
-- create_order()/admin_orders_search() inteiros a partir da baseline de PRODUÇÃO
-- (que nunca teve Mesa aplicada) e foi de fato aplicada, permanentemente, em
-- produção E no banco de E2E dedicado. Isso apagou a lógica de Mesa (tipo_pedido/
-- origem_pedido/mesa_identificador, capability checks das Ondas 1/3/4) do E2E —
-- as colunas continuavam existindo em orders, mas create_order() parou de as
-- ler/validar/persistir. Confirmado com evidência concreta: rodar
-- scripts/mesa-01-onda1-fundacao-test.mjs contra o E2E, pós-DELIVERY-FEE-05,
-- caiu de 26/26 para 14 PASS / 11 FAIL — todo pedido tipo_pedido='mesa' passou
-- a falhar com "address e obrigatorio".
--
-- BASELINE CANÔNICA (por instrução explícita do dono do produto — NÃO restaurar
-- uma versão antiga de create_order()): o corpo atual, confirmado byte-a-byte
-- idêntico entre migrations/REF-DELIVERY-FEE-05-onda2-adicional-pagamento.sql e
-- o create_order()/admin_orders_search() REALMENTE ao vivo em produção (introspecção
-- read-only, BEGIN;SET TRANSACTION READ ONLY;...;ROLLBACK, 2026-09-04, zero escrita).
-- Esta migration PARTE desse corpo e reincorpora por cima, cirurgicamente, só o
-- que pertence à REF-MESA-01 -- nada do que a REF-DELIVERY-FEE-05 introduziu
-- (adicional_pagamento_fee: variável, cálculo, checagem de divergência, coluna em
-- orders, coluna em admin_orders_search) é removido, substituído ou neutralizado.
--
-- O QUE FOI REINCORPORADO (comparado por diff textual entre
-- REF-MESA-01-onda4-canal-admin.sql e REF-DELIVERY-FEE-05-onda2, ambos filhos do
-- mesmo ancestral comum REF-ADDRESS-GEO-INTEGRITY-01-onda2-parte2/REF-PROD-GOLIVE-01):
--   1. Declaração de v_tipo_pedido/v_origem_pedido/v_mesa_identificador/v_mesa_cfg.
--   2. Bloco de capability de Mesa (mesa_habilitada/mesa_canal_qr/mesa_canal_admin +
--      is_admin_of para admin_garcom), logo após resolver v_store_id -- IDÊNTICO
--      à Onda 4, nenhuma mensagem de erro nova, nenhuma regra nova.
--   3. Validação de tipo_pedido/origem_pedido (valores permitidos) e a regra de
--      endereço opcional para Mesa (`address` vira 'Mesa <identificador>' quando
--      ausente) -- IDÊNTICA à Onda 4.
--   4. `_resolve_delivery_fee` passa a receber `(v_tipo_pedido <> 'entrega')` no
--      lugar de `v_retirada` sozinho -- Mesa reaproveita o MESMO ramo "sem taxa"
--      que Retirada já tinha (e que, por construção, já zera adicional_pagamento_fee
--      também -- ver _resolve_delivery_fee, ramo `IF p_retirada THEN RETURN
--      {delivery_fee:0, maquininha_fee:0, adicional_pagamento_fee:0}` — NENHUMA
--      mudança nessa função foi necessária, o contrato já era extensível por
--      construção, exatamente como o cabeçalho da própria Onda 2 do Delivery-Fee-05
--      já antecipava).
--   5. INSERT em orders passa a incluir tipo_pedido/origem_pedido/mesa_identificador
--      JUNTO com adicional_pagamento_fee (nenhuma coluna das duas REFs é omitida).
--
-- O QUE FOI PRESERVADO INTEGRALMENTE da REF-DELIVERY-FEE-05 (nada alterado):
--   - v_adicional_pagamento_fee: cálculo via _resolve_delivery_fee, checagem de
--     divergência em centavos, soma em v_total, coluna em orders.
--   - _resolve_delivery_fee/get_delivery_fee_config/set_delivery_fee_config: NÃO
--     tocadas por esta migration (permanecem exatamente como a Onda 2 deixou).
--
-- admin_orders_search(): mesmo raciocínio -- RETURNS TABLE precisa das 3 colunas
-- de Mesa E de adicional_pagamento_fee simultaneamente (nenhuma REF por si só
-- tinha as duas). GRANT: a migration original da REF-MESA-01-onda5 assumia
-- "TO PUBLIC"; o comentário da REF-DELIVERY-FEE-05-onda2 afirmava ter confirmado
-- "TO authenticated" em produção. Reconferido agora, ao vivo, nos DOIS ambientes
-- (produção e E2E): o grant real inclui PUBLIC (que subsume anon/authenticated/
-- service_role) -- esta migration restaura exatamente isso, TO PUBLIC, por ser o
-- que está genuinamente em vigor hoje (a autorização real é sempre o is_admin_of()
-- dentro do corpo da função, o GRANT de EXECUTE nunca foi a camada de segurança).
--
-- REGRAS RESPEITADAS (autorização explícita do dono, 2026-09-04):
--   - Nenhuma migration aplicada em produção nesta REF -- só testada no E2E dedicado.
--   - Nenhuma parte nova da REF-MESA-02 (mesa_sessions) implementada aqui.
--   - Nenhuma alteração ao modelo de Delivery/Retirada além de restaurar
--     `(v_tipo_pedido <> 'entrega')` no lugar de `v_retirada` (que é comportamento
--     IDÊNTICO para entrega/retirada -- só muda para o tipo novo 'mesa').
--
-- Testes: scripts/mesa-01-onda8-reconciliacao-test.mjs (novo, intersecção Mesa ×
-- adicional_pagamento_fee) + regressão completa de scripts/mesa-01-onda{1,3,4,5,6,7}-*
-- e scripts/delivery-fee-05-onda1-onda2-test.mjs (ambas devem voltar/continuar 100%).
-- Rollback: REF-MESA-01-onda8-reconciliacao-delivery-fee-05-rollback.sql (restaura
-- exatamente o estado da REF-DELIVERY-FEE-05-onda2, isto é, o estado imediatamente
-- anterior a esta migration).
-- ============================================================================

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
  v_delivery_fee    numeric;
  v_maquininha_fee  numeric;
  v_adicional_pagamento_fee numeric;
  v_retirada        boolean := coalesce((nullif(btrim(p_order->>'retirada'), ''))::boolean, false);
  v_tipo_pedido     text := coalesce(nullif(btrim(p_order->>'tipo_pedido'), ''), case when v_retirada then 'retirada' else 'entrega' end);
  v_origem_pedido   text := coalesce(nullif(btrim(p_order->>'origem_pedido'), ''), 'storefront');
  v_mesa_identificador text := nullif(btrim(p_order->>'mesa_identificador'), '');
  v_mesa_cfg        jsonb;
  v_endereco_id     uuid := nullif(btrim(p_order->>'endereco_id'), '')::uuid;
  v_fee_calc        jsonb;
  v_elem   jsonb; v_err text; v_state text;
  v_t0     timestamptz := clock_timestamp(); v_dur numeric;
  v_log    jsonb := jsonb_build_object(
              'n_items', case when jsonb_typeof(p_items)='array' then jsonb_array_length(p_items) else null end,
              'total', p_order->>'total', 'has_request_id', (p_request_id is not null),
              'tipo_pedido', v_tipo_pedido, 'origem_pedido', v_origem_pedido);
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

  -- REF-MESA-01 · Onda 1: capacidade de Mesa e' opt-in por loja (default seguro = desabilitada).
  -- REF-MESA-01 · Onda 3: canal QR e' capacidade SEPARADA (mesa_canal_qr).
  -- REF-MESA-01 · Onda 4: canal Admin/garcom e' capacidade SEPARADA (mesa_canal_admin) -- E exige
  -- que o CHAMADOR seja admin autenticado DAQUELA loja (is_admin_of). Diferente de qr_mesa (canal do
  -- cliente final, guest ou logado, sem checagem de papel), admin_garcom e' o operador da loja
  -- lancando pedido em nome de um cliente presencial -- sem essa checagem, qualquer authenticated
  -- (nao so' quem opera a loja) poderia se passar por garcom. REINCORPORADO byte-a-byte pela Onda 8
  -- (reconciliacao com REF-DELIVERY-FEE-05) -- nenhuma mudanca de comportamento vs. a Onda 4.
  if v_tipo_pedido = 'mesa' then
    v_mesa_cfg := public.get_mesa_config(v_store_id);
    if not coalesce((v_mesa_cfg->>'habilitada')::boolean, false) then
      return jsonb_build_object('ok', false, 'error', 'modalidade indisponivel para esta loja');
    end if;
    if v_origem_pedido = 'qr_mesa' and not coalesce((v_mesa_cfg->>'canal_qr')::boolean, false) then
      return jsonb_build_object('ok', false, 'error', 'canal indisponivel para esta loja');
    end if;
    if v_origem_pedido = 'admin_garcom' then
      if not coalesce((v_mesa_cfg->>'canal_admin')::boolean, false) then
        return jsonb_build_object('ok', false, 'error', 'canal indisponivel para esta loja');
      end if;
      if not public.is_admin_of(v_store_id) then
        return jsonb_build_object('ok', false, 'error', 'sem permissao');
      end if;
    end if;
  elsif v_origem_pedido in ('qr_mesa', 'admin_garcom') then
    -- origem_pedido de mesa sem tipo_pedido='mesa' nao faz sentido -- combinacao invalida.
    return jsonb_build_object('ok', false, 'error', 'canal indisponivel para esta loja');
  end if;

  begin
    if p_customer is null or jsonb_typeof(p_customer) <> 'object' then raise exception 'p_customer ausente/invalido'; end if;
    if v_name  is null then raise exception 'name do cliente e obrigatorio'; end if;
    if v_phone is null then raise exception 'telefone do cliente e obrigatorio'; end if;
    if p_order is null or jsonb_typeof(p_order) <> 'object' then raise exception 'p_order ausente/invalido'; end if;
    if v_pay  is null then raise exception 'payment_method e obrigatorio'; end if;

    -- REINCORPORADO da Onda 4 (validacao de valores permitidos + endereco opcional pra Mesa).
    if v_tipo_pedido not in ('entrega', 'retirada', 'mesa') then
      raise exception 'tipo_pedido invalido';
    end if;
    if v_origem_pedido not in ('storefront', 'qr_mesa', 'admin_garcom') then
      raise exception 'origem_pedido invalido';
    end if;
    -- Mesa: endereco NUNCA e' obrigatorio (nao entrega, nao geocoding). `address` continua NOT NULL
    -- na tabela por compatibilidade ampla -- vira so um TEXTO DE EXIBICAO derivado do identificador
    -- estruturado, nunca mais a fonte de verdade do tipo (essa e' a razao de existir da REF-MESA-01).
    if v_tipo_pedido = 'mesa' then
      if v_mesa_identificador is null then raise exception 'identificacao da mesa e obrigatoria'; end if;
      if v_addr is null then v_addr := 'Mesa ' || v_mesa_identificador; end if;
    elsif v_mesa_identificador is not null then
      raise exception 'mesa_identificador so e valido para tipo_pedido mesa';
    end if;

    if v_addr is null then raise exception 'address e obrigatorio'; end if;

    -- REF-ADDRESS-GEO-INTEGRITY-01 · Onda 2, Parte 2: ownership de endereco_id. INTOCADO por esta
    -- reconciliacao (identico em ambas as linhagens que convergem aqui).
    if v_endereco_id is not null then
      if auth.uid() is not null then
        if not exists (
          select 1 from public.addresses a
          where a.id = v_endereco_id and a.store_id = v_store_id
            and (a.customer_id is null or a.customer_id in (select c.id from public.customers c where c.auth_user_id = auth.uid()))
        ) then
          v_endereco_id := null;
        end if;
      else
        if not exists (
          select 1 from public.addresses a where a.id = v_endereco_id and a.store_id = v_store_id and a.customer_id is null
        ) then
          v_endereco_id := null;
        end if;
      end if;
    end if;

    -- REF-DELIVERY-FEE-04 · Onda 1: delivery_fee/maquininha_fee SEMPRE recalculados aqui. REF-
    -- DELIVERY-FEE-05 · Onda 2: adicional_pagamento_fee entra no MESMO pacote autoritativo -- o que
    -- o client mandou em p_order->>'delivery_fee'/'maquininha_fee'/'adicional_pagamento_fee' nunca e'
    -- usado para PERSISTIR (PRESERVADO integralmente da Onda 2 do Delivery-Fee-05).
    -- REF-MESA-01 · Onda 1 (REINCORPORADO): Mesa reaproveita o MESMO ramo "sem taxa" que retirada ja
    -- tinha em _resolve_delivery_fee (funcao NAO tocada por esta migration) -- so muda o booleano que
    -- create_order passa pra ela; esse ramo ja zera as 3 taxas (incluindo adicional_pagamento_fee),
    -- entao Mesa nunca paga adicional de pagamento por construcao, sem nenhuma mudanca em
    -- _resolve_delivery_fee.
    v_fee_calc := public._resolve_delivery_fee(v_store_id, (v_tipo_pedido <> 'entrega'), v_pay, v_endereco_id);
    v_delivery_fee := (v_fee_calc->>'delivery_fee')::numeric;
    v_maquininha_fee := (v_fee_calc->>'maquininha_fee')::numeric;
    v_adicional_pagamento_fee := (v_fee_calc->>'adicional_pagamento_fee')::numeric;

    -- REF-DELIVERY-FEE-04 · Onda 2 + REF-DELIVERY-FEE-05 · Onda 2: mesma mecanica de divergencia
    -- (comparacao em CENTAVOS, sem tolerancia arbitraria), agora com os 3 componentes -- PRESERVADO
    -- integralmente.
    if (p_order ? 'delivery_fee' and round(coalesce((p_order->>'delivery_fee')::numeric,0)*100) <> round(v_delivery_fee*100))
       or (p_order ? 'maquininha_fee' and round(coalesce((p_order->>'maquininha_fee')::numeric,0)*100) <> round(v_maquininha_fee*100))
       or (p_order ? 'adicional_pagamento_fee' and round(coalesce((p_order->>'adicional_pagamento_fee')::numeric,0)*100) <> round(v_adicional_pagamento_fee*100))
    then
      return jsonb_build_object('ok', false, 'error', 'valor da entrega foi atualizado, confirme novamente',
        'divergencia_valor', true, 'delivery_fee', v_delivery_fee, 'maquininha_fee', v_maquininha_fee,
        'adicional_pagamento_fee', v_adicional_pagamento_fee);
    end if;

    if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'p_items deve ser um array'; end if;
    if jsonb_array_length(p_items) = 0 then raise exception 'p_items nao pode ser vazio'; end if;
    for v_elem in select value from jsonb_array_elements(p_items) loop
      if nullif(btrim(v_elem->>'nome_produto'), '') is null then raise exception 'item sem nome_produto'; end if;
      if nullif(btrim(v_elem->>'quantity'), '') is null or (v_elem->>'quantity')::numeric <= 0 then
        raise exception 'item "%" com quantity invalida', v_elem->>'nome_produto'; end if;

      -- REF-PRICE-SOURCE-01 · Onda 2: product_id obrigatorio -- fail-closed. INTOCADO.
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

    -- orders.total: soma dos itens (autoritativos) + delivery_fee/maquininha_fee/adicional_pagamento_fee
    -- (todos autoritativos) -- PRESERVADO integralmente da Onda 2 do Delivery-Fee-05.
    select coalesce(sum((item->>'preco_unitario')::numeric * (item->>'quantity')::numeric), 0)
      into v_total
      from jsonb_array_elements(v_items_resolved) as t(item);
    v_total := v_total + v_delivery_fee + v_maquininha_fee + v_adicional_pagamento_fee;
    if v_total <= 0 then raise exception 'total deve ser > 0 (recebido %)', v_total; end if;

    -- REF-PROD-GOLIVE-01 (complemento, fecha vetor secundario): so sobrescreve o nome quando o
    -- customer existente ainda nao tem dono (guest/orfao) ou o dono e o proprio chamador -- nunca
    -- mais quando pertence a outra conta autenticada. INTOCADO.
    insert into public.customers (name, phone, store_id) values (v_name, v_phone, v_store_id)
      on conflict (store_id, phone) do update
        set name = case
          when public.customers.auth_user_id is null or public.customers.auth_user_id = auth.uid()
            then excluded.name
          else public.customers.name
        end
      returning id into v_customer_id;
    -- REINCORPORADO: tipo_pedido/origem_pedido/mesa_identificador JUNTO com adicional_pagamento_fee
    -- -- nenhuma coluna de nenhuma das 2 REFs e' omitida.
    insert into public.orders (customer_id, total, status, payment_method, address, observacoes, request_id, endereco_id, delivery_fee, maquininha_fee, adicional_pagamento_fee, store_id, tipo_pedido, origem_pedido, mesa_identificador)
      values (v_customer_id, v_total, v_status, v_pay, v_addr, v_obs, p_request_id,
              v_endereco_id, v_delivery_fee, v_maquininha_fee, v_adicional_pagamento_fee, v_store_id,
              v_tipo_pedido, v_origem_pedido, v_mesa_identificador) returning id into v_order_id;
    insert into public.order_items (order_id, product_id, nome_produto, quantity, price, preco_unitario, adicionais, observacoes, store_id)
      select v_order_id, (item->>'product_id')::uuid, item->>'nome_produto',
             (item->>'quantity')::int, (item->>'price')::numeric, (item->>'preco_unitario')::numeric,
             coalesce(item->'adicionais','[]'::jsonb), item->>'observacoes', v_store_id
      from jsonb_array_elements(v_items_resolved) as t(item);

    -- REF-LOYALTY-01: concede 1 selo por pedido VALIDO (mesma transacao). INTOCADO -- Mesa continua
    -- gerando fidelidade normalmente, agnostico a tipo_pedido.
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
        values('orders','create_order','order',null,p_request_id,'create_order','mesa-01-onda8-reconciliacao',v_dur,'error',v_err,v_log,v_state,'unique_violation',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
    when others then
      v_err := sqlerrm; v_state := sqlstate; v_dur := extract(epoch from clock_timestamp()-v_t0)*1000;
      begin insert into public.application_logs(module,operation,entity,entity_id,request_id,rpc,version,duration_ms,level,message,payload,sqlstate,context,origin)
        values('orders','create_order','order',null,p_request_id,'create_order','mesa-01-onda8-reconciliacao',v_dur,'error',v_err,v_log,v_state,'create_order',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
  end;
end;$function$;

-- admin_orders_search: precisa das 3 colunas de Mesa (Onda 5) E de adicional_pagamento_fee
-- (Delivery-Fee-05 Onda 2) simultaneamente -- RETURNS TABLE muda de shape de novo, exige DROP.
DROP FUNCTION IF EXISTS public.admin_orders_search(text, text, integer, timestamp with time zone, uuid, uuid);

CREATE OR REPLACE FUNCTION public.admin_orders_search(p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_store_id uuid DEFAULT default_store_id())
 RETURNS TABLE(id uuid, customer_id uuid, total numeric, status text, payment_method text, address text, created_at timestamp with time zone, observacoes text, request_id uuid, delivery_fee numeric, maquininha_fee numeric, adicional_pagamento_fee numeric, tipo_pedido text, origem_pedido text, mesa_identificador text, customers jsonb, order_items jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RAISE EXCEPTION 'apenas administradores desta loja podem buscar pedidos' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    o.id, o.customer_id, o.total, o.status, o.payment_method, o.address, o.created_at,
    o.observacoes, o.request_id, o.delivery_fee, o.maquininha_fee, o.adicional_pagamento_fee,
    o.tipo_pedido, o.origem_pedido, o.mesa_identificador,
    CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('name', c.name, 'phone', c.phone) END AS customers,
    coalesce(
      (SELECT jsonb_agg(to_jsonb(oi.*)) FROM public.order_items oi WHERE oi.order_id = o.id),
      '[]'::jsonb
    ) AS order_items
  FROM public.orders o
  LEFT JOIN public.customers c ON c.id = o.customer_id
  WHERE o.store_id = p_store_id
    AND (p_status IS NULL OR o.status = p_status)
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
END;
$function$;

-- DROP FUNCTION apaga grants. Restaura TO PUBLIC -- confirmado ao vivo (2026-09-04, introspeccao
-- read-only) que e' o que HOJE esta em vigor em AMBOS os ambientes (producao e E2E), subsumindo
-- anon/authenticated/service_role. A autorizacao real sempre foi o is_admin_of() dentro do corpo,
-- nunca o GRANT de EXECUTE.
GRANT EXECUTE ON FUNCTION public.admin_orders_search(text, text, integer, timestamp with time zone, uuid, uuid) TO PUBLIC;

NOTIFY pgrst, 'reload schema';

COMMIT;
