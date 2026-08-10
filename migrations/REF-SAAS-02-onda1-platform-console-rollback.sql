-- Rollback de REF-SAAS-02-onda1-platform-console.sql

BEGIN;

DROP FUNCTION IF EXISTS public.platform_unlink_store_admin(uuid, uuid);
DROP FUNCTION IF EXISTS public.platform_set_store_status(uuid, text);
DROP FUNCTION IF EXISTS public.platform_tenant_detail(uuid);
DROP FUNCTION IF EXISTS public.platform_list_tenants();

-- Restaura get_store_by_domain para a versao da Onda 6.1 (so' match exato de dominio + default).
CREATE OR REPLACE FUNCTION public.get_store_by_domain(p_hostname text)
 RETURNS TABLE(store_id uuid, slug text, nome text, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT s.id, s.slug, s.nome, s.status
  FROM public.stores s
  WHERE s.id = COALESCE(
    (SELECT id FROM public.stores WHERE dominio = p_hostname),
    public.default_store_id()
  );
$function$;

GRANT EXECUTE ON FUNCTION public.get_store_by_domain(text) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
