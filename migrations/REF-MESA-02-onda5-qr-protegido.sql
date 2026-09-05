-- ============================================================================
-- REF-MESA-02 · Onda 5 — QR protegido (resolve R3, o achado mais grave da
-- auditoria)
-- ----------------------------------------------------------------------------
-- ANTES: o QR carregava só ?mesa=<identificador> em texto puro. Qualquer
-- pessoa com o link da loja podia editar a URL e "entrar" em qualquer mesa,
-- sem nenhuma prova de posse do QR físico. create_order() confiava
-- integralmente no mesa_identificador que o client mandava para o canal
-- qr_mesa.
--
-- AGORA: cada mesa ganha um `qr_token` (uuid aleatório, 122 bits de entropia,
-- não previsível, não sequencial, não derivado do identificador visível).
-- O QR passa a carregar ?mesa_token=<uuid> em vez do número da mesa. O
-- número/nome da mesa continua visível NA TELA (UX), mas deixa de ser
-- credencial de coisa nenhuma.
--
-- resolver_mesa_por_token(p_qr_token) -- RPC PÚBLICA (client escaneando o QR
-- ainda não tem sessão) -- resolve store_id+identificador a partir do token,
-- fail-closed genérico ('mesa nao encontrada', nunca revela se o token é
-- "quase" válido), rate-limited (mesmo _rate_limit_hit já usado em
-- create_order, protege contra tentativa de força bruta mesmo sendo
-- criptograficamente inviável com 122 bits).
--
-- create_order(): para origem_pedido='qr_mesa', o mesa_identificador que o
-- CLIENT manda em p_order é **totalmente ignorado** -- a função exige
-- p_order.mesa_qr_token e resolve o identificador/loja a partir dele,
-- sobrescrevendo qualquer coisa que tenha chegado no payload. admin_garcom
-- (formulário do garçom) continua sem exigir token -- já é gated por
-- is_admin_of, fora do escopo do achado R3 (que era especificamente sobre o
-- canal do cliente final, sem checagem de papel).
--
-- Testes: scripts/mesa-02-onda5-qr-protegido-test.mjs (E2E) -- inclui
-- tentativa de forjar mesa_identificador com token de OUTRA mesa/loja,
-- token inexistente, e regressão completa de create_order.
-- Rollback: REF-MESA-02-onda5-qr-protegido-rollback.sql.
-- ============================================================================

BEGIN;

ALTER TABLE public.mesas ADD COLUMN qr_token uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.mesas ADD CONSTRAINT mesas_qr_token_uniq UNIQUE (qr_token);

COMMENT ON COLUMN public.mesas.qr_token IS
  'Credencial opaca do QR fisico (REF-MESA-02 Onda 5) -- nao previsivel, nao sequencial, NAO derivada do identificador visivel. O numero/nome da mesa (identificador) continua visivel na UI, mas NUNCA e credencial -- so este token prova posse do QR fisico.';

-- admin_listar_mesas precisa devolver o token (Admin usa pra gerar/imprimir o QR, onda futura) --
-- RETURNS TABLE muda de shape, exige DROP.
DROP FUNCTION IF EXISTS public.admin_listar_mesas(uuid);

