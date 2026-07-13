-- ============================================================================
-- REF-LOYALTY-01 — Sistema Profissional de Fidelidade (fonte unica = Supabase)
-- ----------------------------------------------------------------------------
-- Objetivo: a fidelidade passa a PERTENCER AO CUSTOMER (customers.id), persistida
-- no Supabase, sincronizada entre dispositivos, imune a manipulacao do navegador.
--
-- Modelo:
--   * loyalty_accounts  -> resumo 1 linha/cliente (leitura rapida com RLS).
--   * loyalty_events    -> LEDGER imutavel (historico/proveniencia + backstop de idempotencia).
-- Toda MUTACAO ocorre EXCLUSIVAMENTE no backend:
--   * ganhar selo  -> DENTRO de create_order (mesma transacao atomica do pedido) via loyalty_grant().
--   * cancelar     -> trigger em orders (status -> 'cancelado') reverte o selo daquele pedido.
--   * resgatar     -> redeem_reward() (dono OU admin), atomico com lock de linha.
--   * ajustar/config-> RPCs admin (is_admin()).
-- Antifraude: cliente NUNCA escreve direto (RLS write = default-deny + REVOKE); selo so
-- com pedido valido persistido; idempotente por request_id (create_order) E por
-- indice unico parcial (loyalty_events order_id WHERE tipo='earned').
--
-- Idempotente (CREATE ... IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS /
-- ON CONFLICT DO NOTHING). Versionado. Preserva 100% dos dados existentes (apenas
-- ACRESCENTA objetos; nao altera/remove nenhuma coluna, linha ou tabela existente).
-- Compat producao (Supabase/Postgres 15).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1) CONFIG (reutiliza a tabela settings ja existente; regra comercial preservada)
--    10 pedidos -> 1 recompensa de 50%. enabled = programa ligado.
-- ─────────────────────────────────────────────────────────────────────────
insert into public.settings (chave, valor) values
  ('loyalty_required', '10'),
  ('loyalty_discount', '50'),
  ('loyalty_enabled',  'true')
