-- REF-LGPD-01 · Onda 1 · LGPD-R04 — notification_outbox (nome + telefone + mensagem renderizada de
-- WhatsApp, ver migrations/REF-ORDER-01-order-ops.sql) nunca teve funcao de purga -- PII de notificacao
-- se acumulava indefinidamente. Esta migration cria a infraestrutura tecnica de retencao; o NUMERO DE
-- DIAS e' um valor PROVISORIO conservador, parametrizado via public.settings (mesmo mecanismo ja usado
-- por loyalty_required/loyalty_discount), pensado pra ser ajustado sem nova migration assim que o prazo
-- real for confirmado (LGPD-R07, necessita validacao juridica/contabil -- nao inventamos esse prazo).
--
-- Escopo da purga: SO estados terminais (sent/failed/skipped) -- nunca pending/sending (o dispatcher ja
-- reclama sending travado ha mais de 15min de volta pra pending, REF-ORDER-01-order-ops.sql:98-99;
-- nunca queremos apagar uma notificacao ainda em transito ou nao processada).
--
-- SECURITY DEFINER, mesmo padrao de purge_old_logs (dono postgres via pg_cron; EXECUTE revogado de
-- anon/authenticated -- mesma licao do achado R1 da REF-SEC-DATA-01, nunca deixar uma funcao de purga
-- cron-only chamavel por qualquer usuario comum).
--
-- Companion: REF-LGPD-01-onda1-r04-purge-notification-outbox-rollback.sql

BEGIN;

-- Semente idempotente do valor provisorio (mesmo padrao de REF-DELIVERY-01-delivery-eta-rpc.sql:11-13).
-- Nao sobrescreve se alguem ja tiver ajustado manualmente.
INSERT INTO public.settings (chave, valor)
VALUES ('lgpd_notification_retention_days', '180')
ON CONFLICT (chave) DO NOTHING;

CREATE OR REPLACE FUNCTION public.lgpd_purge_notification_outbox(p_days integer DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_days   integer := coalesce(p_days, nullif(public.get_setting('lgpd_notification_retention_days', '180'), '')::int, 180);
  v_count  integer;
BEGIN
  DELETE FROM public.notification_outbox
   WHERE state IN ('sent', 'failed', 'skipped')
     AND created_at < now() - (v_days || ' days')::interval;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.lgpd_purge_notification_outbox(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lgpd_purge_notification_outbox(integer) FROM anon, authenticated;

COMMENT ON FUNCTION public.lgpd_purge_notification_outbox(integer) IS
  'REF-LGPD-01 LGPD-R04: purga notificacoes WhatsApp (PII: nome+telefone+mensagem) em estado terminal '
  'mais antigas que p_days (default: setting lgpd_notification_retention_days, valor de fabrica 180 -- '
  'PROVISORIO ate confirmacao juridica/contabil do prazo real, ver LGPD-R07). Cron-only.';

-- Agendamento -- mesmo padrao de REF-ORDER-01b-whatsapp-dispatch.sql (unschedule-if-exists + schedule).
-- Diario as 04:10 (fora do horario de pico do delivery) -- nao concorre com o dispatcher (a cada 30s).
SELECT cron.unschedule('lgpd-purge-notification-outbox')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lgpd-purge-notification-outbox');
SELECT cron.schedule('lgpd-purge-notification-outbox', '10 4 * * *',
  $$SELECT public.lgpd_purge_notification_outbox();$$);

COMMIT;

-- Verificacao pos-aplicacao (rodar manualmente):
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'lgpd-purge-notification-outbox';
-- SELECT public.get_setting('lgpd_notification_retention_days', '180');
--   -- ajustar o prazo (apos validacao juridica/contabil, LGPD-R07) com:
--   -- UPDATE public.settings SET valor = '90' WHERE chave = 'lgpd_notification_retention_days';
-- SELECT routine_name, grantee, privilege_type FROM information_schema.routine_privileges
--   WHERE routine_schema = 'public' AND routine_name = 'lgpd_purge_notification_outbox';
--   -- anon/authenticated/PUBLIC NAO devem aparecer
