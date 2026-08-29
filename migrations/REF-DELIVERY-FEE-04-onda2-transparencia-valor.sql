-- REF-DELIVERY-FEE-04 · Onda 2 -- transparencia do valor final: create_order() deixa de persistir
-- silenciosamente um pedido quando delivery_fee/maquininha_fee declarados pelo client divergem do
-- valor AUTORITATIVO calculado por _resolve_delivery_fee (Onda 1). Perto de uma fronteira de faixa,
-- o client mostra distancia de rota viaria real (HeiGIT, REF-DELIVERY-FEE-03) enquanto o servidor so
-- pode calcular haversine puro -- o valor final pode divergir do exibido no checkout. Ate aqui
-- (Onda 1), essa divergencia era corrigida silenciosamente (servidor sempre grava o valor certo, mas
-- o cliente nunca sabe que mudou). Esta onda fecha esse gap de transparencia, sem afrouxar a
-- autoridade do servidor: o valor persistido continua SEMPRE o autoritativo, mas so' e' persistido
-- quando o client "concorda" com ele (ou nao declarou expectativa nenhuma -- chamador legado).
--
-- DEFINICAO DE DIVERGENCIA (sem tolerancia arbitraria): comparacao em CENTAVOS INTEIROS
-- (round(valor*100)::bigint) -- utils/pricing.js ja documenta como principio permanente do projeto
-- que divergencia financeira nao se resolve com epsilon/fudge factor, e sim modelando o dominio
-- (aqui, comparando na unidade monetaria correta: centavo). So' compara quando o client de fato
-- DECLAROU o campo (p_order ? 'delivery_fee' / 'maquininha_fee') -- ausencia do campo (chamador
-- legado/script antigo que nunca declarou expectativa) pula a checagem e mantem o comportamento da
-- Onda 1 (correcao silenciosa) -- sem regressao de seguranca: o valor PERSISTIDO continua sempre o
-- autoritativo independente desta checagem: ela e' so' sinalizacao de UX, nao o mecanismo
-- anti-fraude (esse ja' e' 100% garantido pela Onda 1 sozinha).
--
-- ONDE A CHECAGEM ENTRA: depois de _resolve_delivery_fee (autoritativo ja calculado) e ANTES de
-- qualquer INSERT (customers/orders/order_items) -- por construcao, nenhum efeito colateral
-- (loyalty_grant, trigger de notification_outbox) pode ocorrer numa tentativa divergente, sem
-- precisar de codigo novo nesses subsistemas: eles so' rodam depois do INSERT em orders, que esta
-- onda simplesmente nao alcanca quando ha divergencia.
--
-- CONTRATO DA RPC (aditivo, retrocompativel): resposta de divergencia usa ok:false (qualquer
-- chamador antigo que so' checa res.ok trata como falha generica, nunca cria pedido -- mesmo
-- tratamento ja existente em DS.savePedido) + um campo NOVO `divergencia_valor:true` que so' um
-- caller atualizado precisa checar, + delivery_fee/maquininha_fee AUTORITATIVOS (o novo valor a
-- reapresentar ao cliente). Nao ha' outro consumidor de create_order no client alem de
-- DS.savePedido (confirmado por grep em todo src/) -- mudanca de contrato segura.
--
-- ESCOPO DELIBERADO -- o que NAO muda: preco de item/produto (REF-PRICE-SOURCE-01) continua sendo
-- correcao silenciosa, comportamento ja aceito e documentado de outra REF -- esta divergencia e' so'
-- delivery_fee/maquininha_fee. _resolve_delivery_fee/_resolve_item_pricing permanecem definidos
-- exatamente como estao (nenhum CREATE OR REPLACE nelas nesta migration). Resto do corpo de
-- create_order (tenant/RLS/idempotencia/upsert customer/fidelidade/log de erro) permanece IDENTICO.

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
  v_retirada        boolean := coalesce((nullif(btrim(p_order->>'retirada'), ''))::boolean, false);
  v_endereco_id     uuid := nullif(btrim(p_order->>'endereco_id'), '')::uuid;
  v_fee_calc        jsonb;
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
    if v_pay  is null then raise exception 'payment_method e obrigatorio'; end if;
    if v_addr is null then raise exception 'address e obrigatorio'; end if;

    -- REF-DELIVERY-FEE-04 · Onda 1: delivery_fee/maquininha_fee SEMPRE recalculados aqui -- o que o
    -- client mandou em p_order->>'delivery_fee'/'maquininha_fee' nunca e' usado para PERSISTIR.
    v_fee_calc := public._resolve_delivery_fee(v_store_id, v_retirada, v_pay, v_endereco_id);
    v_delivery_fee := (v_fee_calc->>'delivery_fee')::numeric;
    v_maquininha_fee := (v_fee_calc->>'maquininha_fee')::numeric;

    -- REF-DELIVERY-FEE-04 · Onda 2: se o client DECLAROU uma expectativa (delivery_fee/maquininha_fee
    -- presentes no payload) e ela diverge do autoritativo (comparacao em CENTAVOS, sem tolerancia
    -- arbitraria -- ver cabecalho), NAO persiste nada -- devolve o valor autoritativo pro client
    -- reapresentar e confirmar. Chamador que nunca declarou expectativa (campo ausente) preserva o
    -- comportamento silencioso da Onda 1, sem regressao de seguranca (o valor persistido, quando
    -- persistir, e' sempre o mesmo v_delivery_fee/v_maquininha_fee autoritativos).
    if (p_order ? 'delivery_fee' and round(coalesce((p_order->>'delivery_fee')::numeric,0)*100) <> round(v_delivery_fee*100))
       or (p_order ? 'maquininha_fee' and round(coalesce((p_order->>'maquininha_fee')::numeric,0)*100) <> round(v_maquininha_fee*100))
    then
      return jsonb_build_object('ok', false, 'error', 'valor da entrega foi atualizado, confirme novamente',
        'divergencia_valor', true, 'delivery_fee', v_delivery_fee, 'maquininha_fee', v_maquininha_fee);
    end if;

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

    -- orders.total: soma dos itens (autoritativos) + delivery_fee/maquininha_fee (autoritativos).
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
              v_endereco_id, v_delivery_fee, v_maquininha_fee, v_store_id) returning id into v_order_id;
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
        values('orders','create_order','order',null,p_request_id,'create_order','delivery-fee-04-onda2',v_dur,'error',v_err,v_log,v_state,'unique_violation',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
    when others then
      v_err := sqlerrm; v_state := sqlstate; v_dur := extract(epoch from clock_timestamp()-v_t0)*1000;
      begin insert into public.application_logs(module,operation,entity,entity_id,request_id,rpc,version,duration_ms,level,message,payload,sqlstate,context,origin)
        values('orders','create_order','order',null,p_request_id,'create_order','delivery-fee-04-onda2',v_dur,'error',v_err,v_log,v_state,'create_order',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
  end;
end;$function$;

COMMIT;

-- Expoe a funcao redefinida na API PostgREST imediatamente.
NOTIFY pgrst, 'reload schema';

-- ── VERIFICACAO (rodar manualmente apos aplicar) ──────────────────────────────────────────────────
-- 1. delivery_fee declarado = autoritativo -> pedido criado normalmente.
-- 2. delivery_fee declarado MENOR que autoritativo -> ok:false, divergencia_valor:true, nenhum pedido.
-- 3. delivery_fee declarado MAIOR que autoritativo -> idem.
-- 4. 2a chamada com o valor autoritativo devolvido -> pedido criado.
-- 5. Chamador que nao declara delivery_fee/maquininha_fee (campo ausente) -> comportamento da Onda 1 preservado.
-- 6. notification_outbox/loyalty_events: zero linhas geradas pela tentativa divergente (nenhum INSERT em orders ocorreu).
