-- REF-SAAS-01 · Onda 3 — Identidade do cliente por loja (customers.store_id NOT NULL, uniques
-- compostas, link_customer_to_auth com p_store_id explicito). Decisao ja tomada no ADR §2 — esta
-- migration e a implementacao. Ver docs/adr/REF-SAAS-01-fundacao-multitenant.md §2/§9/§10/§11 e
-- docs/ref/REF-SAAS-01-plano-ondas.md (secao "Onda 3") para a auditoria e o racional completos.
--
-- Achado de auditoria que muda o raio desta migration: `create_order` (RPC critica do checkout,
-- nominalmente escopo da Onda 4) faz `INSERT ... ON CONFLICT (phone)` — o alvo do ON CONFLICT precisa
-- casar EXATAMENTE com um indice unico existente. Trocar o indice de `phone` por `(store_id, phone)`
-- sem corrigir essa unica linha quebraria TODO checkout (erro "no unique or exclusion constraint
-- matching ON CONFLICT specification"). Corrigido aqui, minimamente, porque e consequencia direta e
-- obrigatoria da mudanca de schema desta onda — nao e redesenho do fluxo de pedidos (isso e Onda 4).

BEGIN;

-- store_id ganha DEFAULT (funcao ja criada na Onda 2) — nem link_customer_to_auth nem create_order
-- setavam essa coluna antes desta migration.
ALTER TABLE public.customers ALTER COLUMN store_id SET DEFAULT public.default_store_id();

-- Onda 0 ja garantiu backfill 100% (zero NULL). Promove a NOT NULL agora (ADR §9.1).
ALTER TABLE public.customers ALTER COLUMN store_id SET NOT NULL;

-- Uniques globais -> compostas com store_id lider (ADR §9.4). A mais importante das tres:
-- customers_auth_user_id_key. Hoje ela IMPEDE fisicamente que a mesma pessoa (auth.uid()) tenha
-- clientes em duas lojas diferentes — exatamente o que o ADR §2 decidiu permitir ("dois registros
-- customers distintos, um por loja"). Sao indices parciais (WHERE ... IS NOT NULL), por isso nao viram
-- CONSTRAINT (Postgres nao aceita WHERE em ADD CONSTRAINT UNIQUE) — continuam indices, como ja eram.
DROP INDEX public.customers_phone_uniq;
CREATE UNIQUE INDEX customers_store_phone_uniq ON public.customers (store_id, phone);

DROP INDEX public.customers_email_key;
CREATE UNIQUE INDEX customers_store_email_key ON public.customers (store_id, lower(email)) WHERE (email IS NOT NULL);

DROP INDEX public.customers_auth_user_id_key;
CREATE UNIQUE INDEX customers_store_auth_user_id_key ON public.customers (store_id, auth_user_id) WHERE (auth_user_id IS NOT NULL);

-- create_order: unico ajuste necessario e o INSERT/ON CONFLICT do customer (ver nota acima). Todo o
-- resto da funcao permanece byte-a-byte identico ao que ja estava em producao.
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
  v_delivery_fee    numeric := coalesce(nullif(btrim(p_order->>'delivery_fee'), '')::numeric, 0);
  v_maquininha_fee  numeric := coalesce(nullif(btrim(p_order->>'maquininha_fee'), '')::numeric, 0);
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
      if nullif(btrim(v_elem->>'price'), '') is null or (v_elem->>'price')::numeric <= 0 then
        raise exception 'item "%" com price invalido', v_elem->>'nome_produto'; end if;
    end loop;

    insert into public.customers (name, phone, store_id) values (v_name, v_phone, public.default_store_id())
      on conflict (store_id, phone) do update set name = excluded.name returning id into v_customer_id;
    -- REF-DELIVERY-FEE-01: delivery_fee/maquininha_fee opcionais, lidos de dentro de p_order (mesmo veiculo
    -- dos demais campos livres). Ausentes -> 0, igual a qualquer pedido de hoje (retirada, ou entrega sem
    -- coordenadas — o calculo/decisao de aplicar taxa e do cliente, ver services/delivery/deliveryFeeRules.js).
    insert into public.orders (customer_id, total, status, payment_method, address, observacoes, request_id, endereco_id, delivery_fee, maquininha_fee)
      values (v_customer_id, v_total, v_status, v_pay, v_addr, v_obs, p_request_id,
              nullif(btrim(p_order->>'endereco_id'), '')::uuid, v_delivery_fee, v_maquininha_fee) returning id into v_order_id;
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

-- link_customer_to_auth: ganha p_store_id explicito com DEFAULT de compatibilidade (mesma ponte da
-- Onda 2) — o unico caller hoje (AuthService.js:125) chama com 3 argumentos nomeados; o 4o parametro
-- com DEFAULT nao quebra essa chamada (PostgREST resolve por nome, omitido = DEFAULT). Toda consulta
-- interna que olha `customers` passa a filtrar por `store_id = v_store` (ADR §5 — nunca implicito).
--
-- IMPORTANTE: CREATE OR REPLACE com um parametro A MAIS nao substitui a funcao — Postgres identifica
-- funcoes por nome+tipos dos parametros, entao isso criaria um OVERLOAD, deixando DUAS versoes
-- coexistindo (3 args e 4 args) e tornando AMBIGUA qualquer chamada com exatamente 3 argumentos —
-- inclusive a chamada real de producao. A versao antiga precisa ser removida explicitamente primeiro.
DROP FUNCTION IF EXISTS public.link_customer_to_auth(text, text, text);

CREATE OR REPLACE FUNCTION public.link_customer_to_auth(p_phone text, p_email text DEFAULT NULL::text, p_name text DEFAULT NULL::text, p_store_id uuid DEFAULT public.default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_phone text := public.normalize_phone(p_phone);
  v_email text := lower(nullif(btrim(p_email), ''));
  v_name  text := nullif(btrim(p_name), '');
  v_store uuid := p_store_id;
  v_cid   uuid;
  v_owner uuid;
begin
  if v_uid   is null then return jsonb_build_object('ok', false, 'error', 'nao autenticado'); end if;
  if v_phone is null then return jsonb_build_object('ok', false, 'error', 'telefone invalido'); end if;
  if v_store is null then return jsonb_build_object('ok', false, 'error', 'loja invalida'); end if;

  -- lock por telefone+loja: serializa concorrentes com o mesmo telefone NA MESMA loja (race-safe, sem
  -- duplicar). Antes da Onda 3 o lock era so por telefone — corrigido pq duas lojas distintas com o
  -- mesmo telefone (cliente comum) nao deveriam contender pelo mesmo lock advisory.
  perform pg_advisory_xact_lock(hashtextextended(v_phone || ':' || v_store::text, 0));

  -- (a) existe customer com este TELEFONE nesta LOJA?
  select id, auth_user_id into v_cid, v_owner from public.customers where phone = v_phone and store_id = v_store limit 1;
  if v_cid is not null then
    if v_owner is not null and v_owner <> v_uid then
      return jsonb_build_object('ok', false, 'error', 'telefone ja vinculado a outra conta');
    end if;
    -- REF-LOYALTY-01a: NAO reivindicar automaticamente um cadastro-convidado (auth_user_id NULL) que ja
    -- possui HISTORICO (pedidos ou selos) sem prova de posse do telefone. Fecha o roubo; exige verificacao
    -- manual do admin. So afeta telefones COM historico; contas novas seguem normais. Re-link do proprio
    -- dono (v_owner = v_uid) NAO cai aqui (guarda so quando v_owner IS NULL).
    if v_owner is null and (
         exists (select 1 from public.orders where customer_id = v_cid)
      or exists (select 1 from public.loyalty_events where customer_id = v_cid)
    ) then
      return jsonb_build_object('ok', false, 'status', 'requer_verificacao',
        'error', 'Este telefone ja possui historico de pedidos. Para vincula-lo a sua conta, fale com a loja.');
    end if;
    update public.customers
       set auth_user_id = v_uid,
           email = coalesce(v_email, email),
           name  = coalesce(v_name, name)
     where id = v_cid;
    return jsonb_build_object('ok', true, 'customer_id', v_cid,
                              'status', case when v_owner = v_uid then 'ja_vinculado' else 'vinculado' end);
  end if;

  -- (b) este usuario ja tem customer NESTA LOJA (com outro telefone)? atualiza telefone/email/nome.
  select id into v_cid from public.customers where auth_user_id = v_uid and store_id = v_store limit 1;
  if v_cid is not null then
    update public.customers set phone = v_phone, email = coalesce(v_email, email), name = coalesce(v_name, name) where id = v_cid;
    return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'atualizado');
  end if;

  -- (c) cria novo (telefone identidade + email/nome), nesta loja.
  insert into public.customers(name, phone, email, auth_user_id, store_id)
    values (coalesce(v_name, 'Cliente'), v_phone, v_email, v_uid, v_store)
  returning id into v_cid;
  return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'criado');
end; $function$;

-- admin_link_customer_to_auth: is_admin() cego -> is_admin_of(store_id da linha alvo). Sem uso hoje no
-- frontend (confirmado por grep), mas ja escreve em `customers` e devia seguir o mesmo padrao das
-- demais RPCs de escrita desta onda (ADR §10.2).
CREATE OR REPLACE FUNCTION public.admin_link_customer_to_auth(p_customer_id uuid, p_auth_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_owner uuid; v_store uuid;
begin
  if p_customer_id is null or p_auth_user_id is null then return jsonb_build_object('ok', false, 'error', 'parametros invalidos'); end if;
  select auth_user_id, store_id into v_owner, v_store from public.customers where id = p_customer_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'cliente nao encontrado'); end if;
  if not public.is_admin_of(v_store) then return jsonb_build_object('ok', false, 'error', 'sem permissao'); end if;
  if v_owner is not null and v_owner <> p_auth_user_id then
    return jsonb_build_object('ok', false, 'error', 'cliente ja vinculado a outra conta');
  end if;
  update public.customers set auth_user_id = p_auth_user_id where id = p_customer_id;
  return jsonb_build_object('ok', true, 'customer_id', p_customer_id);
end; $function$;

-- RLS: "Admin all customers" is_admin() cego -> is_admin_of(store_id) (mesma mudanca de comportamento
-- real da Onda 2: um admin deixa de conseguir tocar cliente de outra loja).
ALTER POLICY "Admin all customers" ON public.customers USING (public.is_admin_of(store_id)) WITH CHECK (public.is_admin_of(store_id));

-- RLS: "Cliente le proprio customer" ganha ancora na loja padrao (ponte Onda3-6, mesmo papel do
-- default_store_id() na leitura publica do catalogo). Sem isso, a consulta hoje em
-- AuthService.js:111 (`.eq('auth_user_id', userId).limit(1)`, sem filtro de loja) ficaria ambigua no
-- dia em que existir uma 2a loja: poderia devolver a linha ERRADA (de outra loja) pro mesmo usuario,
-- sem determinismo nenhum (sem ORDER BY). A trava e no RLS, nao no codigo do frontend (Onda 6 e quem
-- vai passar o store_id explicito na propria consulta).
ALTER POLICY "Cliente le proprio customer" ON public.customers USING ((auth_user_id = auth.uid()) AND (store_id = public.default_store_id()));

COMMIT;
