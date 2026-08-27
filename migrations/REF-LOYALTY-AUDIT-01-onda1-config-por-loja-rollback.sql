-- ============================================================================
-- REF-LOYALTY-AUDIT-01 · Onda 1 — ROLLBACK
-- Restaura a configuração de fidelidade GLOBAL (settings), recria as 7 RPCs na
-- forma anterior (fonte = get_setting()/settings), restaura a assinatura antiga
-- de set_loyalty_config (3 args) e remove get_loyalty_config. Preserva
-- loyalty_accounts/loyalty_events/idempotência/reversão intocados (nunca tocados
-- pela migration original).
-- ============================================================================

BEGIN;

-- 1) Restaura settings GLOBAL a partir do valor da Encanto em store_settings
--    (a Encanto era a única loja com configuração de fidelidade real).
INSERT INTO public.settings (chave, valor)
SELECT chave, valor FROM public.store_settings
WHERE store_id = (SELECT id FROM public.stores WHERE slug = 'encanto')
  AND chave IN ('loyalty_required', 'loyalty_discount', 'loyalty_enabled')
ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor;

-- 2) loyalty_grant — volta a ler de settings (global), via get_setting().
CREATE OR REPLACE FUNCTION public.loyalty_grant(p_customer_id uuid, p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_required int     := coalesce(nullif(public.get_setting('loyalty_required','10'),'')::int, 10);
  v_enabled  boolean := lower(coalesce(public.get_setting('loyalty_enabled','true'),'true')) <> 'false';
  v_stamps   int;
  v_store    uuid;
begin
  if not v_enabled or p_customer_id is null or p_order_id is null then return; end if;
  if exists (select 1 from public.loyalty_events where order_id = p_order_id and tipo = 'earned') then return; end if;

  select store_id into v_store from public.customers where id = p_customer_id;
  if v_store is null then return; end if;

  insert into public.loyalty_accounts (customer_id, store_id) values (p_customer_id, v_store)
    on conflict (customer_id) do nothing;
  select stamps into v_stamps from public.loyalty_accounts where customer_id = p_customer_id for update;

  if coalesce(v_stamps, 0) >= v_required then return; end if;

  update public.loyalty_accounts
     set stamps = stamps + 1, earned_total = earned_total + 1, updated_at = now()
   where customer_id = p_customer_id
   returning stamps into v_stamps;

  insert into public.loyalty_events (customer_id, order_id, tipo, delta, stamps_after, origem, note, store_id)
    values (p_customer_id, p_order_id, 'earned', 1, v_stamps, 'create_order', 'pedido valido', v_store);
end;
$function$;

-- 3) loyalty_void_on_cancel — volta a ler required global.
CREATE OR REPLACE FUNCTION public.loyalty_void_on_cancel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_stamps   int;
  v_required int := coalesce(nullif(public.get_setting('loyalty_required','10'),'')::int, 10);
  v_contrib  int;
  v_earned   boolean;
begin
  if new.status = 'cancelado' and coalesce(old.status,'') <> 'cancelado' then
    begin
      select coalesce(sum(delta),0) into v_contrib from public.loyalty_events
        where order_id = new.id and origem in ('create_order','cancel_trigger');
      if v_contrib > 0 then
        update public.loyalty_accounts
           set stamps = greatest(0, stamps - v_contrib), earned_total = greatest(0, earned_total - v_contrib), updated_at = now()
         where customer_id = new.customer_id
         returning stamps into v_stamps;
        insert into public.loyalty_events (customer_id, order_id, tipo, delta, stamps_after, origem, note, store_id)
          values (new.customer_id, new.id, 'revoked', -v_contrib, v_stamps, 'cancel_trigger', 'pedido cancelado', new.store_id);
      end if;
    exception when others then
      null;
    end;
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
          insert into public.loyalty_events (customer_id, order_id, tipo, delta, stamps_after, origem, note, store_id)
            values (new.customer_id, new.id, 'adjustment', 1, v_stamps, 'cancel_trigger', 'pedido reativado', new.store_id);
        end if;
      end if;
    exception when others then
      null;
    end;
  end if;
  return new;
