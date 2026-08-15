-- Rollback: REF-SAAS-02 · Onda 3 (parte 2) — list_my_stores() volta a nao expor `dominio`.

BEGIN;

DROP FUNCTION public.list_my_stores();

CREATE FUNCTION public.list_my_stores()
 RETURNS TABLE(store_id uuid, slug text, nome text, status text, is_super_admin boolean, admin_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT s.id, s.slug, s.nome, s.status, public.is_super_admin(),
         (SELECT count(*)::int FROM public.admins a2 WHERE a2.store_id = s.id)
  FROM public.stores s
  WHERE public.is_super_admin()
     OR EXISTS (SELECT 1 FROM public.admins a WHERE a.store_id = s.id AND a.user_id = auth.uid())
  ORDER BY s.nome;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
