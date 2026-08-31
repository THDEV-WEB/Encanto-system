-- ============================================================================
-- REF-MESA-01 · Onda 1 — Fundação do domínio multicanal de atendimento
-- ----------------------------------------------------------------------------
-- Achado da auditoria (REF-MESA-01-auditoria.md): o sistema não representa o
-- tipo de pedido como um fato estruturado. Entrega/Retirada são inferidos por
-- regex (/retirada\s+na\s+loja/i) sobre o texto livre de orders.address,
-- duplicada independentemente em comandaModel.js (JS), enc_tempo_estimado() e
-- admin_reports_summary() (SQL). Esta Onda fecha essa lacuna na raiz: cria uma
-- coluna estruturada (`tipo_pedido`) e persiste a origem/canal do pedido
-- (`origem_pedido`) e a identificação da mesa (`mesa_identificador`), sem
-- tocar em NENHUM comportamento existente de Entrega/Retirada.
--
-- DECISÃO DE NOMENCLATURA (registrada, não inventada): o valor persistido da
-- modalidade de entrega continua 'entrega' (não 'delivery') — é o valor já
-- usado em toda a base (status, pedidoStatus.js, comandaModel.js) há anos.
-- Ver docs/ref/REF-MESA-01-plano-ondas.md §1.1 para a justificativa completa.
--
-- COMPATIBILIDADE COM PEDIDOS HISTÓRICOS: `tipo_pedido` nasce com
-- DEFAULT 'entrega' — Postgres 11+ aplica DEFAULT a linhas existentes sem
-- reescrever a tabela e sem reinterpretar dado nenhum (nenhuma heurística
-- rodou sobre o histórico). `origem_pedido` nasce com DEFAULT 'storefront',
-- que não é uma suposição: é o único canal que já existiu até esta REF.
--
-- ESCOPO DESTA ONDA (fundação, backend apenas): coluna + constraints em
-- orders; capability opt-in por loja (get_mesa_config/set_mesa_config,
-- mesmo molde de get_loyalty_config/set_loyalty_config); validação
-- server-side de tipo_pedido='mesa' dentro de create_order(), fail-closed,
-- no MESMO ponto onde a resolução de tenant já acontece (REF-ORDER-TENANT-01).
-- Mesa reaproveita o caminho de "zero taxa de entrega" que retirada já tem em
-- _resolve_delivery_fee — SEM tocar nessa função (ela permanece com a MESMA
-- assinatura/corpo; create_order só passa um booleano diferente pra ela).
--
-- NÃO TOCADO NESTA ONDA (por "regra absoluta de escopo", ver auditoria): a
-- notificação WhatsApp (enc_tempo_estimado/enc_render_message) e o relatório
-- (admin_reports_summary) continuam fazendo regex sobre address — um pedido
-- de mesa seria hoje classificado como "entrega" nesses dois pontos até as
-- Ondas 6/7 tratarem isso explicitamente. Não é falha de segurança (não afeta
-- cobrança nem isolamento de tenant), é lacuna de exibição/operação já
-- conhecida e documentada, propositalmente adiada.
--
-- ATENÇÃO OPERACIONAL (registrada para quem for aplicar migrations depois):
-- este CREATE OR REPLACE de create_order() foi construído em cima da versão
-- VIGENTE no projeto Supabase de E2E (bgzcro..., onde esta migration foi
-- testada) no momento desta REF — que já inclui o hardening de
-- REF-ADDRESS-GEO-INTEGRITY-01 Onda 2 (ownership de endereco_id). Caso o
-- banco-alvo desta aplicação NÃO tenha ainda essa Onda aplicada, aplique
-- REF-ADDRESS-GEO-INTEGRITY-01 (onda2-parte1 e onda2-parte2) ANTES desta
-- migration, ou reconcilie manualmente as duas versões de create_order() —
-- CREATE OR REPLACE substitui o corpo inteiro, não faz merge.
--
-- Idempotente (CREATE OR REPLACE, ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT
-- IF EXISTS antes de recriar). Preserva 100% dos pedidos existentes.
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1) orders.tipo_pedido — modalidade estruturada (substitui a inferência por
--    regex para qualquer código NOVO; o histórico continua legível pela
--    regex antiga onde ainda for necessário, sem obrigação de backfill).
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tipo_pedido text NOT NULL DEFAULT 'entrega';

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_tipo_pedido_valid;
ALTER TABLE public.orders ADD CONSTRAINT orders_tipo_pedido_valid
  CHECK (tipo_pedido IN ('entrega', 'retirada', 'mesa'));