on conflict (chave) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) TABELAS (fonte unica de verdade)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.loyalty_accounts (
  customer_id      uuid primary key references public.customers(id) on delete cascade,
  stamps           integer     not null default 0,   -- progresso no ciclo atual (0..required)
  earned_total     integer     not null default 0,   -- selos validos acumulados na vida (liq. de revogacoes)
  rewards_redeemed integer     not null default 0,    -- recompensas ja consumidas
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.loyalty_events (
  id           uuid        primary key default gen_random_uuid(),
  customer_id  uuid        not null references public.customers(id) on delete cascade,
  order_id     uuid        references public.orders(id) on delete set null,
  tipo         text        not null check (tipo in ('earned','revoked','redeemed','adjustment')),
  delta        integer     not null,
  stamps_after integer,
  origem       text,       -- 'create_order' | 'cancel_trigger' | 'redeem' | 'admin'
  note         text,
  created_at   timestamptz not null default now()
);

-- Idempotencia FORTE: no maximo UM 'earned' por pedido (permite 'revoked' com o mesmo order_id).
create unique index if not exists loyalty_events_earned_order_uq
  on public.loyalty_events (order_id) where (tipo = 'earned' and order_id is not null);

create index if not exists loyalty_events_customer_idx
  on public.loyalty_events (customer_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) RLS (espelha orders/order_items: cliente le o proprio; admin tudo; anon default-deny)
--    Nenhuma policy de INSERT/UPDATE/DELETE p/ cliente -> toda escrita passa por RPC SECURITY DEFINER.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.loyalty_accounts enable row level security;
alter table public.loyalty_events   enable row level security;

drop policy if exists loyalty_accounts_read_own  on public.loyalty_accounts;
drop policy if exists loyalty_accounts_admin_all on public.loyalty_accounts;
create policy loyalty_accounts_read_own on public.loyalty_accounts
  for select to authenticated
  using (public.is_admin() or customer_id in (select id from public.customers where auth_user_id = auth.uid()));
create policy loyalty_accounts_admin_all on public.loyalty_accounts
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists loyalty_events_read_own  on public.loyalty_events;
drop policy if exists loyalty_events_admin_all on public.loyalty_events;
create policy loyalty_events_read_own on public.loyalty_events
  for select to authenticated
  using (public.is_admin() or customer_id in (select id from public.customers where auth_user_id = auth.uid()));
create policy loyalty_events_admin_all on public.loyalty_events
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────
-- 4) NUCLEO: conceder selo (chamado SO por create_order — nunca pelo cliente)
--    Cap: acumula somente enquanto stamps < required (nao cumulativo, 1 por ciclo).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.loyalty_grant(p_customer_id uuid, p_order_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_required int     := coalesce(nullif(public.get_setting('loyalty_required','10'),'')::int, 10);
  v_enabled  boolean := lower(coalesce(public.get_setting('loyalty_enabled','true'),'true')) <> 'false';
  v_stamps   int;
begin
  if not v_enabled or p_customer_id is null or p_order_id is null then return; end if;
  -- idempotencia macia (o indice unico parcial e o backstop duro)
  if exists (select 1 from public.loyalty_events where order_id = p_order_id and tipo = 'earned') then return; end if;

  insert into public.loyalty_accounts (customer_id) values (p_customer_id)
    on conflict (customer_id) do nothing;
  select stamps into v_stamps from public.loyalty_accounts where customer_id = p_customer_id for update;

  if coalesce(v_stamps, 0) >= v_required then return; end if;   -- cartela cheia: nao acumula alem

  update public.loyalty_accounts
     set stamps = stamps + 1, earned_total = earned_total + 1, updated_at = now()
   where customer_id = p_customer_id
   returning stamps into v_stamps;

  insert into public.loyalty_events (customer_id, order_id, tipo, delta, stamps_after, origem, note)
    values (p_customer_id, p_order_id, 'earned', 1, v_stamps, 'create_order', 'pedido valido');
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) create_order — REABERTO com a MESMA logica + 1 bloco de acrescimo de fidelidade.
--    O bloco e best-effort (BEGIN/EXCEPTION): fidelidade NUNCA derruba um pedido persistido.
--    (Reproduz create_order harden-05 byte-a-byte + a chamada a loyalty_grant.)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.create_order(p_customer jsonb, p_order jsonb, p_items jsonb, p_request_id uuid DEFAULT NULL::uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_customer_id uuid; v_order_id uuid;
  v_name   text := nullif(btrim(p_customer->>'name'), '');
  v_phone  text := public.normalize_phone(p_customer->>'phone');
  v_total  numeric;
  v_pay    text := nullif(btrim(p_order->>'payment_method'), '');
  v_addr   text := nullif(btrim(p_order->>'address'), '');
  v_status text := coalesce(nullif(btrim(p_order->>'status'), ''), 'recebido');
  v_obs    text := nullif(btrim(p_order->>'observacoes'), '');
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

    insert into public.customers (name, phone) values (v_name, v_phone)
      on conflict (phone) do update set name = excluded.name returning id into v_customer_id;
    insert into public.orders (customer_id, total, status, payment_method, address, observacoes, request_id)
      values (v_customer_id, v_total, v_status, v_pay, v_addr, v_obs, p_request_id) returning id into v_order_id;
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

-- ─────────────────────────────────────────────────────────────────────────
-- 6) CANCELAMENTO: pedido -> 'cancelado' reverte o selo daquele pedido (uma vez).
--    Best-effort: nunca bloqueia a mudanca de status do pedido.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.loyalty_void_on_cancel()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_stamps   int;
  v_required int := coalesce(nullif(public.get_setting('loyalty_required','10'),'')::int, 10);
  v_contrib  int;     -- contribuicao LIQUIDA deste pedido (earned/revoked/reativado) ao saldo
  v_earned   boolean;
