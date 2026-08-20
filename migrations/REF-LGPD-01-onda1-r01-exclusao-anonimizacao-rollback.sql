-- Rollback de REF-LGPD-01-onda1-r01-exclusao-anonimizacao.sql — remove as 3 funcoes. NAO desfaz
-- anonimizacoes ja executadas (irreversivel por natureza -- os dados originais nao sao guardados em
-- lugar nenhum, exatamente o ponto da funcao).

BEGIN;

DROP FUNCTION IF EXISTS public.admin_lgpd_delete_customer_data(uuid, uuid);
DROP FUNCTION IF EXISTS public.lgpd_delete_my_data(text);
DROP FUNCTION IF EXISTS public.lgpd_anonymize_customer(uuid);

COMMIT;
