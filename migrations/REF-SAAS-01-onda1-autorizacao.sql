-- REF-SAAS-01 · Onda 1 — Gateway de autorizacao multi-tenant
-- ADR de referencia: docs/adr/REF-SAAS-01-fundacao-multitenant.md (§1.3 Super Admin, §1.4 Admin da
-- Loja, §4 Modelo de autorizacao).
--
-- Escopo desta migration:
--   1. `public.super_admins` (global, da VALION) — papel novo, sem store_id por definicao.
--   2. `public.admins` ganha `store_id` (nullable -> backfill "encanto" -> NOT NULL), e o UNIQUE
--      antigo (user_id) e substituido por UNIQUE(store_id, user_id) — permite 1 user_id aparecer
--      em varias lojas, sem precisar de tabela de vinculo separada (decisao do ADR §1.4).
--   3. `is_super_admin()` — boolean global.
--   4. `is_admin_of(p_store_id)` — super admin passa em qualquer loja; admin normal so na sua.
--   5. `is_admin()` — deixa de consultar `admins` direto e passa a DELEGAR para
--      `is_admin_of(<id da loja "encanto">)`. Mesma assinatura, mesmo nome, MESMO COMPORTAMENTO
--      para o admin unico de hoje — todas as ~30 RPCs que chamam `is_admin()` continuam
--      funcionando sem qualquer alteracao (retrocompatibilidade, ADR §4).
--
-- Fora de escopo (onda futura): nenhuma RLS/RPC de `products/orders/customers/...` e tocada aqui
-- alem de `admins`/`stores` — isso e a Onda 2/4. Nenhum admin novo e cadastrado nesta onda.

BEGIN;

CREATE TABLE public.super_admins (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.super_admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admins self read" ON public.super_admins
  FOR SELECT TO authenticated USING (user_id = auth.uid());

ALTER TABLE public.admins ADD COLUMN store_id uuid REFERENCES public.stores(id);

UPDATE public.admins
   SET store_id = (SELECT id FROM public.stores WHERE slug = 'encanto')
 WHERE store_id IS NULL;

ALTER TABLE public.admins ALTER COLUMN store_id SET NOT NULL;

ALTER TABLE public.admins DROP CONSTRAINT admins_user_id_key;
ALTER TABLE public.admins ADD CONSTRAINT admins_store_user_key UNIQUE (store_id, user_id);

CREATE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid());
$$;

CREATE FUNCTION public.is_admin_of(p_store_id uuid)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT public.is_super_admin()
      OR EXISTS (SELECT 1 FROM public.admins a WHERE a.store_id = p_store_id AND a.user_id = auth.uid());
$$;

-- Wrapper de compatibilidade — mesma assinatura/nome de sempre, corpo passa a delegar.
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT public.is_admin_of((SELECT id FROM public.stores WHERE slug = 'encanto'));
$$;

COMMIT;
