-- Rollback de REF-LGPD-01-onda1-r04-purge-notification-outbox.sql — remove o agendamento e a funcao de
-- purga. NAO remove a linha de public.settings (chave 'lgpd_notification_retention_days') -- e' so um
-- valor de configuracao inerte sem a funcao/agendamento, inofensivo manter.

BEGIN;

SELECT cron.unschedule('lgpd-purge-notification-outbox')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lgpd-purge-notification-outbox');

DROP FUNCTION IF EXISTS public.lgpd_purge_notification_outbox(integer);

COMMIT;
