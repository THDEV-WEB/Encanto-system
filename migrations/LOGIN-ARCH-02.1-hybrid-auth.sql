-- LOGIN-ARCH-02.1 — modelo HIBRIDO: TELEFONE = identidade principal do cliente; e-mail/Google = so
-- credencial. Substitui a RPC single-arg (AUTH-01) e a de e-mail (LOGIN-ARCH-02, superseded) por UMA
-- RPC hibrida. ATOMICO. Idempotente. NAO toca create_order/checkout/orders/RLS de escrita.
-- customers.phone continua NOT NULL (a identidade e sempre coletada no 1o acesso). customers.email vira
-- atributo complementar (nullable). Rollback: -rollback.sql
BEGIN;

-- (1) email como ATRIBUTO complementar (nullable) + unicidade case-insensitive (parcial).
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS email text;
CREATE UNIQUE INDEX IF NOT EXISTS customers_email_key ON public.customers (lower(email)) WHERE email IS NOT NULL;

-- (2) remove RPCs anteriores (consolidacao — sem redundancia).
DROP FUNCTION IF EXISTS public.link_customer_to_auth(text);
DROP FUNCTION IF EXISTS public.link_customer_to_auth_email(text);

-- (3) RPC HIBRIDA: vincula por TELEFONE (identidade); email/nome sao atributos. Idempotente, race-safe.
CREATE OR REPLACE FUNCTION public.link_customer_to_auth(p_phone text, p_email text DEFAULT NULL, p_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
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

  -- lock por telefone: serializa concorrentes com o mesmo telefone (race-safe, sem duplicar).
  perform pg_advisory_xact_lock(hashtextextended(v_phone, 0));

  -- (a) existe customer com este TELEFONE?
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

  -- (b) este usuario ja tem customer (com outro telefone)? atualiza telefone/email/nome.
  select id into v_cid from public.customers where auth_user_id = v_uid limit 1;
  if v_cid is not null then
    update public.customers set phone = v_phone, email = coalesce(v_email, email), name = coalesce(v_name, name) where id = v_cid;
    return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'atualizado');
  end if;

  -- (c) cria novo (telefone identidade + email/nome).
  insert into public.customers(name, phone, email, auth_user_id)
    values (coalesce(v_name, 'Cliente'), v_phone, v_email, v_uid)
  returning id into v_cid;
  return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'criado');
end; $$;
REVOKE ALL ON FUNCTION public.link_customer_to_auth(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_customer_to_auth(text, text, text) TO authenticated;

COMMIT;
