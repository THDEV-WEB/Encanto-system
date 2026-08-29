-- REF-PRICE-SOURCE-01 · Onda 1 -- preco autoritativo no servidor, dentro de create_order().
--
-- ACHADO (auditoria REF-PRICE-SOURCE-01): create_order() recebia `price`/`preco_unitario` de cada
-- item DIRETO do client (p_items), validando so' `price > 0` -- nenhuma reconciliacao contra
-- products.preco/preco_promo/tamanhos[].preco. Um client podia enviar qualquer preco positivo para
-- qualquer produto e o pedido era criado com esse valor, sem checagem. orders.total tinha o MESMO
-- problema: vinha direto de p_order->>'total', sem bater com a soma dos itens. Mesma classe de
-- vulnerabilidade ja fechada para store_id (REF-ORDER-TENANT-01) e nunca estendida a preco.
--
-- CORRECAO: para cada item com product_id valido (uuid presente), o preco unitario deixa de vir do
-- client e passa a ser CALCULADO NO SERVIDOR, dentro da MESMA transacao, reproduzindo fielmente a
-- regra comercial ja existente no frontend (src/utils/pricing.js, src/utils/addons.js,
-- src/components/ProductModal/ProductModalInner.jsx), nunca uma aproximacao nova:
--   - produto simples: preco_promo || preco (preco_promo so vence quando != 0, igual a `||` em JS);
--   - produto com tamanhos[]: preco do tamanho selecionado (casado por `label`, o mesmo identificador
--     que o componente usa -- `id` NAO e' confiavel: boa parte dos produtos reais tem tamanhos sem
--     `id`, so' `label`+`preco`, confirmado por introspecao direta do banco); tamanho ausente/nao
--     encontrado cai no 1o tamanho, mesmo fallback do client (`tamanho||prod.tamanhos[0]`); tamanho
--     com preco 0/invalido cai no preco do produto (`|| Number(prod.preco)`);
--   - adicionais: cada id (na ORDEM em que o client mandou -- e' a ordem de SELECAO do cliente, um
--     dado de escolha, nao financeiro) e' rebuscado em public.adicionais por id+store_id+ativo; o
--     PRECO/TIPO usado e' sempre o da tabela, nunca o que veio no payload. Franquia gratis: os N
--     primeiros adicionais "tipo gratis-ou-preco-0", na ordem de selecao, custam 0 (N = tamanho
--     selecionado.adicionais_gratis ?? products.adicionais_gratis ?? 0); excedentes usam o preco
--     proprio ou R$2,00 (ADICIONAL_SIMPLES_PRECO, src/utils/addons.js:75) quando o proprio preco e' 0.
--     Mesmo id repetido no payload conta 1 vez so' (dedupe pela 1a ocorrencia -- replica o toggle() do
--     client, que nunca permite duplicar). Adicional inexistente/inativo/de outra loja -> pedido inteiro
--     rejeitado (fail-closed).
--   - orders.total deixa de vir de p_order->>'total' -- passa a ser Σ(preco_unitario_autoritativo x
--     quantity) de TODOS os itens + delivery_fee + maquininha_fee (essas duas continuam vindas do
--     client sem validacao adicional -- fora de escopo desta onda, achado conhecido e documentado
--     separadamente, mesma familia do que REF-DELIVERY-FEE-02 corrigiu para a taxa em si).
--
-- ESCOPO DELIBERADO -- o que NAO mudou:
--   - Item SEM product_id (product_id ausente/nao-uuid) continua usando o `price` do client, EXATAMENTE
--     como antes -- decisao consciente, nao lacuna esquecida: scripts/saas01-onda4-1-pedidos-test.mjs e
--     scripts/harden-orders-rls-test.mjs (testes de regressao de OUTRAS REFs, ja em producao, fora do
--     escopo desta onda) chamam create_order() com itens sem product_id e dependem desse caminho
--     continuar aceitando o preco enviado. E' tambem o caminho que src/data/mockCatalog.js usa (ids
--     nao-uuid -> product_id null no payload, ver src/utils/ids.js:isUuid) -- like consequencia, um
--     pedido com item do catalogo mock (fallback offline) NAO tem mais o preco do produto real
--     validado; o preco do mock e' aceito como sempre foi. Registrado no relatorio final da Onda 1
--     como limitacao residual do achado do mockCatalog, nao resolvido aqui (exigiria decidir se aceitar
--     item sem product_id e' um caso de uso legitimo do sistema ou deve deixar de existir -- fora do
--     escopo "preco autoritativo", proposta de Onda 2).
--   - grupos/categoria/whitelist textual de "quais adicionais aparecem para qual produto" (CAT_ADDON_GROUP,
--     MARMITA_PERMITIDOS em src/utils/addons.js) NAO e' replicado aqui -- e' regra de CURADORIA de
--     cardapio (o que a UI oferece), nao de PRECO; o proprio addons.js documenta essa whitelist como
--     divida ("fragil a rename"). O que importa financeiramente (preco/tipo de cada adicional, e a
--     cota de franquia gratis) e' sempre resolvido pela tabela, nunca pelo client.
--   - delivery_fee/maquininha_fee continuam sem validacao server-side (fora de escopo, ja documentado
--     como achado separado no relatorio da auditoria).
--
-- Resto do corpo de create_order() (validacoes de nome/telefone/quantity, resolucao de loja/tenant via
-- REF-ORDER-TENANT-01/REF-PROD-GOLIVE-01, idempotencia por request_id, upsert de customer com a guarda
-- de nome do REF-PROD-GOLIVE-01, loyalty_grant, log de erro em application_logs) permanece IDENTICO --
-- nenhuma protecao existente foi tocada.