begin
  -- ENTRANDO em 'cancelado': reverte a contribuicao liquida deste pedido (idempotente por contrib).
  if new.status = 'cancelado' and coalesce(old.status,'') <> 'cancelado' then
    begin
      select coalesce(sum(delta),0) into v_contrib from public.loyalty_events
        where order_id = new.id and origem in ('create_order','cancel_trigger');
      if v_contrib > 0 then
        update public.loyalty_accounts
           set stamps = greatest(0, stamps - v_contrib), earned_total = greatest(0, earned_total - v_contrib), updated_at = now()
         where customer_id = new.customer_id
         returning stamps into v_stamps;
        insert into public.loyalty_events (customer_id, order_id, tipo, delta, stamps_after, origem, note)
          values (new.customer_id, new.id, 'revoked', -v_contrib, v_stamps, 'cancel_trigger', 'pedido cancelado');
      end if;
    exception when others then
      null;   -- fidelidade nunca impede o cancelamento do pedido
    end;
  -- REF-LOYALTY-01 fix (#2) SAINDO de 'cancelado' (reabertura): restaura 1 selo se o pedido havia
  -- concedido e sua contribuicao esta zerada (respeita o cap; registrado como adjustment do trigger).
  elsif coalesce(old.status,'') = 'cancelado' and new.status <> 'cancelado' then
    begin
      select exists (select 1 from public.loyalty_events where order_id = new.id and tipo = 'earned') into v_earned;
      select coalesce(sum(delta),0) into v_contrib from public.loyalty_events
        where order_id = new.id and origem in ('create_order','cancel_trigger');
      if v_earned and v_contrib <= 0 then
        select stamps into v_stamps from public.loyalty_accounts where customer_id = new.customer_id for update;
        if coalesce(v_stamps,0) < v_required then
          update public.loyalty_accounts
             set stamps = stamps + 1, earned_total = earned_total + 1, updated_at = now()
           where customer_id = new.customer_id
           returning stamps into v_stamps;
          insert into public.loyalty_events (customer_id, order_id, tipo, delta, stamps_after, origem, note)
            values (new.customer_id, new.id, 'adjustment', 1, v_stamps, 'cancel_trigger', 'pedido reativado');
        end if;
      end if;
    exception when others then
      null;   -- reativacao best-effort: nunca impede a mudanca de status
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_loyalty_void_on_cancel on public.orders;
create trigger trg_loyalty_void_on_cancel
  after update of status on public.orders
  for each row execute function public.loyalty_void_on_cancel();

-- ─────────────────────────────────────────────────────────────────────────
-- 7) RESGATE: consome 1 recompensa (dono via auth.uid() OU admin via p_customer_id).
--    Atomico (FOR UPDATE); so quando stamps >= required; abre novo ciclo (stamps -= required).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.redeem_reward(p_customer_id uuid DEFAULT NULL)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_uid      uuid := auth.uid();
  v_cid      uuid := p_customer_id;
  v_required int  := coalesce(nullif(public.get_setting('loyalty_required','10'),'')::int, 10);
  v_discount int  := coalesce(nullif(public.get_setting('loyalty_discount','50'),'')::int, 50);
  v_enabled  boolean := lower(coalesce(public.get_setting('loyalty_enabled','true'),'true')) <> 'false';
  v_admin    boolean := public.is_admin();
  v_stamps   int;
