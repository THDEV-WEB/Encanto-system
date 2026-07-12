-- Rollback do LOGIN-ARCH-02.1 (RPC hibrida). ATOMICO.
-- Remove a RPC hibrida e restaura a RPC single-arg por telefone (estado AUTH-01). A coluna email e o
-- indice sao preservados por padrao (evita perda de dados). Descomente para remove-los.
BEGIN;

DROP FUNCTION IF EXISTS public.link_customer_to_auth(text, text, text);

-- restaura a versao AUTH-01 (vinculo simples por telefone)
CREATE OR REPLACE FUNCTION public.link_customer_to_auth(p_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
declare v_uid uuid := auth.uid(); v_phone text := public.normalize_phone(p_phone); v_cid uuid;
begin
  if v_uid   is null then return jsonb_build_object('ok', false, 'error', 'nao autenticado'); end if;
  if v_phone is null then return jsonb_build_object('ok', false, 'error', 'telefone invalido'); end if;
  select id into v_cid from public.customers where auth_user_id = v_uid limit 1;
  if v_cid is not null then return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'ja_vinculado'); end if;
  select id into v_cid from public.customers where phone = v_phone and auth_user_id is null limit 1;
  if v_cid is not null then
    update public.customers set auth_user_id = v_uid where id = v_cid;
    return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'vinculado');
  end if;
  insert into public.customers(name, phone, auth_user_id) values ('Cliente', v_phone, v_uid) returning id into v_cid;
  return jsonb_build_object('ok', true, 'customer_id', v_cid, 'status', 'criado');
end; $$;
REVOKE ALL ON FUNCTION public.link_customer_to_auth(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_customer_to_auth(text) TO authenticated;

-- DROP INDEX IF EXISTS public.customers_email_key;
-- ALTER TABLE public.customers DROP COLUMN IF EXISTS email;

COMMIT;
