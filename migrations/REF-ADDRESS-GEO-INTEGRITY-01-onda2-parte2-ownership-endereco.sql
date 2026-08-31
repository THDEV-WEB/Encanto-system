-- REF-ADDRESS-GEO-INTEGRITY-01 · Onda 2, Parte 2 -- ownership de endereco_id em create_order().
--
-- ACHADO (auditoria Onda 1, reproduzido com dados descartaveis no projeto E2E, BEGIN...ROLLBACK --
-- Teste 5, 2 assercoes, ambas PASS): create_order() ja validava que endereco_id pertence a MESMA
-- loja (dentro de _resolve_delivery_fee, so' para o calculo da taxa), mas NUNCA validava que
-- pertence ao customer que esta fazendo o pedido -- nem para o calculo da taxa, nem para o vinculo
-- persistido em orders.endereco_id. Provado: customer D conseguia criar um pedido usando o
-- endereco_id do customer C (mesma loja, contas diferentes), sem nenhum erro/rejeicao.
--
-- CORRECAO NA VERSAO CERTA (importante): create_order() foi redefinida DUAS vezes depois da
-- REF-DELIVERY-FEE-04 Onda 1 -- a Onda 2 (REF-DELIVERY-FEE-04-onda2-transparencia-valor.sql,
-- 2026-08-29 11:15) acrescentou a checagem de "divergencia_valor" (nao persiste silenciosamente
-- quando o client declarou uma expectativa de delivery_fee/maquininha_fee que diverge do
-- autoritativo). Uma 1a tentativa desta Parte 2 baseou-se por engano na versao da Onda 1 (mais
-- antiga) e foi corrigida ANTES de aplicar em qualquer lugar alem do E2E de teste -- pego pela
-- propria regressao obrigatoria desta onda (scripts/delivery-fee-04-onda1-test.mjs, que ja estava
-- adaptado para a mecanica de divergencia da Onda 2, acusou 14 falhas). Esta migration parte da
-- versao CORRETA (Onda 2 da REF-DELIVERY-FEE-04), byte-identica exceto pelo bloco de ownership.
--
-- MODELO ATUAL (estudado antes de alterar, ver REF-ADDRESS-SEC-01/REF-AUTH-TENANT-01 Onda 5):
--   - addresses.customer_id e' atribuido por save_structured_address() usando auth.uid() ->
--     customers.auth_user_id (a MESMA fonte de verdade usada aqui). NAO vem de nenhum parametro do
--     client.
--   - Endereco "orfao" (customer_id IS NULL) e' o modelo de GUEST hoje -- guest nunca tem
--     auth.uid(), entao nunca "e dono" de nada; qualquer endereco criado por uma sessao sem sessao
--     (ou por uma sessao autenticada cujo customer_id nao pode ser resolvido, mesmo fallback ja
--     existente em save_structured_address) fica orfao.
--   - create_order() resolve v_customer_id (o customer do PEDIDO) por (store_id, phone) -- upsert
--     que pode nao ser exatamente "quem esta logado" (ex.: alguem digita um telefone que ja existe
--     como customer de outra pessoa). Por isso a checagem de ownership do endereco usa auth.uid()
--     diretamente (mesma fonte que save_structured_address), nunca o v_customer_id do upsert por
--     telefone -- evita falso-negativo para um cliente legitimo cujo telefone digitado no checkout
--     nao bata 1:1 com o customer_id que ja possui o endereco.
--
-- REGRA NOVA (inserida em create_order(), logo apos v_store_id ser resolvido e ANTES da chamada a
-- _resolve_delivery_fee -- assim um endereco rejeitado tambem nao vaza a coordenada de outra pessoa
-- para o calculo da taxa):
--   - Sessao AUTENTICADA (auth.uid() IS NOT NULL): endereco_id so' e aceito se for ORFAO
--     (customer_id IS NULL -- preserva o fluxo legitimo de "salvei o endereco antes de logar, no
--     mesmo checkout") OU pertencer a um customer cujo auth_user_id = auth.uid() (o PROPRIO dono).
--     Qualquer outro caso -> v_endereco_id vira NULL (mesmo fallback silencioso ja usado para
--     "endereco de outra loja" -- o pedido continua sendo criado normalmente, so' sem o vinculo
--     estruturado; o texto livre em orders.address, que o checkout sempre manda, fica intacto).
--   - GUEST (auth.uid() IS NULL): so' aceita endereco ORFAO (customer_id IS NULL) -- MESMO modelo
--     de hoje, nenhuma mudanca de comportamento para guest. Um guest nunca consegue usar o endereco
--     de um customer identificado (fecha tambem a variante guest->autenticado do mesmo problema,
--     nao coberta pelo Teste 5 original mas no mesmo caminho de codigo).
--   - Em AMBOS os casos, o store_id continua checado (a.store_id = v_store_id) -- fecha de quebra
--     um efeito colateral do achado: hoje um endereco_id de OUTRA loja e' aceito e gravado em
--     orders.endereco_id mesmo a taxa caindo no fallback anti-enumeracao (_resolve_delivery_fee so'
--     protege o CALCULO, nunca protegeu o vinculo persistido).
--
-- Resto do corpo BYTE-IDENTICO a versao anterior (REF-DELIVERY-FEE-04 Onda 2, transparencia de
-- valor) -- nenhuma outra alteracao. Nao mexe em _resolve_delivery_fee/_resolve_item_pricing/regra
-- de faixas/Haversine/checagem de divergencia_valor.
--
-- Testes: scripts/address-geo-integrity-01-onda2-test.mjs (projeto E2E dedicado, BEGIN...ROLLBACK).

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

    -- REF-ADDRESS-GEO-INTEGRITY-01 · Onda 2, Parte 2: ownership de endereco_id -- ver justificativa
    -- completa no cabecalho desta migration. Fallback silencioso (NULL), nunca derruba o pedido.
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
        values('orders','create_order','order',null,p_request_id,'create_order','address-geo-integrity-01',v_dur,'error',v_err,v_log,v_state,'unique_violation',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
    when others then
      v_err := sqlerrm; v_state := sqlstate; v_dur := extract(epoch from clock_timestamp()-v_t0)*1000;
      begin insert into public.application_logs(module,operation,entity,entity_id,request_id,rpc,version,duration_ms,level,message,payload,sqlstate,context,origin)
        values('orders','create_order','order',null,p_request_id,'create_order','address-geo-integrity-01',v_dur,'error',v_err,v_log,v_state,'create_order',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
  end;
end;$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── VERIFICACAO (rodar manualmente apos aplicar) ──────────────────────────────────────────────────
-- 1. Customer autenticado usando o PROPRIO endereco -> pedido criado normalmente, endereco_id preenchido.
-- 2. Customer autenticado usando endereco de OUTRO customer da mesma loja -> pedido criado, mas
--    endereco_id fica NULL (fallback silencioso, texto livre de orders.address preservado).
-- 3. Guest usando endereco orfao (customer_id NULL) da mesma loja -> comportamento identico a hoje.
-- 4. Guest tentando usar endereco de um customer autenticado -> endereco_id fica NULL.
-- 5. Checagem de divergencia_valor (REF-DELIVERY-FEE-04 Onda 2) continua intacta e nao regrediu.
