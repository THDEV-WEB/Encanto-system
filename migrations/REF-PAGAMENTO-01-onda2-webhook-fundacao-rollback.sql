-- ============================================================================
-- REF-PAGAMENTO-01 · Onda 2 — ROLLBACK
-- ----------------------------------------------------------------------------
-- Desagenda o job de expiração, remove as 6 funções internas, e restaura o
-- CHECK orders_status_valid ao texto EXATO de antes desta onda (fiel, não só
-- funcionalmente equivalente -- lição do INCIDENTE-01 sobre hash/definição
-- sensível a formatação).
-- ============================================================================

BEGIN;

SELECT cron.unschedule('encanto-pagamento-expira-intents') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'encanto-pagamento-expira-intents');

DROP FUNCTION IF EXISTS public._expirar_payment_intents_pendentes();
DROP FUNCTION IF EXISTS public._webhook_mercadopago_recebido(text, text, text, text, text, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public._processar_webhook_payment_intent(text, text, text, uuid, jsonb);
DROP FUNCTION IF EXISTS public._transicao_payment_status_valida(text, text);
DROP FUNCTION IF EXISTS public._validar_assinatura_webhook_mp(text, text, text, text);
DROP FUNCTION IF EXISTS public._hmac_sha256_hex(text, text);

ALTER TABLE public.orders DROP CONSTRAINT orders_status_valid;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_valid
  CHECK (status = ANY (ARRAY['recebido','preparo','pronto','entrega','entregue','cancelado']));

NOTIFY pgrst, 'reload schema';

COMMIT;
