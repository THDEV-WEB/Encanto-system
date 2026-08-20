-- REF-LGPD-01 · Onda 1 · LGPD-R10 — link_store_admin nao inclui mais o e-mail digitado no texto da
-- excecao SQL. Achado da auditoria REF-LGPD-01: se a validacao de formato falhar, RAISE EXCEPTION
-- 'email invalido: %', p_admin_email colocava o e-mail literal em err.message; DataService.run() ->
-- capturarErroDados() -> Sentry.captureException(err) usa exatamente err.message como texto do Issue,
-- entao esse e-mail (de um admin/staff, nao de cliente final) podia acabar no painel do Sentry. E' PII
-- de staff administrativo, so no fluxo de onboarding de lojas (Platform Console / Super Admin) -- nao
-- e' o mesmo caminho ja fechado pelo REF-SEC-DATA-01 R17 (aquele era breadcrumb de console.*; este e'
-- o proprio evento de excecao, que R17 nao cobre).
--
-- Unica mudanca: a mensagem de erro perde o "%"/p_admin_email. Toda a logica de negocio (RETURN jsonb
-- com 'email', v_email nos caminhos de retorno normal -- esses SEMPRE foram seguros, so voltam pro
-- proprio super admin que chamou, nunca viram excecao) permanece IDENTICA.
--
-- Companion: REF-LGPD-01-onda1-r10-sanitiza-excecao-email-rollback.sql

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
    -- LGPD-R10: mensagem generica, sem o e-mail digitado (evita que ele vaze pra Sentry via
    -- captureException). O chamador (Admin) ja sabe o que digitou; nao precisa de eco na excecao.
    RAISE EXCEPTION 'email invalido' USING ERRCODE = '22023';
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

-- Grants inalterados (mesmos da REF-SAAS-01-onda8-provisionamento.sql) -- CREATE OR REPLACE preserva
-- privilegios existentes automaticamente, mas reafirmamos explicitamente por clareza/auditabilidade.
REVOKE ALL ON FUNCTION public.link_store_admin(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_store_admin(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.link_store_admin(uuid, text) TO authenticated;

COMMIT;

-- Verificacao pos-aplicacao (rodar manualmente):
-- SELECT prosrc FROM pg_proc WHERE proname = 'link_store_admin';
--   -- NAO deve conter "email invalido: %" nem p_admin_email dentro de um RAISE EXCEPTION
-- SELECT link_store_admin('00000000-0000-0000-0000-000000000000'::uuid, 'nao-e-um-email');
--   -- deve falhar com "email invalido" (SEM o texto "nao-e-um-email" na mensagem), executado como
--   -- super admin real (senao falha antes, em "apenas o super admin...")
