-- REF-ORDER-01c — ENDURECIMENTO dos grants das RPCs de notificacao (WhatsApp outbox).
--
-- BUG (auditoria REF-AUDIT-01): as funcoes SECURITY DEFINER criadas em REF-ORDER-01 / REF-ORDER-01b
-- ficaram com o EXECUTE default do Postgres (concedido a PUBLIC), ao contrario de TODAS as demais
-- funcoes do projeto (ex.: set_store_mode / set_delivery_eta revogam anon explicitamente). Consequencias:
--   * enc_claim_notifications() e SECURITY DEFINER e RETURNS SETOF notification_outbox -> devolve linhas
--     INTEIRAS da fila (to_phone, vars->>'cliente' = nome, message). Exposta via POST /rest/v1/rpc, um
--     visitante anon podia LER PII de clientes e ainda mudar o estado pending->sending (corromper a fila).
--   * enc_enqueue_notification(...) e SECURITY DEFINER e faz INSERT na fila -> anon podia enfileirar
--     mensagens arbitrarias (escolhendo o template pelo status).
--   * enc_dispatch_notifications() e SECURITY DEFINER, le vault.decrypted_secrets e dispara net.http_post
--     para a Meta -> anon podia forcar o drain da fila.
--
-- FIX: revogar EXECUTE de PUBLIC/anon/authenticated nas tres e conceder apenas a service_role (o unico
-- consumidor externo legitimo e a Edge Function whatsapp-notify, que usa a service key; o dispatcher
-- pg_cron roda como OWNER e ignora grants). O trigger trg_enc_order_notify chama enc_enqueue_notification
-- por dentro como OWNER, entao ele NAO precisa de grant a roles de cliente.
--
-- IDEMPOTENTE (REVOKE/GRANT sao repetiveis). Rollback em arquivo separado. Nao altera corpo de funcao.

BEGIN;

-- enc_claim_notifications(int) — claim atomico; RETORNA PII. So a Edge Function (service_role) precisa.
REVOKE ALL      ON FUNCTION public.enc_claim_notifications(int)                    FROM PUBLIC;
REVOKE EXECUTE  ON FUNCTION public.enc_claim_notifications(int)                    FROM anon, authenticated;
GRANT  EXECUTE  ON FUNCTION public.enc_claim_notifications(int)                    TO   service_role;

-- enc_enqueue_notification(uuid,uuid,text,text) — write-path; so o trigger (owner) chama. Ninguem externo.
REVOKE ALL      ON FUNCTION public.enc_enqueue_notification(uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE  ON FUNCTION public.enc_enqueue_notification(uuid, uuid, text, text) FROM anon, authenticated;

-- enc_dispatch_notifications() — drain + Vault + http_post. cron (owner) ja bypassa; service_role p/ manual.
REVOKE ALL      ON FUNCTION public.enc_dispatch_notifications()                     FROM PUBLIC;
REVOKE EXECUTE  ON FUNCTION public.enc_dispatch_notifications()                     FROM anon, authenticated;
GRANT  EXECUTE  ON FUNCTION public.enc_dispatch_notifications()                     TO   service_role;

COMMIT;

-- Recarrega o schema do PostgREST para a mudanca de grant valer imediatamente na API.
NOTIFY pgrst, 'reload schema';
