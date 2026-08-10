-- REF-SAAS-01 · Onda 8.2 — Rollback: list_my_stores() volta a NAO ter admin_count.

BEGIN;

DROP FUNCTION IF EXISTS public.list_my_stores();

CREATE OR REPLACE FUNCTION public.list_my_stores()
 RETURNS TABLE(store_id uuid, slug text, nome text, status text, is_super_admin boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT s.id, s.slug, s.nome, s.status, public.is_super_admin()
  FROM public.stores s
  WHERE public.is_super_admin()
     OR EXISTS (SELECT 1 FROM public.admins a WHERE a.store_id = s.id AND a.user_id = auth.uid())
  ORDER BY s.nome;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