-- ─────────────────────────────────────────────────────────────────────────
-- 2) orders.origem_pedido — canal de criação. DEFAULT 'storefront' é FATO,
--    não heurística: nenhum outro canal existiu antes desta REF.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS origem_pedido text NOT NULL DEFAULT 'storefront';

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_origem_pedido_valid;
ALTER TABLE public.orders ADD CONSTRAINT orders_origem_pedido_valid
  CHECK (origem_pedido IN ('storefront', 'qr_mesa', 'admin_garcom'));

-- ─────────────────────────────────────────────────────────────────────────
-- 3) orders.mesa_identificador — identificação estruturada da mesa. Nasce
--    aqui (mesmo sem uso ainda pelo storefront/QR/admin) para NÃO exigir
--    remodelagem de orders quando os canais QR (Onda 3) e Admin/garçom
--    (Onda 4) forem ligados. NUNCA reaproveita `address` como já acontecia
--    para retirada — é exatamente essa "gaveta de metadado" que a REF existe
--    para eliminar. Tamanho limitado (1-40) só para higiene de exibição na
--    comanda/Admin, sem impacto em cálculo nenhum.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS mesa_identificador text NULL;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_mesa_identificador_coerente;
ALTER TABLE public.orders ADD CONSTRAINT orders_mesa_identificador_coerente
  CHECK (
    (tipo_pedido = 'mesa' AND mesa_identificador IS NOT NULL AND length(btrim(mesa_identificador)) BETWEEN 1 AND 40)
    OR (tipo_pedido <> 'mesa' AND mesa_identificador IS NULL)
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Capability por loja — mesmo molde EXATO de get_loyalty_config/
--    set_loyalty_config (REF-LOYALTY-AUDIT-01): 3 chaves flat em
--    store_settings, default seguro = tudo desabilitado (nenhuma loja
--    existente ganha Mesa automaticamente). canal_qr/canal_admin já nascem
--    como flags independentes — não exigem nova coluna quando as Ondas 3/4
--    ligarem os respectivos canais.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_mesa_config(p_store_id uuid DEFAULT default_store_id())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT jsonb_build_object(
    'habilitada',  COALESCE((SELECT valor FROM public.store_settings WHERE store_id = p_store_id AND chave = 'mesa_habilitada'), 'false') <> 'false',
    'canal_qr',    COALESCE((SELECT valor FROM public.store_settings WHERE store_id = p_store_id AND chave = 'mesa_canal_qr'), 'false') <> 'false',
    'canal_admin', COALESCE((SELECT valor FROM public.store_settings WHERE store_id = p_store_id AND chave = 'mesa_canal_admin'), 'false') <> 'false'
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.get_mesa_config(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mesa_config(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_mesa_config(p_habilitada boolean, p_canal_qr boolean, p_canal_admin boolean, p_store_id uuid DEFAULT default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if not public.is_admin_of(p_store_id) then return jsonb_build_object('ok', false, 'error', 'sem permissao'); end if;

  insert into public.store_settings (store_id, chave, valor) values (p_store_id, 'mesa_habilitada', case when p_habilitada then 'true' else 'false' end)
    on conflict (store_id, chave) do update set valor = excluded.valor;
  insert into public.store_settings (store_id, chave, valor) values (p_store_id, 'mesa_canal_qr', case when p_canal_qr then 'true' else 'false' end)
    on conflict (store_id, chave) do update set valor = excluded.valor;
  insert into public.store_settings (store_id, chave, valor) values (p_store_id, 'mesa_canal_admin', case when p_canal_admin then 'true' else 'false' end)
    on conflict (store_id, chave) do update set valor = excluded.valor;

  return jsonb_build_object('ok', true, 'habilitada', p_habilitada, 'canal_qr', p_canal_qr, 'canal_admin', p_canal_admin);
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_mesa_config(boolean, boolean, boolean, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_mesa_config(boolean, boolean, boolean, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_mesa_config(boolean, boolean, boolean, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) create_order() — aceita tipo_pedido/origem_pedido/mesa_identificador,
--    100% retrocompatível (client antigo não manda nenhum dos 3, servidor
--    deriva tipo_pedido de `retirada` exatamente como hoje). Validação de
--    capacidade de Mesa acontece logo após v_store_id ser resolvido com
--    confiança (mesmo ponto de _resolve_delivery_fee), fail-closed, mensagem
--    genérica — fecha bypass via RPC direta (anon, authenticated,
--    cross-tenant, frontend adulterado: todos passam por este mesmo ponto).
--    _resolve_delivery_fee NÃO é tocada: Mesa reaproveita o ramo "sem taxa"
--    que retirada já tem, só mudando o booleano que create_order passa pra
--    ela (v_tipo_pedido <> 'entrega' em vez de só v_retirada).
-- ─────────────────────────────────────────────────────────────────────────
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
  -- REF-MESA-01 · Onda 1: tipo_pedido explicito (client novo) tem prioridade; client antigo (nunca
  -- manda tipo_pedido) deriva exatamente como hoje a partir de `retirada`. origem_pedido default
  -- 'storefront' -- unico canal que existe ate esta Onda (Onda 3/4 ligam qr_mesa/admin_garcom).
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
  -- Client NAO pode forcar tipo_pedido='mesa' numa loja sem a capacidade -- fail-closed, mensagem
  -- generica, mesmo padrao anti-enumeracao de 'loja invalida'/'loja nao identificada' acima.
  if v_tipo_pedido = 'mesa' then
    v_mesa_cfg := public.get_mesa_config(v_store_id);
    if not coalesce((v_mesa_cfg->>'habilitada')::boolean, false) then
      return jsonb_build_object('ok', false, 'error', 'modalidade indisponivel para esta loja');
    end if;
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
    -- estruturado, nunca mais a fonte de verdade do tipo (essa e' a razao de existir desta REF).
    if v_tipo_pedido = 'mesa' then
      if v_mesa_identificador is null then raise exception 'identificacao da mesa e obrigatoria'; end if;
      if v_addr is null then v_addr := 'Mesa ' || v_mesa_identificador; end if;
    elsif v_mesa_identificador is not null then
      raise exception 'mesa_identificador so e valido para tipo_pedido mesa';
    end if;

    if v_addr is null then raise exception 'address e obrigatorio'; end if;

    -- REF-ADDRESS-GEO-INTEGRITY-01 · Onda 2, Parte 2: ownership de endereco_id -- INTOCADO por esta
    -- REF, reproduzido aqui byte-a-byte a partir da versao vigente.
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
    -- REF-MESA-01 · Onda 1: Mesa reaproveita o MESMO ramo "sem taxa" que retirada ja tinha em
    -- _resolve_delivery_fee (funcao INTOCADA) -- so muda o booleano que create_order passa pra ela.
    v_fee_calc := public._resolve_delivery_fee(v_store_id, (v_tipo_pedido <> 'entrega'), v_pay, v_endereco_id);
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
    insert into public.orders (customer_id, total, status, payment_method, address, observacoes, request_id, endereco_id, delivery_fee, maquininha_fee, store_id, tipo_pedido, origem_pedido, mesa_identificador)
      values (v_customer_id, v_total, v_status, v_pay, v_addr, v_obs, p_request_id,
              v_endereco_id, v_delivery_fee, v_maquininha_fee, v_store_id, v_tipo_pedido, v_origem_pedido, v_mesa_identificador) returning id into v_order_id;
    insert into public.order_items (order_id, product_id, nome_produto, quantity, price, preco_unitario, adicionais, observacoes, store_id)
      select v_order_id, (item->>'product_id')::uuid, item->>'nome_produto',
             (item->>'quantity')::int, (item->>'price')::numeric, (item->>'preco_unitario')::numeric,
             coalesce(item->'adicionais','[]'::jsonb), item->>'observacoes', v_store_id
      from jsonb_array_elements(v_items_resolved) as t(item);

    -- REF-LOYALTY-01: concede 1 selo por pedido VALIDO (mesma transacao). Best-effort:
    -- fidelidade NUNCA reverte um pedido ja persistido (savepoint implicito no sub-bloco).
    -- REF-MESA-01: agnostico a tipo_pedido, INTOCADO -- confirmado pela auditoria que loyalty_grant
    -- so recebe (customer_id, order_id), nunca tipo/endereco.
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
        values('orders','create_order','order',null,p_request_id,'create_order','mesa-01-onda1',v_dur,'error',v_err,v_log,v_state,'unique_violation',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
    when others then
      v_err := sqlerrm; v_state := sqlstate; v_dur := extract(epoch from clock_timestamp()-v_t0)*1000;
      begin insert into public.application_logs(module,operation,entity,entity_id,request_id,rpc,version,duration_ms,level,message,payload,sqlstate,context,origin)
        values('orders','create_order','order',null,p_request_id,'create_order','mesa-01-onda1',v_dur,'error',v_err,v_log,v_state,'create_order',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
  end;
end;$function$;

-- recarrega o schema no PostgREST (assinaturas novas ficam visiveis na API imediatamente)
NOTIFY pgrst, 'reload schema';

COMMIT;