begin
  -- REF-LOYALTY-01 fix (#5): programa desativado nao e resgatavel pelo cliente (admin pode operar).
  if not v_admin and not v_enabled then return jsonb_build_object('ok', false, 'error', 'programa desativado'); end if;
  if v_admin then
    if v_cid is null then return jsonb_build_object('ok', false, 'error', 'customer_id obrigatorio'); end if;
  else
    if v_uid is null then return jsonb_build_object('ok', false, 'error', 'nao autenticado'); end if;
    select id into v_cid from public.customers where auth_user_id = v_uid limit 1;
    if v_cid is null then return jsonb_build_object('ok', false, 'error', 'cliente sem cadastro'); end if;
    if p_customer_id is not null and p_customer_id <> v_cid then
      return jsonb_build_object('ok', false, 'error', 'sem permissao'); end if;
  end if;

  select stamps into v_stamps from public.loyalty_accounts where customer_id = v_cid for update;
  if v_stamps is null or v_stamps < v_required then
    return jsonb_build_object('ok', false, 'error', 'recompensa indisponivel',
                              'stamps', coalesce(v_stamps,0), 'required', v_required);
  end if;

  update public.loyalty_accounts
     set stamps = stamps - v_required, rewards_redeemed = rewards_redeemed + 1, updated_at = now()
   where customer_id = v_cid returning stamps into v_stamps;
  insert into public.loyalty_events (customer_id, tipo, delta, stamps_after, origem, note)
    values (v_cid, 'redeemed', -v_required, v_stamps, case when v_admin then 'admin' else 'redeem' end,
            'recompensa ' || v_discount || '%');

  return jsonb_build_object('ok', true, 'stamps', v_stamps, 'required', v_required, 'discount', v_discount,
                            'rewards_redeemed', (select rewards_redeemed from public.loyalty_accounts where customer_id = v_cid));
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) LEITURA do CLIENTE (self, via auth.uid()) — 1 chamada devolve estado + config.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.get_my_loyalty()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_uid      uuid := auth.uid();
  v_cid      uuid;
  v_stamps   int := 0;
  v_rr       int := 0;
  v_required int     := coalesce(nullif(public.get_setting('loyalty_required','10'),'')::int, 10);
  v_discount int     := coalesce(nullif(public.get_setting('loyalty_discount','50'),'')::int, 50);
  v_enabled  boolean := lower(coalesce(public.get_setting('loyalty_enabled','true'),'true')) <> 'false';
begin
  if v_uid is not null then
    select id into v_cid from public.customers where auth_user_id = v_uid limit 1;
    if v_cid is not null then
      select stamps, rewards_redeemed into v_stamps, v_rr from public.loyalty_accounts where customer_id = v_cid;
      v_stamps := coalesce(v_stamps, 0); v_rr := coalesce(v_rr, 0);
    end if;
  end if;
  -- REF-LOYALTY-01 fix (#5): programa desativado NUNCA oferece recompensa (nem no cliente, nem na API)
  return jsonb_build_object('enabled', v_enabled, 'stamps', v_stamps, 'required', v_required,
                            'discount', v_discount, 'reward_available', (v_enabled and v_stamps >= v_required),
                            'rewards_redeemed', v_rr, 'has_account', (v_cid is not null));
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) ADMIN: buscar por telefone/nome, ajustar manualmente, configurar o programa.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_find_loyalty(p_query text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_phone text := public.normalize_phone(p_query);
  v_q     text := btrim(coalesce(p_query, ''));
  v_required int := coalesce(nullif(public.get_setting('loyalty_required','10'),'')::int, 10);
  v_rec   record;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'sem permissao'); end if;
  if v_q = '' then return jsonb_build_object('ok', false, 'error', 'busca vazia'); end if;

  select c.id, c.name, c.phone, coalesce(a.stamps,0) as stamps, coalesce(a.rewards_redeemed,0) as rewards_redeemed
    into v_rec
    from public.customers c
    left join public.loyalty_accounts a on a.customer_id = c.id
   where (v_phone is not null and c.phone = v_phone) or c.name ilike '%'||v_q||'%'
   order by (v_phone is not null and c.phone = v_phone) desc, c.created_at desc
   limit 1;

  if v_rec.id is null then return jsonb_build_object('ok', false, 'error', 'cliente nao encontrado'); end if;
  return jsonb_build_object('ok', true, 'customer_id', v_rec.id, 'name', v_rec.name, 'phone', v_rec.phone,
                            'stamps', v_rec.stamps, 'required', v_required,
                            'reward_available', (v_rec.stamps >= v_required), 'rewards_redeemed', v_rec.rewards_redeemed);
