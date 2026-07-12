-- LOGIN-ARCH-02 — migra o VINCULO de cliente de telefone -> E-MAIL (Google OAuth / e-mail OTP).
-- ATOMICO. Idempotente. Aditivo. NAO toca create_order/checkout/orders/RLS de escrita.
-- customers.phone passa a ser NULLABLE (cliente logado por email pode ainda nao ter telefone; o
-- guest checkout continua enviando telefone normalmente via create_order). Rollback: -rollback.sql
BEGIN;

-- (1) coluna email (nullable) + unicidade case-insensitive (parcial: ignora NULL dos guests)
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS email text;
CREATE UNIQUE INDEX IF NOT EXISTS customers_email_key ON public.customers (lower(email)) WHERE email IS NOT NULL;

-- (2) phone deixa de ser obrigatorio (cliente por email pode nao ter telefone ainda)
ALTER TABLE public.customers ALTER COLUMN phone DROP NOT NULL;

-- (3) vinculo idempotente por EMAIL (SECURITY DEFINER; usa auth.uid()). Nunca duplica.
CREATE OR REPLACE FUNCTION public.link_customer_to_auth_email(p_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
declare
  v_uid   uuid := auth.uid();
  v_email text := lower(nullif(btrim(p_email), ''));
  v_cid   uuid;
begin
  if v_uid   is null then return jsonb_build_object('ok', false, 'error', 'nao autenticado'); end if;
  if v_email is null then return jsonb_build_object('ok', false, 'error', 'email invalido'); end if;

  -- (a) ja vinculado a ESTE usuario? idempotente.
  select id into v_cid from public.customers where auth_user_id = v_uid limit 1;
  if v_cid is not null then return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'ja_vinculado'); end if;

  -- (b) customer existente por email (sem dono) -> VINCULA (nao duplica).
  select id into v_cid from public.customers where lower(email) = v_email and auth_user_id is null limit 1;
  if v_cid is not null then
    update public.customers set auth_user_id = v_uid where id = v_cid;
    return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'vinculado');
  end if;

  -- (c) nao existe -> cria vinculado (phone null; nome placeholder; proximo checkout completa via create_order).
  insert into public.customers(name, email, auth_user_id) values ('Cliente', v_email, v_uid)
  returning id into v_cid;
  return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'criado');
end; $$;
REVOKE ALL ON FUNCTION public.link_customer_to_auth_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_customer_to_auth_email(text) TO authenticated;

COMMIT;
