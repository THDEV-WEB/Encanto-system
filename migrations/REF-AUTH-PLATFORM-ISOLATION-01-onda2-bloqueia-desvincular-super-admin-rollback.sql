-- Rollback de REF-AUTH-PLATFORM-ISOLATION-01-onda2-bloqueia-desvincular-super-admin.sql
-- Restaura platform_unlink_store_admin ao estado anterior (REF-SAAS-02 · Onda 1), sem a guarda de
-- super_admins.

BEGIN;

CREATE OR REPLACE FUNCTION public.platform_unlink_store_admin(p_store_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_linhas int;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'apenas o super admin da plataforma pode desvincular um administrador'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.admins WHERE store_id = p_store_id AND user_id = p_user_id;
  GET DIAGNOSTICS v_linhas = ROW_COUNT;

  RETURN jsonb_build_object('desvinculado', v_linhas > 0);
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
