-- Rollback REF-ORDER-01c — restaura o EXECUTE default (PUBLIC) das RPCs de notificacao.
-- ATENCAO: isto REABRE o acesso anon (estado inseguro anterior a REF-ORDER-01c). Use so para reverter.
BEGIN;

REVOKE EXECUTE ON FUNCTION public.enc_claim_notifications(int)                     FROM service_role;
GRANT  EXECUTE ON FUNCTION public.enc_claim_notifications(int)                     TO   PUBLIC;

GRANT  EXECUTE ON FUNCTION public.enc_enqueue_notification(uuid, uuid, text, text) TO   PUBLIC;

REVOKE EXECUTE ON FUNCTION public.enc_dispatch_notifications()                     FROM service_role;
GRANT  EXECUTE ON FUNCTION public.enc_dispatch_notifications()                     TO   PUBLIC;

COMMIT;
NOTIFY pgrst, 'reload schema';