CREATE OR REPLACE FUNCTION public.admin_listar_mesas(p_store_id uuid DEFAULT default_store_id())
 RETURNS TABLE(id uuid, identificador text, status text, ocupada boolean, qr_token uuid, created_at timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RAISE EXCEPTION 'sem permissao' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    m.id, m.identificador, m.status,
    EXISTS (
      SELECT 1 FROM public.mesa_session_mesas msm
      WHERE msm.store_id = p_store_id
        AND msm.mesa_identificador = m.identificador
        AND msm.status_sessao = 'aberta'
    ) AS ocupada,
    m.qr_token,
    m.created_at
  FROM public.mesas m
  WHERE m.store_id = p_store_id
  ORDER BY m.identificador;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_listar_mesas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_listar_mesas(uuid) TO authenticated;

-- RPC pública (guest escaneando QR, sem sessão) -- resolve mesa a partir do token opaco.
CREATE OR REPLACE FUNCTION public.resolver_mesa_por_token(p_qr_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_row record;
BEGIN
  IF NOT public._rate_limit_hit('resolver_mesa_por_token', 60, interval '10 minutes') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'muitas tentativas, aguarde um momento');
  END IF;
  IF p_qr_token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mesa nao encontrada');
  END IF;
  SELECT m.store_id, m.identificador, m.status INTO v_row
  FROM public.mesas m
  JOIN public.stores s ON s.id = m.store_id AND s.status = 'ativo'
  WHERE m.qr_token = p_qr_token;
  IF v_row IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mesa nao encontrada');
  END IF;
  RETURN jsonb_build_object('ok', true, 'store_id', v_row.store_id, 'mesa_identificador', v_row.identificador, 'mesa_status', v_row.status);
END;
$function$;
REVOKE ALL ON FUNCTION public.resolver_mesa_por_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolver_mesa_por_token(uuid) TO anon, authenticated;

-- ── create_order(): canal qr_mesa passa a exigir e confiar SOMENTE no token opaco ──────────────
-- Corpo reproduzido byte-a-byte da versao vigente (Onda 8 da REF-MESA-01, confirmada ao vivo antes
-- desta migration) -- unica mudanca funcional: dentro do bloco "if v_origem_pedido = 'qr_mesa'",
-- alem da checagem de capacidade ja existente, resolve v_mesa_identificador a partir do token
-- (nunca do payload do client) e valida que a mesa pertence a MESMA loja ja resolvida (v_store_id).
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

  -- REF-MESA-01 · Onda 1/3/4 (REINCORPORADO pela Onda 8): capacidade de Mesa por loja + canais
  -- separados (qr_mesa/admin_garcom).
  -- REF-MESA-02 · Onda 5: canal qr_mesa passa a EXIGIR prova de posse do QR fisico (token opaco) --
  -- mesa_identificador do CLIENT e' totalmente ignorado/sobrescrito para este canal (resolve R3 da
  -- auditoria: numero da mesa visivel NUNCA foi credencial, so o token e').
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
    -- origem_pedido de mesa sem tipo_pedido='mesa' nao faz sentido -- combinacao invalida.
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
    -- Mesa: endereco NUNCA e' obrigatorio (nao entrega, nao geocoding). `address` continua NOT NULL
    -- na tabela por compatibilidade ampla -- vira so um TEXTO DE EXIBICAO derivado do identificador
    -- estruturado (agora sempre resolvido no servidor pro canal QR), nunca mais a fonte de verdade.
    if v_tipo_pedido = 'mesa' then
      if v_mesa_identificador is null then raise exception 'identificacao da mesa e obrigatoria'; end if;
      if v_addr is null then v_addr := 'Mesa ' || v_mesa_identificador; end if;
    elsif v_mesa_identificador is not null then
      raise exception 'mesa_identificador so e valido para tipo_pedido mesa';
    end if;

    if v_addr is null then raise exception 'address e obrigatorio'; end if;

    -- REF-ADDRESS-GEO-INTEGRITY-01 · Onda 2, Parte 2: ownership de endereco_id. INTOCADO.
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
      into v_total
      from jsonb_array_elements(v_items_resolved) as t(item);
    v_total := v_total + v_delivery_fee + v_maquininha_fee + v_adicional_pagamento_fee;
    if v_total <= 0 then raise exception 'total deve ser > 0 (recebido %)', v_total; end if;

    insert into public.customers (name, phone, store_id) values (v_name, v_phone, v_store_id)
      on conflict (store_id, phone) do update
        set name = case
          when public.customers.auth_user_id is null or public.customers.auth_user_id = auth.uid()
            then excluded.name
          else public.customers.name
        end
      returning id into v_customer_id;
    insert into public.orders (customer_id, total, status, payment_method, address, observacoes, request_id, endereco_id, delivery_fee, maquininha_fee, adicional_pagamento_fee, store_id, tipo_pedido, origem_pedido, mesa_identificador)
      values (v_customer_id, v_total, v_status, v_pay, v_addr, v_obs, p_request_id,
              v_endereco_id, v_delivery_fee, v_maquininha_fee, v_adicional_pagamento_fee, v_store_id,
              v_tipo_pedido, v_origem_pedido, v_mesa_identificador) returning id into v_order_id;
    insert into public.order_items (order_id, product_id, nome_produto, quantity, price, preco_unitario, adicionais, observacoes, store_id)
      select v_order_id, (item->>'product_id')::uuid, item->>'nome_produto',
             (item->>'quantity')::int, (item->>'price')::numeric, (item->>'preco_unitario')::numeric,
             coalesce(item->'adicionais','[]'::jsonb), item->>'observacoes', v_store_id
      from jsonb_array_elements(v_items_resolved) as t(item);

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
        values('orders','create_order','order',null,p_request_id,'create_order','mesa-02-onda5-qr-protegido',v_dur,'error',v_err,v_log,v_state,'unique_violation',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
    when others then
      v_err := sqlerrm; v_state := sqlstate; v_dur := extract(epoch from clock_timestamp()-v_t0)*1000;
      begin insert into public.application_logs(module,operation,entity,entity_id,request_id,rpc,version,duration_ms,level,message,payload,sqlstate,context,origin)
        values('orders','create_order','order',null,p_request_id,'create_order','mesa-02-onda5-qr-protegido',v_dur,'error',v_err,v_log,v_state,'create_order',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
  end;
end;$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
