-- ============================================================================
-- REF-MESA-02 · Onda 16 (segurança/ataque) — ROLLBACK
-- Restaura o EXECUTE de PUBLIC/anon em admin_reports_summary -- reversibilidade
-- de teste (prova que a migration principal é a única responsável pela
-- mudança de grants), NÃO uma recomendação de reverter em produção.
-- ============================================================================

BEGIN;

GRANT EXECUTE ON FUNCTION public.admin_reports_summary(date, date, uuid) TO PUBLIC;

NOTIFY pgrst, 'reload schema';

COMMIT;
