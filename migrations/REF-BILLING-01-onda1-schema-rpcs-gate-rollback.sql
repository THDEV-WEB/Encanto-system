-- REF-BILLING-01 · Onda 1 — Rollback: restaura is_admin_of ao estado pre-Onda 1, remove as 4 RPCs
-- novas, e apaga store_subscriptions/store_billing_events (tabelas criadas do zero nesta migration
-- -- greenfield, mesmo padrao de REF-MESA-02-onda4-mesas-fisicas-rollback.sql). O seed de
-- isencao/Encanto/Aquarios Bar vive dentro dessas tabelas, entao some junto -- nao ha dado de
-- negocio pre-existente sendo perdido (a Onda 1 e a UNICA origem desses dados).

BEGIN;

-- 1. is_admin_of volta a definicao EXATA de antes da Onda 1 (sem checagem de bloqueio).
CREATE OR REPLACE FUNCTION public.is_admin_of(p_store_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT public.is_super_admin()
      OR EXISTS (SELECT 1 FROM public.admins a WHERE a.store_id = p_store_id AND a.user_id = auth.uid());
$function$;

-- 2. RPCs novas.
DROP FUNCTION IF EXISTS public.platform_configurar_contato_financeiro(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.platform_configurar_dia_vencimento(uuid, smallint);
DROP FUNCTION IF EXISTS public.platform_marcar_mensalidade_paga(uuid, date);
DROP FUNCTION IF EXISTS public.get_billing_status(uuid);

-- 3. Tabelas novas (greenfield desta migration -- DROP TABLE remove indice/policy/RLS junto).
DROP TABLE IF EXISTS public.store_billing_events;
DROP TABLE IF EXISTS public.store_subscriptions;

COMMIT;

NOTIFY pgrst, 'reload schema';