BEGIN;

-- ===== 1. Funcao auxiliar (interna, nao exposta ao client): resolve o preco AUTORITATIVO de 1 item.
-- SECURITY DEFINER (mesmo dono/privilegios de create_order, que a chama de dentro da mesma transacao)
-- mas SEM grant a anon/authenticated -- so' e' chamavel a partir de outra funcao SECURITY DEFINER do
-- mesmo owner, nunca diretamente pelo client via RPC.
CREATE OR REPLACE FUNCTION public._resolve_item_pricing(
  p_store_id     uuid,
  p_product_id   uuid,
  p_tamanho_label text,
  p_adicionais   jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_prod          record;
  v_tamanho       jsonb;
  v_base          numeric;
  v_cota          numeric;
  v_usados_gratis int := 0;
  v_soma_ads      numeric := 0;
  v_ads_out       jsonb := '[]'::jsonb;
  v_ids_vistos    uuid[] := '{}';
  v_ad_elem       jsonb;
  v_ad_id         uuid;
  v_ad            record;
  v_eh_gratis     boolean;
  v_preco_ad      numeric;
BEGIN
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'produto invalido';
  END IF;

  SELECT preco, preco_promo, tamanhos, adicionais_gratis
    INTO v_prod
    FROM public.products
   WHERE id = p_product_id AND store_id = p_store_id;

  IF NOT FOUND THEN
    -- cobre: produto inexistente E produto de outra loja (mesma mensagem -- anti-enumeracao,
    -- mesmo padrao ja usado em 'loja invalida').
    RAISE EXCEPTION 'produto invalido';
  END IF;

  IF jsonb_typeof(v_prod.tamanhos) = 'array' AND jsonb_array_length(v_prod.tamanhos) > 0 THEN
    -- localiza por label (identificador REAL usado pelo client -- `id` nao existe em boa parte dos
    -- tamanhos reais); ausente/nao encontrado cai no 1o tamanho, igual ao fallback do client.
    SELECT t INTO v_tamanho
      FROM jsonb_array_elements(v_prod.tamanhos) t
     WHERE p_tamanho_label IS NOT NULL AND (t->>'label') = p_tamanho_label
     LIMIT 1;
    IF v_tamanho IS NULL THEN
      v_tamanho := v_prod.tamanhos->0;
    END IF;

    -- precoTamanho(t) = Number(t?.preco ?? t?.price) || 0  (format.js) -- 'preco' vence, 'price' e'
    -- tolerancia a legado; resultado 0/invalido cai no preco do produto (mesma regra do ProductModalInner).
    v_base := NULLIF(COALESCE((v_tamanho->>'preco')::numeric, (v_tamanho->>'price')::numeric), 0);
    IF v_base IS NULL THEN v_base := v_prod.preco; END IF;

    v_cota := COALESCE((v_tamanho->>'adicionais_gratis')::numeric, v_prod.adicionais_gratis, 0);
  ELSE
    -- precoBaseItem(item) = Number(item.preco_promo || item.preco) (pricing.js) -- promo so' vence
    -- quando != 0 (0 e' falsy em JS, negativo NAO e' falsy -- preservado tal qual).
    v_base := CASE WHEN v_prod.preco_promo IS NOT NULL AND v_prod.preco_promo <> 0
                   THEN v_prod.preco_promo ELSE v_prod.preco END;
    v_cota := COALESCE(v_prod.adicionais_gratis, 0);
  END IF;

  IF p_adicionais IS NOT NULL AND jsonb_typeof(p_adicionais) = 'array' THEN
    FOR v_ad_elem IN SELECT value FROM jsonb_array_elements(p_adicionais) LOOP
      v_ad_id := NULLIF(btrim(v_ad_elem->>'id'), '')::uuid;
      IF v_ad_id IS NULL THEN
        RAISE EXCEPTION 'adicional invalido';
      END IF;
      IF v_ad_id = ANY(v_ids_vistos) THEN
        CONTINUE; -- dedupe: mesmo id 2x no payload conta 1x so' (replica o toggle() do client).
      END IF;
      v_ids_vistos := array_append(v_ids_vistos, v_ad_id);

      SELECT id, nome, tipo, preco, grupo, subgrupo_label INTO v_ad
        FROM public.adicionais
       WHERE id = v_ad_id AND store_id = p_store_id AND ativo = true;

      IF NOT FOUND THEN
        -- cobre: adicional inexistente, inativo, E de outra loja (mesma mensagem generica).
        RAISE EXCEPTION 'adicional invalido';
      END IF;

      -- ehAdicionalGratis(ad) = ad.tipo==='gratis' || Number(ad.preco)===0 (addons.js).
      v_eh_gratis := (v_ad.tipo = 'gratis' OR v_ad.preco = 0);
      IF v_eh_gratis THEN
        v_usados_gratis := v_usados_gratis + 1;
        IF v_usados_gratis <= v_cota THEN
          v_preco_ad := 0;
        ELSE
          -- resolverPrecoAdicionais: excedente usa Number(ad.preco) || ADICIONAL_SIMPLES_PRECO (2.00).
          v_preco_ad := CASE WHEN v_ad.preco <> 0 THEN v_ad.preco ELSE 2.00 END;
        END IF;
      ELSE
        v_preco_ad := v_ad.preco;
      END IF;

      v_soma_ads := v_soma_ads + v_preco_ad;
      v_ads_out := v_ads_out || jsonb_build_array(jsonb_build_object(
        'id', v_ad.id, 'nome', v_ad.nome, 'preco', v_preco_ad,
        'tipo', v_ad.tipo, 'grupo', v_ad.grupo, 'subgrupo_label', v_ad.subgrupo_label
      ));
    END LOOP;
  END IF;

  RETURN jsonb_build_object('preco_unitario', v_base + v_soma_ads, 'adicionais', v_ads_out);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._resolve_item_pricing(uuid,uuid,text,jsonb) FROM PUBLIC;

-- ===== 2. create_order(): loop de itens passa a calcular o preco autoritativo (quando product_id
-- valido) em vez de confiar em v_elem->>'price'; orders.total passa a ser a soma dos itens
-- (autoritativos + legado sem product_id) mais delivery_fee/maquininha_fee, nunca mais
-- p_order->>'total' cru. Resto do corpo byte-identico a versao anterior (REF-PROD-GOLIVE-01
-- complemento, "prod-golive-01b").
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
  -- REF-PRICE-SOURCE-01 · Onda 1: acumula os itens ja com o preco AUTORITATIVO resolvido.
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

      v_pid := nullif(btrim(v_elem->>'product_id'), '')::uuid;
      if v_pid is not null then
        -- REF-PRICE-SOURCE-01: preco autoritativo -- nunca confia em v_elem->>'price'. _resolve_item_pricing
        -- lanca excecao (capturada abaixo, mesmo padrao de log/retorno de todo erro desta funcao) se o
        -- produto/adicional for invalido, inativo ou de outra loja.
        v_calc := public._resolve_item_pricing(v_store_id, v_pid, nullif(btrim(v_elem->>'tamanho_label'), ''),
                                                coalesce(v_elem->'adicionais', '[]'::jsonb));
        v_item_price := (v_calc->>'preco_unitario')::numeric;
        v_items_resolved := v_items_resolved || jsonb_build_array(jsonb_build_object(
          'product_id', v_pid, 'nome_produto', v_elem->>'nome_produto',
          'quantity', (v_elem->>'quantity')::int, 'price', v_item_price, 'preco_unitario', v_item_price,
          'adicionais', v_calc->'adicionais', 'observacoes', nullif(btrim(v_elem->>'observacoes'), '')
        ));
      else
        -- SEM product_id: comportamento LEGADO preservado (nao ha' produto no banco para consultar --
        -- ver nota de escopo no topo da migration). price do client segue validado e usado tal qual.
        if nullif(btrim(v_elem->>'price'), '') is null or (v_elem->>'price')::numeric <= 0 then
          raise exception 'item "%" com price invalido', v_elem->>'nome_produto'; end if;
        v_item_price := (v_elem->>'price')::numeric;
        v_items_resolved := v_items_resolved || jsonb_build_array(jsonb_build_object(
          'product_id', null, 'nome_produto', v_elem->>'nome_produto',
          'quantity', (v_elem->>'quantity')::int, 'price', v_item_price,
          'preco_unitario', coalesce((v_elem->>'preco_unitario')::numeric, v_item_price),
          'adicionais', coalesce(v_elem->'adicionais', '[]'::jsonb), 'observacoes', nullif(btrim(v_elem->>'observacoes'), '')
        ));
      end if;
    end loop;

    -- REF-PRICE-SOURCE-01: orders.total deixa de vir de p_order->>'total' -- e' sempre a soma dos itens
    -- (ja autoritativos onde aplicavel) + delivery_fee/maquininha_fee (essas 2, fora de escopo, seguem
    -- vindas do client sem validacao adicional).
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
        values('orders','create_order','order',null,p_request_id,'create_order','price-source-01',v_dur,'error',v_err,v_log,v_state,'unique_violation',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
    when others then
      v_err := sqlerrm; v_state := sqlstate; v_dur := extract(epoch from clock_timestamp()-v_t0)*1000;
      begin insert into public.application_logs(module,operation,entity,entity_id,request_id,rpc,version,duration_ms,level,message,payload,sqlstate,context,origin)
        values('orders','create_order','order',null,p_request_id,'create_order','price-source-01',v_dur,'error',v_err,v_log,v_state,'create_order',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
  end;
end;$function$;

COMMIT;
