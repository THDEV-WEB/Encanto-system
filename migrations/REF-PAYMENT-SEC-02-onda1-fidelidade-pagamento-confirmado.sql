-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- REF-PAYMENT-SEC-02 · Onda 1 — selo de fidelidade só é concedido para pedido online depois do
-- pagamento CONFIRMADO (achado HIGH-01 da REF-PAYMENT-SEC-01, seção 7).
--
-- ACHADO: create_order() concedia o selo (loyalty_grant) incondicionalmente, na CRIAÇÃO do pedido --
-- inclusive para pagamento online ainda em 'aguardando_pagamento'. Um pagamento recusado não
-- revertia o selo (loyalty_void_on_cancel só reage a orders.status='cancelado', e
-- _processar_webhook_payment_intent nunca muda status pra 'cancelado' num 'recusado' -- só
-- payment_status, de propósito, pra permitir retry). Resultado: guest sem autenticação conseguia
-- lotar a cartela de fidelidade (default 10 selos) criando pedidos abandonados/recusados, sem pagar
-- nada -- 60 pedidos/10min já bastam (rate limit de create_order).
--
-- FIX (menor alteração, sem criar mecanismo paralelo de fidelidade, sem tocar loyalty_grant/
-- loyalty_void_on_cancel -- nenhum dos dois muda nesta migration):
--   - create_order(): so' concede o selo NA CRIAÇÃO quando o pedido NÃO depende de confirmação
--     online (v_status <> 'aguardando_pagamento' -- cobre dinheiro/PIX físico/cartão físico/
--     retirada/mesa, tudo que já nasce 'recebido' hoje). Para pedido online (nasce
--     'aguardando_pagamento'), a concessão fica DEFERIDA.
--   - _processar_webhook_payment_intent() e _registrar_criacao_pagamento(): quando o pagamento é
--     efetivamente aprovado (o pedido REALMENTE transiciona pra 'recebido', não o caso "IF NOT
--     FOUND" de reconciliação da Onda 4 -- esse continua sem conceder selo, coerente: pedido que
--     não reabre não ganha selo), chama loyalty_grant ali.
--
-- Por que isso fecha o achado sem precisar de nenhuma lógica de REVERSÃO nova pra recusado/expirado:
-- se o selo nunca é concedido enquanto o pagamento não é aprovado, um pagamento recusado ou expirado
-- simplesmente NUNCA chega a gerar selo -- não tem nada pra reverter. loyalty_void_on_cancel continua
-- revertendo exatamente como antes o caso "pedido físico cancelado depois de já ter ganho o selo"
-- (comportamento intocado, o filtro origem IN ('create_order','cancel_trigger') continua encontrando
-- os eventos gerados por loyalty_grant não importa de QUAL função ele foi chamado -- a origem
-- gravada no ledger continua sendo 'create_order', semântica preservada).
--
-- Idempotência: dupla proteção já existente, sem mudança -- (1) o outer idempotency check de
-- _processar_webhook_payment_intent (mesmo status -> no-op, nunca chega no novo loyalty_grant) e
-- (2) o próprio loyalty_grant (índice único parcial por order_id). Um pagamento aprovado gera
-- EXATAMENTE um selo, mesmo com webhook duplicado/retry/concorrência.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
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
  v_mesa_qr_token   uuid;
  v_mesa_token_store uuid;
  v_mesa_session_id uuid;
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
  -- REF-LOYALTY-02 · Onda 2:
  v_subtotal_itens  numeric;
  v_usar_recompensa boolean := coalesce((p_order->>'usar_recompensa_fidelidade')::boolean, false);
  v_loy_enabled     boolean;
  v_loy_required    int;
  v_loy_discount    int;
  v_loy_stamps      int;
  v_loy_elegivel    boolean := false;
  v_desconto_fidelidade numeric := 0;
  v_loy_result      jsonb;
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

  if v_tipo_pedido = 'mesa' then
    v_mesa_cfg := public.get_mesa_config(v_store_id);
    if not coalesce((v_mesa_cfg->>'habilitada')::boolean, false) then
      return jsonb_build_object('ok', false, 'error', 'modalidade indisponivel para esta loja');
    end if;
    if v_origem_pedido = 'qr_mesa' then
      if not coalesce((v_mesa_cfg->>'canal_qr')::boolean, false) then
        return jsonb_build_object('ok', false, 'error', 'canal indisponivel para esta loja');
      end if;
      v_mesa_qr_token := nullif(btrim(p_order->>'mesa_qr_token'), '')::uuid;
      if v_mesa_qr_token is null then
        return jsonb_build_object('ok', false, 'error', 'canal indisponivel para esta loja');
      end if;
      select m.store_id, m.identificador into v_mesa_token_store, v_mesa_identificador
        from public.mesas m where m.qr_token = v_mesa_qr_token;
      if v_mesa_token_store is null or v_mesa_token_store <> v_store_id then
        return jsonb_build_object('ok', false, 'error', 'canal indisponivel para esta loja');
      end if;
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
    return jsonb_build_object('ok', false, 'error', 'canal indisponivel para esta loja');
  end if;

  begin
    if p_customer is null or jsonb_typeof(p_customer) <> 'object' then raise exception 'p_customer ausente/invalido'; end if;
    if v_name  is null then raise exception 'name do cliente e obrigatorio'; end if;
    if v_phone is null then raise exception 'telefone do cliente e obrigatorio'; end if;
    if p_order is null or jsonb_typeof(p_order) <> 'object' then raise exception 'p_order ausente/invalido'; end if;
    if v_pay  is null then raise exception 'payment_method e obrigatorio'; end if;

    if v_tipo_pedido not in ('entrega', 'retirada', 'mesa') then
      raise exception 'tipo_pedido invalido';
    end if;
    if v_origem_pedido not in ('storefront', 'qr_mesa', 'admin_garcom') then
      raise exception 'origem_pedido invalido';
    end if;
    if v_tipo_pedido = 'mesa' then
      if v_mesa_identificador is null then raise exception 'identificacao da mesa e obrigatoria'; end if;
      if v_addr is null then v_addr := 'Mesa ' || v_mesa_identificador; end if;
    elsif v_mesa_identificador is not null then
      raise exception 'mesa_identificador so e valido para tipo_pedido mesa';
    end if;

    if v_addr is null then raise exception 'address e obrigatorio'; end if;

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

    -- REF-LOYALTY-02 · Onda 2: INSERT em customers antecipado (era logo antes do INSERT em
    -- orders) -- precisa de v_customer_id disponivel ANTES de checar elegibilidade de
    -- fidelidade, que por sua vez precisa acontecer antes do calculo de v_total. Mesmo upsert,
    -- mesmos campos, nenhuma mudanca de comportamento do proprio INSERT.
    insert into public.customers (name, phone, store_id) values (v_name, v_phone, v_store_id)
      on conflict (store_id, phone) do update
        set name = case
          when public.customers.auth_user_id is null or public.customers.auth_user_id = auth.uid()
            then excluded.name
          else public.customers.name
        end
      returning id into v_customer_id;

    -- REF-LOYALTY-02 · Onda 2: elegibilidade checada com lock (FOR UPDATE) o quanto antes,
    -- ANTES de qualquer INSERT em orders/order_items -- se o cliente pediu pra usar a
    -- recompensa e ela nao esta realmente disponivel (backend recalcula do zero, nunca confia
    -- no frontend), o pedido inteiro e recusado aqui (fail-closed, mesmo padrao ja usado pela
    -- divergencia de delivery_fee/maquininha_fee: nao cria nada, pede reconfirmacao). O lock
    -- fica retido ate o fim desta transacao -- garante que ninguem mais debite a MESMA
    -- recompensa enquanto este pedido ainda esta sendo criado.
    if v_usar_recompensa then
      v_loy_enabled := coalesce((select valor from public.store_settings where store_id = v_store_id and chave = 'loyalty_enabled'), 'false') <> 'false';
      if v_loy_enabled then
        v_loy_required := coalesce((select valor from public.store_settings where store_id = v_store_id and chave = 'loyalty_required'), '10')::int;
        v_loy_discount := coalesce((select valor from public.store_settings where store_id = v_store_id and chave = 'loyalty_discount'), '50')::int;
        select stamps into v_loy_stamps from public.loyalty_accounts where customer_id = v_customer_id for update;
        v_loy_elegivel := coalesce(v_loy_stamps, 0) >= v_loy_required;
      end if;
      if not v_loy_elegivel then
        return jsonb_build_object('ok', false, 'error', 'recompensa indisponivel', 'recompensa_indisponivel', true);
      end if;
    end if;

    v_fee_calc := public._resolve_delivery_fee(v_store_id, (v_tipo_pedido <> 'entrega'), v_pay, v_endereco_id);
    v_delivery_fee := (v_fee_calc->>'delivery_fee')::numeric;
    v_maquininha_fee := (v_fee_calc->>'maquininha_fee')::numeric;
    v_adicional_pagamento_fee := (v_fee_calc->>'adicional_pagamento_fee')::numeric;

    if (p_order ? 'delivery_fee' and round(coalesce((p_order->>'delivery_fee')::numeric,0)*100) <> round(v_delivery_fee*100))
       or (p_order ? 'maquininha_fee' and round(coalesce((p_order->>'maquininha_fee')::numeric,0)*100) <> round(v_maquininha_fee*100))
       or (p_order ? 'adicional_pagamento_fee' and round(coalesce((p_order->>'adicional_pagamento_fee')::numeric,0)*100) <> round(v_adicional_pagamento_fee*100))
    then
      return jsonb_build_object('ok', false, 'error', 'valor da entrega foi atualizado, confirme novamente',
        'divergencia_valor', true, 'delivery_fee', v_delivery_fee, 'maquininha_fee', v_maquininha_fee,
        'adicional_pagamento_fee', v_adicional_pagamento_fee);
    end if;

    -- REF-MESA-02 · Onda 6: abertura implicita da sessao -- so quando a loja tiver
    -- mesa_sessao_habilitada=true (opt-in, default false, zero mudanca de comportamento pra quem
    -- nao ligou) E o canal for um dos 2 reais de mesa (qr_mesa/admin_garcom -- 'storefront'+'mesa' e
    -- uma combinacao residual sem canal, mantida sem sessao, comportamento intocado). Roda ANTES do
    -- loop de itens (nao depende de precos) mas DEPOIS de toda validacao que independe da sessao --
    -- minimiza a janela do lock que _get_or_open_mesa_session adquire.
    if v_tipo_pedido = 'mesa' and coalesce((v_mesa_cfg->>'sessao_habilitada')::boolean, false)
       and v_origem_pedido in ('qr_mesa', 'admin_garcom') then
      v_mesa_session_id := public._get_or_open_mesa_session(
        v_store_id, v_mesa_identificador, v_origem_pedido,
        case when v_origem_pedido = 'admin_garcom' then auth.uid() else null end
      );
    end if;

    if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'p_items deve ser um array'; end if;
    if jsonb_array_length(p_items) = 0 then raise exception 'p_items nao pode ser vazio'; end if;
    for v_elem in select value from jsonb_array_elements(p_items) loop
      if nullif(btrim(v_elem->>'nome_produto'), '') is null then raise exception 'item sem nome_produto'; end if;
      if nullif(btrim(v_elem->>'quantity'), '') is null or (v_elem->>'quantity')::numeric <= 0 then
        raise exception 'item "%" com quantity invalida', v_elem->>'nome_produto'; end if;

      v_pid := nullif(btrim(v_elem->>'product_id'), '')::uuid;
      if v_pid is null then
        raise exception 'item "%" sem produto valido', v_elem->>'nome_produto';
      end if;

      v_calc := public._resolve_item_pricing(v_store_id, v_pid, nullif(btrim(v_elem->>'tamanho_label'), ''),
                                              coalesce(v_elem->'adicionais', '[]'::jsonb));
      v_item_price := (v_calc->>'preco_unitario')::numeric;
      v_items_resolved := v_items_resolved || jsonb_build_array(jsonb_build_object(
        'product_id', v_pid, 'nome_produto', v_elem->>'nome_produto',
        'quantity', (v_elem->>'quantity')::int, 'price', v_item_price, 'preco_unitario', v_item_price,
        'adicionais', v_calc->'adicionais', 'observacoes', nullif(btrim(v_elem->>'observacoes'), '')
      ));
    end loop;

    select coalesce(sum((item->>'preco_unitario')::numeric * (item->>'quantity')::numeric), 0)
      into v_subtotal_itens
      from jsonb_array_elements(v_items_resolved) as t(item);

    -- REF-LOYALTY-02 · Onda 2: desconto SOMENTE sobre o subtotal de produtos (decisao de negocio
    -- #2, aprovada) -- calculado agora que v_subtotal_itens e' conhecido; nunca incide sobre
    -- delivery_fee/maquininha_fee/adicional_pagamento_fee, somados DEPOIS abaixo.
    if v_loy_elegivel then
      v_desconto_fidelidade := round(v_subtotal_itens * v_loy_discount / 100.0, 2);
    end if;

    v_total := (v_subtotal_itens - v_desconto_fidelidade) + v_delivery_fee + v_maquininha_fee + v_adicional_pagamento_fee;
    if v_total <= 0 then raise exception 'total deve ser > 0 (recebido %)', v_total; end if;

    insert into public.orders (customer_id, total, status, payment_method, address, observacoes, request_id, endereco_id, delivery_fee, maquininha_fee, adicional_pagamento_fee, store_id, tipo_pedido, origem_pedido, mesa_identificador, mesa_session_id, desconto_fidelidade)
      values (v_customer_id, v_total, v_status, v_pay, v_addr, v_obs, p_request_id,
              v_endereco_id, v_delivery_fee, v_maquininha_fee, v_adicional_pagamento_fee, v_store_id,
              v_tipo_pedido, v_origem_pedido, v_mesa_identificador, v_mesa_session_id, v_desconto_fidelidade) returning id into v_order_id;
    insert into public.order_items (order_id, product_id, nome_produto, quantity, price, preco_unitario, adicionais, observacoes, store_id)
      select v_order_id, (item->>'product_id')::uuid, item->>'nome_produto',
             (item->>'quantity')::int, (item->>'price')::numeric, (item->>'preco_unitario')::numeric,
             coalesce(item->'adicionais','[]'::jsonb), item->>'observacoes', v_store_id
      from jsonb_array_elements(v_items_resolved) as t(item);

    if v_loy_elegivel then
      -- REF-LOYALTY-02 · Onda 2: debito HARD (nao best-effort de proposito) -- um desconto ja
      -- persistido em orders.total/desconto_fidelidade precisa estar atomicamente respaldado
      -- pelo debito real do ledger; se isso falhar (nao deveria, o lock acima ja garantiu
      -- elegibilidade dentro desta MESMA transacao), a excecao propaga pro handler externo e
      -- TODA a transacao roda pra tras -- nunca fica desconto sem debito.
      select public._redeem_loyalty_for_order(v_customer_id, v_store_id, v_order_id, v_subtotal_itens, 'create_order')
        into v_loy_result;
      if coalesce((v_loy_result->>'ok')::boolean, false) is not true then
        raise exception 'falha ao registrar resgate de fidelidade: %', coalesce(v_loy_result->>'error', 'desconhecido');
      end if;
      -- Mutuamente exclusivo (decisao de negocio aprovada): esta MESMA compra que RESGATOU a
      -- recompensa nao tambem GANHA um selo novo pra si -- o proximo ciclo comeca no PROXIMO
      -- pedido, nao neste (loyalty_grant nao e chamado neste ramo).
    elsif v_status <> 'aguardando_pagamento' then
      -- REF-PAYMENT-SEC-02 · Onda 1 (achado HIGH-01): so' concede o selo NA CRIACAO quando o
      -- pedido NAO depende de confirmacao de pagamento online -- 'aguardando_pagamento' significa
      -- pagamento online ainda pendente (Pix/cartao antecipado, REF-PAGAMENTO-01). Nesse caso a
      -- concessao fica DEFERIDA pra quando o pagamento for realmente aprovado (ver
      -- _processar_webhook_payment_intent/_registrar_criacao_pagamento) -- nunca aqui.
      begin
        perform public.loyalty_grant(v_customer_id, v_order_id);
      exception when others then
        null;
      end;
    end if;

    return jsonb_build_object('ok', true, 'order_id', v_order_id, 'mesa_session_id', v_mesa_session_id, 'desconto_fidelidade', v_desconto_fidelidade);
  exception
    when unique_violation then
      if p_request_id is not null then
        select id into v_order_id from public.orders where request_id = p_request_id;
        if v_order_id is not null then return jsonb_build_object('ok', true, 'order_id', v_order_id, 'idempotent', true); end if;
      end if;
      v_err := sqlerrm; v_state := sqlstate; v_dur := extract(epoch from clock_timestamp()-v_t0)*1000;
      begin insert into public.application_logs(module,operation,entity,entity_id,request_id,rpc,version,duration_ms,level,message,payload,sqlstate,context,origin)
        values('orders','create_order','order',null,p_request_id,'create_order','payment-sec-02-onda1',v_dur,'error',v_err,v_log,v_state,'unique_violation',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
    when others then
      v_err := sqlerrm; v_state := sqlstate; v_dur := extract(epoch from clock_timestamp()-v_t0)*1000;
      begin insert into public.application_logs(module,operation,entity,entity_id,request_id,rpc,version,duration_ms,level,message,payload,sqlstate,context,origin)
        values('orders','create_order','order',null,p_request_id,'create_order','payment-sec-02-onda1',v_dur,'error',v_err,v_log,v_state,'create_order',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
  end;
end;$function$;

CREATE OR REPLACE FUNCTION public._processar_webhook_payment_intent(p_mp_payment_id text, p_novo_status text, p_status_detail text, p_store_id_esperado uuid, p_raw_payload jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_pi RECORD;
  v_customer_id uuid;
BEGIN
  IF p_mp_payment_id IS NULL OR p_novo_status IS NULL OR p_store_id_esperado IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'parametros obrigatorios ausentes');
  END IF;

  SELECT * INTO v_pi FROM public.payment_intents
  WHERE mp_payment_id = p_mp_payment_id
  FOR UPDATE;

  IF v_pi.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_intent nao encontrado');
  END IF;

  -- Nunca escreve nada se o tenant nao corresponde -- mesma dupla-checagem ja provada na Onda 16
  -- da REF-MESA-02 contra payload forjado apontando pra recurso de outra loja.
  IF v_pi.store_id <> p_store_id_esperado THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tenant nao corresponde');
  END IF;

  -- Idempotencia: mesmo status ja registrado -> no-op, nunca reexecuta efeito colateral.
  IF v_pi.status = p_novo_status THEN
    RETURN jsonb_build_object('ok', true, 'idempotente', true, 'status', v_pi.status);
  END IF;

  IF NOT public._transicao_payment_status_valida(v_pi.status, p_novo_status) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'transicao de status invalida', 'de', v_pi.status, 'para', p_novo_status);
  END IF;

  UPDATE public.payment_intents
  SET status = p_novo_status, status_detail = p_status_detail,
      raw_payload = coalesce(p_raw_payload, raw_payload), updated_at = now()
  WHERE id = v_pi.id;

  IF p_novo_status = 'aprovado' THEN
    IF v_pi.order_id IS NOT NULL THEN
      UPDATE public.orders SET status = 'recebido', payment_status = 'aprovado'
      WHERE id = v_pi.order_id AND status = 'aguardando_pagamento';
      -- REF-PAYMENT-SEC-02 · Onda 4: pedido NAO estava mais aguardando_pagamento (ja expirado/
      -- cancelado antes deste webhook tardio) -- nunca reabre o pedido sozinho (decisao de negocio
      -- fora do escopo desta correcao). So registra o FATO financeiro (dinheiro chegou) e sinaliza
      -- pra reconciliacao manual, nunca finge que nada aconteceu.
      IF NOT FOUND THEN
        UPDATE public.orders SET payment_status = 'aprovado' WHERE id = v_pi.order_id;
        BEGIN
          INSERT INTO public.application_logs(module, operation, entity, entity_id, request_id, rpc, version, duration_ms, level, message, payload, sqlstate, context, origin)
          VALUES ('pagamento', 'webhook_mercadopago', 'order', v_pi.order_id, NULL, '_processar_webhook_payment_intent', 'payment-sec-02-onda4', NULL, 'warn',
            format('RECONCILIACAO NECESSARIA: payment_intent %s aprovado para o pedido %s, que NAO estava aguardando_pagamento (provavelmente ja expirado/cancelado) -- dinheiro recebido, pedido NAO reaberto automaticamente, requer tratamento administrativo', v_pi.id, v_pi.order_id),
            p_raw_payload, NULL, 'webhook_reconciliacao', current_user);
        EXCEPTION WHEN others THEN NULL;
        END;
      ELSE
        -- REF-PAYMENT-SEC-02 · Onda 1 (achado HIGH-01): pedido online REALMENTE confirmado agora --
        -- concede o selo aqui (deferido desde create_order). Nunca no ramo "IF NOT FOUND" acima
        -- (pedido nao reaberto -> nao ganha selo, coerente com a Onda 4). Falha de fidelidade nunca
        -- quebra o pagamento (mesmo padrao ja usado em create_order).
        SELECT customer_id INTO v_customer_id FROM public.orders WHERE id = v_pi.order_id;
        IF v_customer_id IS NOT NULL THEN
          BEGIN
            PERFORM public.loyalty_grant(v_customer_id, v_pi.order_id);
          EXCEPTION WHEN others THEN NULL;
          END;
        END IF;
      END IF;
    END IF;
    IF v_pi.mesa_session_id IS NOT NULL THEN
      UPDATE public.mesa_session_payment_allocations
      SET status = 'pago', paga_em = now()
      WHERE payment_intent_id = v_pi.id AND status = 'pendente';
    END IF;
  ELSIF p_novo_status = 'expirado' THEN
    -- So cancela o PEDIDO (delivery/retirada) -- fatia de mesa nao e auto-cancelada, a sessao
    -- continua precisando daquele valor por outro meio (nova tentativa online ou presencial).
    IF v_pi.order_id IS NOT NULL THEN
      UPDATE public.orders SET status = 'cancelado', payment_status = 'expirado'
      WHERE id = v_pi.order_id AND status = 'aguardando_pagamento';
    END IF;
  ELSIF p_novo_status = 'recusado' THEN
    -- Preserva o pedido em aguardando_pagamento -- permite nova tentativa com o MESMO order_id
    -- (novo payment_intent), nunca duplica o pedido.
    IF v_pi.order_id IS NOT NULL THEN
      UPDATE public.orders SET payment_status = 'recusado' WHERE id = v_pi.order_id;
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.application_logs(module, operation, entity, entity_id, request_id, rpc, version, duration_ms, level, message, payload, sqlstate, context, origin)
    VALUES ('pagamento', 'webhook_mercadopago', 'payment_intent', v_pi.id, NULL, '_processar_webhook_payment_intent', 'pagamento-01-onda2', NULL, 'info',
      format('payment_intent %s: %s -> %s', v_pi.id, v_pi.status, p_novo_status), p_raw_payload, NULL, 'webhook', current_user);
  EXCEPTION WHEN others THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'payment_intent_id', v_pi.id, 'status', p_novo_status);
END;
$function$;

CREATE OR REPLACE FUNCTION public._registrar_criacao_pagamento(p_payment_intent_id uuid, p_store_id_esperado uuid, p_mp_payment_id text, p_status text, p_status_detail text, p_raw_payload jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_pi RECORD;
  v_payment_method_real text;
BEGIN
  IF p_payment_intent_id IS NULL OR p_mp_payment_id IS NULL OR p_status IS NULL OR p_store_id_esperado IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'parametros obrigatorios ausentes');
  END IF;

  SELECT * INTO v_pi FROM public.payment_intents WHERE id = p_payment_intent_id FOR UPDATE;
  IF v_pi.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_intent nao encontrado');
  END IF;
  IF v_pi.store_id <> p_store_id_esperado THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tenant nao corresponde');
  END IF;

  IF v_pi.mp_payment_id IS NOT NULL THEN
    IF v_pi.mp_payment_id <> p_mp_payment_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'payment_intent ja associado a outro pagamento no MP');
    END IF;
    -- Mesmo mp_payment_id de novo (ex.: retry de rede do lado da Edge Function) -- dai em diante e'
    -- uma transicao normal, delega pra maquina de estados/idempotencia ja testada da Onda 2 em vez
    -- de duplicar aquela logica aqui.
    RETURN public._processar_webhook_payment_intent(p_mp_payment_id, p_status, p_status_detail, p_store_id_esperado, p_raw_payload);
  END IF;

  -- 1a associacao: sempre grava (mesmo se p_status vier 'pendente', igual ao default inicial --
  -- NAO e' idempotencia de replay, e' a 1a escrita real da resposta da API de criacao).
  UPDATE public.payment_intents
  SET mp_payment_id = p_mp_payment_id, status = p_status, status_detail = p_status_detail,
      raw_payload = coalesce(p_raw_payload, raw_payload), updated_at = now()
  WHERE id = v_pi.id;

  -- REF-PAGAMENTO-01 · Onda 6: mapeia o tipo REAL devolvido pelo Mercado Pago pro vocabulario ja
  -- existente do projeto -- tipo desconhecido/ausente nao sobrescreve nada.
  v_payment_method_real := CASE p_raw_payload->>'payment_type_id'
    WHEN 'credit_card' THEN 'cartao_credito'
    WHEN 'debit_card'  THEN 'cartao_debito'
    WHEN 'bank_transfer' THEN 'pix'
    ELSE NULL
  END;
  IF v_payment_method_real IS NOT NULL AND v_pi.order_id IS NOT NULL THEN
    UPDATE public.orders SET payment_method = v_payment_method_real WHERE id = v_pi.order_id;
  END IF;

  IF p_status = 'aprovado' THEN
    IF v_pi.order_id IS NOT NULL THEN
      UPDATE public.orders SET status = 'recebido', payment_status = 'aprovado'
      WHERE id = v_pi.order_id AND status = 'aguardando_pagamento';
      -- REF-PAYMENT-SEC-02 · Onda 4: mesma defesa em profundidade do webhook (ver
      -- _processar_webhook_payment_intent) -- cenario bem mais raro aqui (1a associacao acontece
      -- segundos depois da criacao da cobranca), mas nao custa nada cobrir por simetria.
      IF NOT FOUND THEN
        UPDATE public.orders SET payment_status = 'aprovado' WHERE id = v_pi.order_id;
        BEGIN
          INSERT INTO public.application_logs(module, operation, entity, entity_id, request_id, rpc, version, duration_ms, level, message, payload, sqlstate, context, origin)
          VALUES ('pagamento', 'criar_cobranca_mercadopago', 'order', v_pi.order_id, NULL, '_registrar_criacao_pagamento', 'payment-sec-02-onda4', NULL, 'warn',
            format('RECONCILIACAO NECESSARIA: payment_intent %s aprovado na criacao para o pedido %s, que NAO estava aguardando_pagamento -- dinheiro recebido, pedido NAO reaberto automaticamente, requer tratamento administrativo', v_pi.id, v_pi.order_id),
            p_raw_payload, NULL, 'webhook_reconciliacao', current_user);
        EXCEPTION WHEN others THEN NULL;
        END;
      ELSE
        -- REF-PAYMENT-SEC-02 · Onda 1 (achado HIGH-01): mesma logica do webhook -- concede o selo
        -- so' quando o pedido REALMENTE foi confirmado (aprovacao instantanea, ex. cartao).
        DECLARE
          v_customer_id uuid;
        BEGIN
          SELECT customer_id INTO v_customer_id FROM public.orders WHERE id = v_pi.order_id;
          IF v_customer_id IS NOT NULL THEN
            BEGIN
              PERFORM public.loyalty_grant(v_customer_id, v_pi.order_id);
            EXCEPTION WHEN others THEN NULL;
            END;
          END IF;
        END;
      END IF;
    END IF;
    IF v_pi.mesa_session_id IS NOT NULL THEN
      UPDATE public.mesa_session_payment_allocations
      SET status = 'pago', paga_em = now()
      WHERE payment_intent_id = v_pi.id AND status = 'pendente';
    END IF;
  ELSIF p_status = 'recusado' THEN
    IF v_pi.order_id IS NOT NULL THEN
      UPDATE public.orders SET payment_status = 'recusado' WHERE id = v_pi.order_id;
    END IF;
  END IF;
  -- 'expirado' nao e' devolvido pela API de CRIACAO (so' o job interno de expiracao chega la) --
  -- omitido de proposito, diferente do leque de status tratado pelo webhook.

  BEGIN
    INSERT INTO public.application_logs(module, operation, entity, entity_id, request_id, rpc, version, duration_ms, level, message, payload, sqlstate, context, origin)
    VALUES ('pagamento', 'criar_cobranca_mercadopago', 'payment_intent', v_pi.id, NULL, '_registrar_criacao_pagamento', 'pagamento-01-onda6', NULL, 'info',
      format('payment_intent %s: criado no MP como %s (%s)', v_pi.id, p_mp_payment_id, p_status), p_raw_payload, NULL, 'criacao', current_user);
  EXCEPTION WHEN others THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'payment_intent_id', v_pi.id, 'mp_payment_id', p_mp_payment_id, 'status', p_status);
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
