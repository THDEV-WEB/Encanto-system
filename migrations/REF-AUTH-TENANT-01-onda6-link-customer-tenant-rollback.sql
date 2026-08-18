-- Rollback da Onda 6 de REF-AUTH-TENANT-01.
-- Restaura EXATAMENTE a versao de link_customer_to_auth anterior a esta onda (sem verificacao de
-- tenant_id) e os grants de EXECUTE anteriores (PUBLIC + anon + authenticated).

BEGIN;

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

  perform pg_advisory_xact_lock(hashtextextended(v_phone || ':' || v_store::text, 0));

  select id, auth_user_id into v_cid, v_owner from public.customers where phone = v_phone and store_id = v_store limit 1;
  if v_cid is not null then
    if v_owner is not null and v_owner <> v_uid then
      return jsonb_build_object('ok', false, 'error', 'telefone ja vinculado a outra conta');
    end if;
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

  select id into v_cid from public.customers where auth_user_id = v_uid and store_id = v_store limit 1;
  if v_cid is not null then
    update public.customers set phone = v_phone, email = coalesce(v_email, email), name = coalesce(v_name, name) where id = v_cid;
    return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'atualizado');
  end if;

  insert into public.customers(name, phone, email, auth_user_id, store_id)
    values (coalesce(v_name, 'Cliente'), v_phone, v_email, v_uid, v_store)
  returning id into v_cid;
  return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'criado');
end; $function$;

GRANT EXECUTE ON FUNCTION public.link_customer_to_auth(text, text, text, uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_customer_to_auth(text, text, text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.link_customer_to_auth(text, text, text, uuid) TO authenticated;

COMMIT;