end;
$$;

create or replace function public.admin_adjust_loyalty(p_customer_id uuid, p_delta int, p_note text DEFAULT NULL)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_required int := coalesce(nullif(public.get_setting('loyalty_required','10'),'')::int, 10);
  v_stamps int;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'sem permissao'); end if;
  if p_customer_id is null or coalesce(p_delta,0) = 0 then return jsonb_build_object('ok', false, 'error', 'parametros invalidos'); end if;

  insert into public.loyalty_accounts (customer_id) values (p_customer_id) on conflict (customer_id) do nothing;
  select stamps into v_stamps from public.loyalty_accounts where customer_id = p_customer_id for update;

  v_stamps := greatest(0, coalesce(v_stamps,0) + p_delta);
  update public.loyalty_accounts
     set stamps = v_stamps,
         earned_total = greatest(0, earned_total + greatest(p_delta, 0)),
         updated_at = now()
   where customer_id = p_customer_id;
  insert into public.loyalty_events (customer_id, tipo, delta, stamps_after, origem, note)
    values (p_customer_id, 'adjustment', p_delta, v_stamps, 'admin', coalesce(nullif(btrim(p_note),''), 'ajuste manual'));

  return jsonb_build_object('ok', true, 'stamps', v_stamps, 'required', v_required, 'reward_available', (v_stamps >= v_required));
end;
$$;

create or replace function public.set_loyalty_config(p_required int, p_discount int, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'sem permissao'); end if;
  if p_required is null or p_required < 1 or p_required > 100 then return jsonb_build_object('ok', false, 'error', 'required invalido'); end if;
  if p_discount is null or p_discount < 1 or p_discount > 100 then return jsonb_build_object('ok', false, 'error', 'discount invalido'); end if;

  insert into public.settings (chave, valor) values ('loyalty_required', p_required::text)
    on conflict (chave) do update set valor = excluded.valor;
  insert into public.settings (chave, valor) values ('loyalty_discount', p_discount::text)
    on conflict (chave) do update set valor = excluded.valor;
  insert into public.settings (chave, valor) values ('loyalty_enabled', case when p_enabled then 'true' else 'false' end)
    on conflict (chave) do update set valor = excluded.valor;

  return jsonb_build_object('ok', true, 'required', p_required, 'discount', p_discount, 'enabled', p_enabled);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 10) GRANTS (antifraude): cliente NUNCA chama loyalty_grant/trigger; escrita so via RPC controlada.
-- ─────────────────────────────────────────────────────────────────────────
-- interno: so create_order (owner) chama -> ninguem mais
revoke all on function public.loyalty_grant(uuid, uuid)        from public, anon, authenticated;
revoke all on function public.loyalty_void_on_cancel()          from public, anon, authenticated;

-- leitura do cliente (retorna so o proprio / zeros): anon + authenticated
grant execute on function public.get_my_loyalty()               to anon, authenticated;

-- resgate: apenas sessao autenticada (dono ou admin); anon revogado
revoke all on function public.redeem_reward(uuid)               from public, anon;
grant execute on function public.redeem_reward(uuid)            to authenticated;

-- admin: apenas sessao autenticada (is_admin() checa por dentro); anon revogado
revoke all on function public.admin_find_loyalty(text)          from public, anon;
grant execute on function public.admin_find_loyalty(text)       to authenticated;
revoke all on function public.admin_adjust_loyalty(uuid,int,text) from public, anon;
grant execute on function public.admin_adjust_loyalty(uuid,int,text) to authenticated;
revoke all on function public.set_loyalty_config(int,int,boolean)  from public, anon;
grant execute on function public.set_loyalty_config(int,int,boolean) to authenticated;

-- recarrega o schema no PostgREST (novos RPCs ficam visiveis na API imediatamente)
notify pgrst, 'reload schema';
