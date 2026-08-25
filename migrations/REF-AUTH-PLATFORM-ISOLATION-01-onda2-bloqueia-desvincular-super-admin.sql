-- REF-AUTH-PLATFORM-ISOLATION-01 · Onda 2 — bloqueia desvincular Super Admin via fluxo de tenant.
-- ADR de referencia: docs/ref/REF-AUTH-PLATFORM-ISOLATION-01-progress.md (Onda 0/1).
--
-- Achado da auditoria (Onda 0): platform_unlink_store_admin(p_store_id, p_user_id) nao distinguia um
-- Super Admin de um admin comum -- qualquer user_id presente em public.admins podia ser desvinculado,
-- inclusive um Super Admin que (como e' o caso real hoje da Encanto) tambem esteja vinculado ali. Isso
-- e' o mesmo tipo de sobreposicao ja corrigido em platform-set-store-admin-password (Onda 1), agora
-- fechado tambem no fluxo de desvincular.
--
-- Correcao: mesma guarda -- se p_user_id estiver em public.super_admins, RAISE EXCEPTION (42501) antes
-- de tocar em public.admins. Admins normais continuam desvinculados exatamente como antes (idempotente,
-- DELETE de 0 linhas nao e' erro).
--
-- Escopo: SOMENTE este DELETE. Nenhuma outra RPC, RLS ou tabela e tocada.

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

  -- REF-AUTH-PLATFORM-ISOLATION-01 (Onda 2): um Super Admin nunca e' alvo valido desta operacao, mesmo
  -- que esteja (tambem) vinculado como admin de alguma loja -- caso real: o proprio Super Admin aparece
  -- hoje em public.admins da Encanto. Vinculo de Super Admin nao e' gerido por este fluxo.
  IF EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'nao e possivel desvincular um Super Admin da plataforma por este fluxo'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.admins WHERE store_id = p_store_id AND user_id = p_user_id;
  GET DIAGNOSTICS v_linhas = ROW_COUNT;

  RETURN jsonb_build_object('desvinculado', v_linhas > 0);
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
