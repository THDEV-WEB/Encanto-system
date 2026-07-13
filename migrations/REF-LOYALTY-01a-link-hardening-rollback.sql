-- ============================================================================
-- REF-LOYALTY-01a — ROLLBACK. Restaura link_customer_to_auth ORIGINAL (LOGIN-ARCH-02.1, sem a guarda)
-- e remove admin_link_customer_to_auth. ATENCAO: reabre o vetor de reivindicacao de convidado.
-- ============================================================================

create or replace function public.link_customer_to_auth(p_phone text, p_email text DEFAULT NULL::text, p_name text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_phone text := public.normalize_phone(p_phone);
  v_email text := lower(nullif(btrim(p_email), ''));
  v_name  text := nullif(btrim(p_name), '');
  v_cid   uuid;
  v_owner uuid;
begin
  if v_uid   is null then return jsonb_build_object('ok', false, 'error', 'nao autenticado'); end if;
  if v_phone is null then return jsonb_build_object('ok', false, 'error', 'telefone invalido'); end if;

  perform pg_advisory_xact_lock(hashtextextended(v_phone, 0));

  select id, auth_user_id into v_cid, v_owner from public.customers where phone = v_phone limit 1;
  if v_cid is not null then
    if v_owner is not null and v_owner <> v_uid then
      return jsonb_build_object('ok', false, 'error', 'telefone ja vinculado a outra conta');
    end if;
    update public.customers
       set auth_user_id = v_uid,
           email = coalesce(v_email, email),
           name  = coalesce(v_name, name)
     where id = v_cid;
    return jsonb_build_object('ok', true, 'customer_id', v_cid,
                              'status', case when v_owner = v_uid then 'ja_vinculado' else 'vinculado' end);
  end if;

  select id into v_cid from public.customers where auth_user_id = v_uid limit 1;
  if v_cid is not null then
    update public.customers set phone = v_phone, email = coalesce(v_email, email), name = coalesce(v_name, name) where id = v_cid;
    return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'atualizado');
  end if;

  insert into public.customers(name, phone, email, auth_user_id)
    values (coalesce(v_name, 'Cliente'), v_phone, v_email, v_uid)
  returning id into v_cid;
  return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'criado');
end; $function$;

drop function if exists public.admin_link_customer_to_auth(uuid, uuid);

notify pgrst, 'reload schema';
