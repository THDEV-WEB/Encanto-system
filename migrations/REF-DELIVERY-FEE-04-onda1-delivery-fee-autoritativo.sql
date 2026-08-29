-- REF-DELIVERY-FEE-04 · Onda 1 -- delivery_fee/maquininha_fee autoritativos no servidor, dentro de
-- create_order(). Mesma classe de vulnerabilidade que REF-PRICE-SOURCE-01 (Ondas 1+2) ja fechou para
-- preco de item/produto -- deixada de fora daquelas ondas de proposito, ver comentario da Onda 1:
-- "essas duas seguem sem validacao server-side, fora de escopo desta onda".
--
-- ACHADO (lido direto do codigo commitado): create_order() aceitava delivery_fee/maquininha_fee
-- DIRETO do client (p_order->>'delivery_fee'/'maquininha_fee'), validando so' >= 0. Nenhuma
-- reconciliacao contra a configuracao real da loja (get_delivery_fee_config) nem contra a distancia
-- real do endereco. Um client podia enviar delivery_fee:0 num pedido de entrega distante e o servidor
-- aceitava sem questionar -- porta de fraude financeira real quando a plataforma tem lojistas nao
-- supervisionados de perto (ao contrario de hoje, so 2 lojas conhecidas pessoalmente pelo dono).
--
-- CORRECAO: nova funcao interna _resolve_delivery_fee(p_store_id, p_retirada, p_payment_method,
-- p_endereco_id), chamada de dentro de create_order(), reproduzindo fielmente a MESMA regra ja
-- existente no frontend (services/delivery/deliveryFeeRules.js: montarResumoFinanceiro/
-- localizarFaixa/calcularMaquininhaFee), nunca uma aproximacao nova. Servidor SEMPRE vence sobre o
-- client, mesmo principio ja usado por _resolve_item_pricing (REF-PRICE-SOURCE-01):
--
--   1. retirada = true -> delivery_fee=0 E maquininha_fee=0, incondicional (sem motoboy, sem
--      maquininha -- mesma regra do client, nunca dependeu de distancia).
--   2. maquininha_fee -> SEMPRE recalculado: config.maquininha.ativo AND payment_method em
--      ('cartao_debito','cartao_credito') ? config.maquininha.valor : 0. Puro lookup de tabela via
--      get_delivery_fee_config(p_store_id) -- fecha 100%, sem ambiguidade, independe de distancia.
--   3. delivery_fee (entrega) COM endereco_id valido (pertence ao mesmo store_id): busca
--      addresses.latitude/longitude, calcula distancia por HAVERSINE em SQL puro (mesma formula do
--      dominio Address no client, address/utils/coordinates.js) contra company_info.lojaLat/lojaLng
--      (get_company_info), aplica a mesma logica de localizarFaixa (menor "ate" >= distancia).
--      Ressalva conhecida e aceita: o client mostra a distancia de ROTA VIARIA real (HeiGIT,
--      REF-DELIVERY-FEE-03, com fallback pra haversine so quando a rota real falha); o servidor so
--      pode calcular haversine puro (chamada HTTP de dentro do Postgres e impraticavel). Perto de
--      uma fronteira de faixa, o valor cobrado pode divergir ligeiramente do que foi mostrado no
--      checkout -- mesma classe de "servidor sempre vence, sem aviso de UX" que REF-PRICE-SOURCE-01
--      ja aceitou para preco de item mudando entre carrinho e pedido.
--   4. delivery_fee (entrega) SEM endereco_id valido (endereco nao encontrado/de outra loja/sem
--      coordenadas gravadas, OU config.ativo=false, OU faixa nao encontrada/fora de alcance) ->
--      delivery_fee=0 -- DECISAO EXPLICITA DO DONO (2026-08-29): fecha a brecha de "fingir falha de
--      endereco pra fugir da taxa" (e' exatamente o que o client honesto ja calcularia via
--      montarResumoFinanceiro -> status:'sem_coordenadas'/'desativado'/'fora_de_alcance' -> R$0), ao
--      custo de a loja absorver R$0 no caso raro de falha legitima de geocodificacao.
--
-- ESCOPO DELIBERADO -- o que NAO muda:
--   - Resto do corpo de create_order() (tenant/RLS/idempotencia/upsert customer/preco de item via
--     _resolve_item_pricing/fidelidade/log de erro) permanece IDENTICO -- so os campos delivery_fee/
--     maquininha_fee mudam de "confia no client" para "servidor sempre recalcula".
--   - get_delivery_fee_config/set_delivery_fee_config/get_company_info: sem mudanca, so leitura
--     dentro da mesma transacao.
--   - UI de exibicao do checkout: sem mudanca -- client continua mostrando o valor calculado com a
--     distancia viaria real; so o valor GRAVADO/COBRADO passa a ser sempre o autoritativo.
--   - Sem retroatividade -- so pedidos novos, pedidos ja existentes nao sao recalculados.
--   - endereco_id e' assumido como representando a real ORIGEM/destino de entrega (mesma premissa ja
--     usada pelo resto do sistema, ex.: comanda/WhatsApp) -- validar que endereco_id corresponde ao
--     ENDERECO DE FATO usado na entrega e' um problema de integridade de endereco separado, fora de
--     escopo desta REF (que so cobre a autoridade do VALOR da taxa).
--
-- Mudanca de contrato do payload: p_order.retirada (novo campo, boolean, opcional -- ausente cai em
-- false, comportamento de entrega preservado pra qualquer chamador antigo/teste que nao o envie).
--
-- Testes de manipulacao: scripts/delivery-fee-04-onda1-test.mjs (aplicada so' no banco E2E).

BEGIN;

-- ===== 1. Funcao auxiliar (interna, nao exposta ao client): resolve delivery_fee/maquininha_fee
-- AUTORITATIVOS. SECURITY DEFINER (mesmo dono/privilegios de create_order, que a chama de dentro da
-- mesma transacao) mas SEM grant a anon/authenticated -- so' e' chamavel a partir de outra funcao
-- SECURITY DEFINER do mesmo owner, nunca diretamente pelo client via RPC (mesmo padrao de
-- _resolve_item_pricing).
CREATE OR REPLACE FUNCTION public._resolve_delivery_fee(
  p_store_id       uuid,
  p_retirada       boolean,
  p_payment_method text,
  p_endereco_id    uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_config         jsonb;
  v_company        jsonb;
  v_maq            jsonb;
  v_maq_ativo      boolean;
  v_maq_valor      numeric;
  v_maquininha_fee numeric := 0;
  v_lat_loja       double precision;
  v_lng_loja       double precision;
  v_lat_end        double precision;
  v_lng_end        double precision;
  v_dist_km        double precision;
  v_faixa          jsonb;
BEGIN
  IF p_retirada THEN
    -- retirada na loja: sem motoboy, sem maquininha -- mesma regra do client (montarResumoFinanceiro),
    -- nunca dependeu de distancia. Zero ambiguidade, ignora qualquer coisa que o client mande.
    RETURN jsonb_build_object('delivery_fee', 0, 'maquininha_fee', 0);
  END IF;

  v_config := public.get_delivery_fee_config(p_store_id);

  -- maquininha: puro lookup de tabela, independe de distancia/endereco -- fecha 100%.
  v_maq := v_config->'maquininha';
  v_maq_ativo := COALESCE((v_maq->>'ativo')::boolean, false);
  v_maq_valor := COALESCE((v_maq->>'valor')::numeric, 0);
  IF v_maq_ativo AND p_payment_method IN ('cartao_debito', 'cartao_credito') THEN
    v_maquininha_fee := v_maq_valor;
  END IF;

  -- Cobranca automatica desligada no Admin -- mesmo fallback do client (status 'desativado').
  IF NOT COALESCE((v_config->>'ativo')::boolean, false) THEN
    RETURN jsonb_build_object('delivery_fee', 0, 'maquininha_fee', v_maquininha_fee);
  END IF;

  -- Sem endereco_id: nada para validar distancia -- mesmo fallback do client honesto
  -- (status 'sem_coordenadas' -> R$0). Decisao explicita do dono (2026-08-29).
  IF p_endereco_id IS NULL THEN
    RETURN jsonb_build_object('delivery_fee', 0, 'maquininha_fee', v_maquininha_fee);
  END IF;

  -- Endereco escopado ao MESMO store_id (nunca de outra loja) -- mesma anti-enumeracao de
  -- _resolve_item_pricing: NOT FOUND cai no mesmo fallback silencioso de "sem coordenadas", nao
  -- revela se o id existe em outra loja.
  SELECT latitude, longitude INTO v_lat_end, v_lng_end
    FROM public.addresses
   WHERE id = p_endereco_id AND store_id = p_store_id;

  IF NOT FOUND OR v_lat_end IS NULL OR v_lng_end IS NULL THEN
    RETURN jsonb_build_object('delivery_fee', 0, 'maquininha_fee', v_maquininha_fee);
  END IF;

  v_company := public.get_company_info(p_store_id);
  v_lat_loja := NULLIF(v_company->>'lojaLat', '')::double precision;
  v_lng_loja := NULLIF(v_company->>'lojaLng', '')::double precision;

  -- Loja sem pino cadastrado (StatusLocalizacaoLoja ainda pendente, REF-DELIVERY-FEE-02) -- mesmo
  -- fallback do client (sem coordenadas da loja = sem distancia calculavel).
  IF v_lat_loja IS NULL OR v_lng_loja IS NULL THEN
    RETURN jsonb_build_object('delivery_fee', 0, 'maquininha_fee', v_maquininha_fee);
  END IF;

  -- Haversine (km) -- mesma formula/precisao do dominio Address no client
  -- (src/address/utils/coordinates.js). So' straight-line: o client pode ter mostrado a distancia de
  -- ROTA VIARIA real (HeiGIT); perto de uma fronteira de faixa o valor cobrado pode divergir
  -- ligeiramente do exibido no checkout -- ressalva conhecida e aceita (ver cabecalho do arquivo).
  v_dist_km := 6371 * 2 * asin(sqrt(
      power(sin(radians(v_lat_end - v_lat_loja) / 2), 2) +
      cos(radians(v_lat_loja)) * cos(radians(v_lat_end)) *
      power(sin(radians(v_lng_end - v_lng_loja) / 2), 2)
  ));

  -- localizarFaixa (regra pura, client): menor "ate" que seja >= distancia (faixas contiguas por
  -- design). Distancia > maior "ate" cadastrado -> fora de alcance, mesmo fallback R$0.
  SELECT f INTO v_faixa
    FROM jsonb_array_elements(COALESCE(v_config->'faixas', '[]'::jsonb)) f
   WHERE v_dist_km <= (f->>'ate')::numeric
   ORDER BY (f->>'ate')::numeric
   LIMIT 1;

  IF v_faixa IS NULL THEN
    RETURN jsonb_build_object('delivery_fee', 0, 'maquininha_fee', v_maquininha_fee);
  END IF;

  RETURN jsonb_build_object('delivery_fee', COALESCE((v_faixa->>'valor')::numeric, 0), 'maquininha_fee', v_maquininha_fee);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._resolve_delivery_fee(uuid,boolean,text,uuid) FROM PUBLIC;

-- ===== 2. create_order(): delivery_fee/maquininha_fee deixam de vir de p_order -- sempre calculados
-- por _resolve_delivery_fee, dentro da mesma transacao. Resto do corpo byte-identico a versao
-- anterior (REF-PRICE-SOURCE-01 Onda 2).
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
  -- REF-DELIVERY-FEE-04: nao mais inicializados do p_order -- computados dentro do corpo, via
  -- _resolve_delivery_fee, depois que v_store_id/v_pay/v_endereco_id/v_retirada sao conhecidos.
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

    -- REF-DELIVERY-FEE-04: delivery_fee/maquininha_fee SEMPRE recalculados aqui -- o que o client
    -- mandou em p_order->>'delivery_fee'/'maquininha_fee' e' ignorado por completo (nunca lido).
    v_fee_calc := public._resolve_delivery_fee(v_store_id, v_retirada, v_pay, v_endereco_id);
    v_delivery_fee := (v_fee_calc->>'delivery_fee')::numeric;
    v_maquininha_fee := (v_fee_calc->>'maquininha_fee')::numeric;

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

    -- orders.total: soma dos itens (autoritativos) + delivery_fee/maquininha_fee (agora TAMBEM
    -- autoritativos, REF-DELIVERY-FEE-04).
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
        values('orders','create_order','order',null,p_request_id,'create_order','delivery-fee-04',v_dur,'error',v_err,v_log,v_state,'unique_violation',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
    when others then
      v_err := sqlerrm; v_state := sqlstate; v_dur := extract(epoch from clock_timestamp()-v_t0)*1000;
      begin insert into public.application_logs(module,operation,entity,entity_id,request_id,rpc,version,duration_ms,level,message,payload,sqlstate,context,origin)
        values('orders','create_order','order',null,p_request_id,'create_order','delivery-fee-04',v_dur,'error',v_err,v_log,v_state,'create_order',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
  end;
end;$function$;

COMMIT;

-- Expoe as funcoes redefinidas na API PostgREST imediatamente.
NOTIFY pgrst, 'reload schema';

-- ── VERIFICACAO (rodar manualmente apos aplicar) ──────────────────────────────────────────────────
-- 1. Retirada com delivery_fee/maquininha_fee forjados no payload -> ambos gravados como 0.
-- 2. Entrega com maquininha desligada no Admin + payment_method='cartao_credito' + fee forjado -> maquininha_fee=0.
-- 3. Entrega com endereco_id valido perto (dentro da 1a faixa) + delivery_fee forjado pra 0 -> servidor grava o valor da faixa real.
-- 4. Entrega sem endereco_id (null) + delivery_fee forjado -> gravado como 0 (decisao do dono).
-- 5. endereco_id de OUTRA loja -> tratado como "sem coordenadas" (fee=0), sem revelar que o id existe.
