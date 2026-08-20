-- Rollback de REF-LGPD-01-onda1-r05-agenda-purge-old-logs.sql — como a migration so' versionou (nao
-- alterou) um job que ja existia antes dela, o rollback e' um NO-OP intencional: desagendar aqui
-- desligaria uma purga que ja estava em producao ANTES desta REF (nao foi esta REF que a criou).
-- Se algum dia for necessario desativar o job de verdade, faca isso deliberadamente fora deste rollback:
--   SELECT cron.unschedule('encanto-purge-logs');

BEGIN;
-- (intencionalmente vazio — ver comentario acima)
COMMIT;
