-- Rollback de REF-LGPD-01-onda2-r03-exportar-meus-dados.sql — remove a funcao de export. Read-only,
-- sem efeito colateral algum ao remover (nenhum dado gravado por ela).

BEGIN;

DROP FUNCTION IF EXISTS public.lgpd_export_my_data();

COMMIT;
