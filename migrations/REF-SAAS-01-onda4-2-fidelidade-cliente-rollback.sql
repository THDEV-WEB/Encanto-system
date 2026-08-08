-- REF-SAAS-01 · Onda 4.2 — Rollback: restaura get_my_loyalty/redeem_reward/admin_find_loyalty aos
-- corpos e assinaturas originais (sem p_store_id, is_admin() cego).

BEGIN;

DROP FUNCTION IF EXISTS public.admin_find_loyalty(text, uuid);

CREATE OR REPLACE FUNCTION public.admin_find_loyalty(p_query text)
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
$function$;

DROP FUNCTION IF EXISTS public.redeem_reward(uuid, uuid);

CREATE OR REPLACE FUNCTION public.redeem_reward(p_customer_id uuid DEFAULT NULL::uuid)
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
  v_admin    boolean := public.is_admin();
  v_stamps   int;
begin
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
$function$;

DROP FUNCTION IF EXISTS public.get_my_loyalty(uuid);

CREATE OR REPLACE FUNCTION public.get_my_loyalty()
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
    select id into v_cid from public.customers where auth_user_id = v_uid limit 1;
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

COMMIT;
