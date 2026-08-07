-- REF-SAAS-01 · Onda 1 — Rollback: restaura is_admin() original, remove is_admin_of/is_super_admin,
-- reverte admins ao formato pre-Onda-1 (sem store_id, UNIQUE(user_id)), remove super_admins.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid());
$$;

DROP FUNCTION IF EXISTS public.is_admin_of(uuid);
DROP FUNCTION IF EXISTS public.is_super_admin();

ALTER TABLE public.admins DROP CONSTRAINT IF EXISTS admins_store_user_key;
ALTER TABLE public.admins ADD CONSTRAINT admins_user_id_key UNIQUE (user_id);
ALTER TABLE public.admins ALTER COLUMN store_id DROP NOT NULL;
ALTER TABLE public.admins DROP COLUMN IF EXISTS store_id;

DROP TABLE IF EXISTS public.super_admins;

COMMIT;
