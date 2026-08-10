-- Rollback REF-DASHBOARD-01 — remove a RPC nova (funcao criada por esta migration, nao existia antes).
BEGIN;
DROP FUNCTION IF EXISTS public.admin_reports_summary(date, date, uuid);
COMMIT;
NOTIFY pgrst, 'reload schema';
