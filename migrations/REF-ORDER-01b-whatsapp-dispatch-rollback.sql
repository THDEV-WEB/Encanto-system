-- ROLLBACK de REF-ORDER-01b-whatsapp-dispatch.sql. Idempotente. Remove o dispatcher, o agendamento e a
-- coluna auxiliar. NAO remove a fila (notification_outbox) nem os secrets do Vault (removidos a parte).
SELECT cron.unschedule('enc-dispatch-whatsapp') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'enc-dispatch-whatsapp');

BEGIN;
DROP FUNCTION IF EXISTS public.enc_dispatch_notifications();
DROP FUNCTION IF EXISTS public.enc_render_message(text, jsonb);
DROP FUNCTION IF EXISTS public.enc_normalize_phone_br(text);
ALTER TABLE public.notification_outbox DROP COLUMN IF EXISTS net_request_id;
COMMIT;

-- Para limpar as credenciais do Vault (se aplicado):
--   SELECT vault.delete_secret(id) FROM vault.secrets WHERE name IN ('whatsapp_token','whatsapp_phone_number_id','whatsapp_api_version');