end;
$function$;

-- 4) get_my_loyalty — volta a ler global.
CREATE OR REPLACE FUNCTION public.get_my_loyalty(p_store_id uuid DEFAULT public.default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    select id into v_cid from public.customers where auth_user_id = v_uid and store_id = p_store_id limit 1;
    if v_cid is not null then
      select stamps, rewards_redeemed into v_stamps, v_rr from public.loyalty_accounts where customer_id = v_cid;
      v_stamps := coalesce(v_stamps, 0); v_rr := coalesce(v_rr, 0);
    end if;
  end if;
  return jsonb_build_object('enabled', v_enabled, 'stamps', v_stamps, 'required', v_required,
                            'discount', v_discount, 'reward_available', (v_enabled and v_stamps >= v_required),
                            'rewards_redeemed', v_rr, 'has_account', (v_cid is not null));
end;
$function$;

-- 5) redeem_reward — volta a ler global.
CREATE OR REPLACE FUNCTION public.redeem_reward(p_customer_id uuid DEFAULT NULL::uuid, p_store_id uuid DEFAULT public.default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_uid      uuid := auth.uid();
  v_cid      uuid := p_customer_id;
  v_required int  := coalesce(nullif(public.get_setting('loyalty_required','10'),'')::int, 10);
  v_discount int  := coalesce(nullif(public.get_setting('loyalty_discount','50'),'')::int, 50);
  v_enabled  boolean := lower(coalesce(public.get_setting('loyalty_enabled','true'),'true')) <> 'false';
  v_store    uuid;
  v_admin    boolean := false;
  v_stamps   int;
begin
  if v_cid is not null then
    select store_id into v_store from public.customers where id = v_cid;
    if v_store is not null then v_admin := public.is_admin_of(v_store); end if;
  end if;

  if v_admin then
    null;
  else
    if not v_enabled then return jsonb_build_object('ok', false, 'error', 'programa desativado'); end if;
    if v_uid is null then return jsonb_build_object('ok', false, 'error', 'nao autenticado'); end if;
    select id, store_id into v_cid, v_store from public.customers where auth_user_id = v_uid and store_id = p_store_id limit 1;
    if v_cid is null then return jsonb_build_object('ok', false, 'error', 'cliente sem cadastro'); end if;
    if p_customer_id is not null and p_customer_id <> v_cid then
      return jsonb_build_object('ok', false, 'error', 'sem permissao');
    end if;
  end if;

  select stamps into v_stamps from public.loyalty_accounts where customer_id = v_cid for update;
  if v_stamps is null or v_stamps < v_required then
    return jsonb_build_object('ok', false, 'error', 'recompensa indisponivel',
                              'stamps', coalesce(v_stamps,0), 'required', v_required);
  end if;

  update public.loyalty_accounts
     set stamps = stamps - v_required, rewards_redeemed = rewards_redeemed + 1, updated_at = now()
   where customer_id = v_cid returning stamps into v_stamps;
  insert into public.loyalty_events (customer_id, tipo, delta, stamps_after, origem, note, store_id)
    values (v_cid, 'redeemed', -v_required, v_stamps, case when v_admin then 'admin' else 'redeem' end,
            'recompensa ' || v_discount || '%', v_store);

  return jsonb_build_object('ok', true, 'stamps', v_stamps, 'required', v_required, 'discount', v_discount,
                            'rewards_redeemed', (select rewards_redeemed from public.loyalty_accounts where customer_id = v_cid));
end;
$function$;

-- 6) admin_find_loyalty — volta a ler global.
CREATE OR REPLACE FUNCTION public.admin_find_loyalty(p_query text, p_store_id uuid DEFAULT public.default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_phone text := public.normalize_phone(p_query);
  v_q     text := btrim(coalesce(p_query, ''));
  v_required int := coalesce(nullif(public.get_setting('loyalty_required','10'),'')::int, 10);
  v_rec   record;
begin
  if not public.is_admin_of(p_store_id) then return jsonb_build_object('ok', false, 'error', 'sem permissao'); end if;
  if v_q = '' then return jsonb_build_object('ok', false, 'error', 'busca vazia'); end if;

  select c.id, c.name, c.phone, coalesce(a.stamps,0) as stamps, coalesce(a.rewards_redeemed,0) as rewards_redeemed
    into v_rec
    from public.customers c
    left join public.loyalty_accounts a on a.customer_id = c.id
   where c.store_id = p_store_id
     and ((v_phone is not null and c.phone = v_phone) or c.name ilike '%'||v_q||'%')
   order by (v_phone is not null and c.phone = v_phone) desc, c.created_at desc
   limit 1;

  if v_rec.id is null then return jsonb_build_object('ok', false, 'error', 'cliente nao encontrado'); end if;
  return jsonb_build_object('ok', true, 'customer_id', v_rec.id, 'name', v_rec.name, 'phone', v_rec.phone,
                            'stamps', v_rec.stamps, 'required', v_required,
                            'reward_available', (v_rec.stamps >= v_required), 'rewards_redeemed', v_rec.rewards_redeemed);
end;
$function$;

-- 7) admin_adjust_loyalty — volta a ler global.
CREATE OR REPLACE FUNCTION public.admin_adjust_loyalty(p_customer_id uuid, p_delta integer, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_required int := coalesce(nullif(public.get_setting('loyalty_required','10'),'')::int, 10);
  v_stamps int;
  v_store uuid;
begin
  if p_customer_id is null or coalesce(p_delta,0) = 0 then return jsonb_build_object('ok', false, 'error', 'parametros invalidos'); end if;
  select store_id into v_store from public.customers where id = p_customer_id;
  if v_store is null then return jsonb_build_object('ok', false, 'error', 'cliente nao encontrado'); end if;
  if not public.is_admin_of(v_store) then return jsonb_build_object('ok', false, 'error', 'sem permissao'); end if;

  insert into public.loyalty_accounts (customer_id, store_id) values (p_customer_id, v_store) on conflict (customer_id) do nothing;
  select stamps into v_stamps from public.loyalty_accounts where customer_id = p_customer_id for update;

  v_stamps := greatest(0, coalesce(v_stamps,0) + p_delta);
  update public.loyalty_accounts
     set stamps = v_stamps,
         earned_total = greatest(0, earned_total + greatest(p_delta, 0)),
         updated_at = now()
   where customer_id = p_customer_id;
  insert into public.loyalty_events (customer_id, tipo, delta, stamps_after, origem, note, store_id)
    values (p_customer_id, 'adjustment', p_delta, v_stamps, 'admin', coalesce(nullif(btrim(p_note),''), 'ajuste manual'), v_store);

  return jsonb_build_object('ok', true, 'stamps', v_stamps, 'required', v_required, 'reward_available', (v_stamps >= v_required));
end;
$function$;

-- 8) set_loyalty_config — volta a ter 3 args, is_admin() cego, grava em settings.
DROP FUNCTION IF EXISTS public.set_loyalty_config(integer, integer, boolean, uuid);

CREATE OR REPLACE FUNCTION public.set_loyalty_config(p_required int, p_discount int, p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.set_loyalty_config(int,int,boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_loyalty_config(int,int,boolean) TO authenticated;

-- 9) Remove get_loyalty_config (não existia antes desta REF).
DROP FUNCTION IF EXISTS public.get_loyalty_config(uuid);

-- 10) Remove as linhas por-loja criadas por esta migration (deixa store_settings como
--     estava antes -- só as 3 chaves de fidelidade, preservando as outras 4 já
--     existentes desde a Onda 4.3 intocadas).
DELETE FROM public.store_settings WHERE chave IN ('loyalty_required', 'loyalty_discount', 'loyalty_enabled');

NOTIFY pgrst, 'reload schema';

COMMIT;
