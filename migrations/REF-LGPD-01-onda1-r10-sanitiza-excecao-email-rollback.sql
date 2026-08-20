-- Rollback de REF-LGPD-01-onda1-r10-sanitiza-excecao-email.sql — restaura o texto original da excecao
-- (com o e-mail digitado interpolado), exatamente como definido em REF-SAAS-01-onda8-provisionamento.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.link_store_admin(p_store_id uuid, p_admin_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_email   text;
  v_user_id uuid;
  v_ja      boolean;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'apenas o super admin da plataforma pode vincular administradores de loja'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store_id) THEN
    RAISE EXCEPTION 'loja nao encontrada: %', p_store_id USING ERRCODE = '22023';
  END IF;

  v_email := lower(trim(both from coalesce(p_admin_email, '')));
  IF v_email !~ '^.+@.+\..+$' THEN
    RAISE EXCEPTION 'email invalido: %', p_admin_email USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = v_email LIMIT 1;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'vinculado', false, 'email', v_email,
      'motivo', 'nao existe nenhuma conta com este e-mail ainda -- crie o usuario em Authentication > Users no Supabase e vincule novamente'
    );
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.admins WHERE store_id = p_store_id AND user_id = v_user_id
  ) INTO v_ja;
  IF v_ja THEN
    RETURN jsonb_build_object('vinculado', false, 'email', v_email, 'motivo', 'este usuario ja e administrador desta loja');
  END IF;

  INSERT INTO public.admins (store_id, user_id) VALUES (p_store_id, v_user_id);

  RETURN jsonb_build_object('vinculado', true, 'email', v_email, 'user_id', v_user_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.link_store_admin(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_store_admin(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.link_store_admin(uuid, text) TO authenticated;

COMMIT;
