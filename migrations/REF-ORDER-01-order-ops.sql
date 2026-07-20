-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- REF-ORDER-01 — Fluxo profissional de pedidos (camada de banco). REESCRITA apos introspecao do banco real.
-- Parte 2 (historico): JA EXISTE no banco — trg_order_audit() grava order_events (PEDIDO_CRIADO /
--   STATUS_ALTERADO / PEDIDO_ENTREGUE / PEDIDO_CANCELADO) com status_anterior/status_novo/created_at, e a
--   coluna de ator ja se chama `usuario`. Por isso esta migration NAO cria trigger de historico (evita
--   DUPLICAR eventos) e NAO adiciona coluna `ator`. O admin le esse historico via order_events (RLS is_admin).
-- Parte 3 (notificacoes): cria a fila notification_outbox + enqueue por status + claim atomico.
-- Parte 4 (metricas): view order_status_durations (le order_events, ja populado).
-- + habilita o estado 'pronto' no CHECK real (orders_status_valid), que hoje o bloqueia.
--
-- Idempotente/reversivel. Aplicada via Management API (REF-ORDER-01). PG17 (security_invoker ok).
-- O ENVIO real do WhatsApp e configurado em REF-ORDER-01b (pg_net + pg_cron + Vault), apos as credenciais.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── 1) STATUS 'pronto' — o CHECK real e `orders_status_valid` e NAO inclui 'pronto' (bloqueia o fluxo).
--       Remove qualquer CHECK de status do enum (casa a coluna status + valores do enum) e recria com 6. ──
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public' AND rel.relname = 'orders' AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
      AND pg_get_constraintdef(con.oid) ~* '(recebido|entregue)'
  LOOP
    EXECUTE format('ALTER TABLE public.orders DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_valid
  CHECK (status IN ('recebido','preparo','pronto','entrega','entregue','cancelado'));

-- ── 2) notification_outbox — fila (padrao OUTBOX). O envio real e do dispatcher (REF-ORDER-01b, pg_net). ──
CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  to_phone    text,
  status      text NOT NULL,
  vars        jsonb NOT NULL DEFAULT '{}'::jsonb,
  channel     text NOT NULL DEFAULT 'whatsapp',
  state       text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','sent','failed','skipped')),
  attempts    int  NOT NULL DEFAULT 0,
  message     text,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx
  ON public.notification_outbox (created_at) WHERE state = 'pending';

ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_outbox_admin_read ON public.notification_outbox;
CREATE POLICY notification_outbox_admin_read ON public.notification_outbox
  FOR SELECT TO authenticated USING (public.is_admin());
-- Escrita: so trigger (SECURITY DEFINER) e service_role/dispatcher. Sem policy p/ 'authenticated'
-- -> clientes nunca leem nem escrevem a fila (protege telefone/nome).

-- ── 3) Helpers (SQL) ──
CREATE OR REPLACE FUNCTION public.enc_tempo_estimado(p_address text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_address ~* 'retirada\s+na\s+loja' THEN 'cerca de 20 min' ELSE '35 a 45 min' END;
$$;

-- Enfileira uma notificacao (best-effort). 'cancelado' nao tem template ao cliente -> nao entra.
CREATE OR REPLACE FUNCTION public.enc_enqueue_notification(p_order_id uuid, p_customer_id uuid, p_status text, p_address text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_phone text; v_name text;
BEGIN
  IF p_status NOT IN ('recebido','preparo','pronto','entrega','entregue') THEN RETURN; END IF;
  SELECT c.phone, c.name INTO v_phone, v_name FROM public.customers c WHERE c.id = p_customer_id;
  INSERT INTO public.notification_outbox (order_id, to_phone, status, vars)
  VALUES (
    p_order_id, v_phone, p_status,
    jsonb_build_object(
      'cliente', COALESCE(v_name, ''),
      -- numero curto = MESMA derivacao do app do cliente (8 primeiros hex, sem hifen, maiusculo)
      'numero',  UPPER(LEFT(REPLACE(p_order_id::text, '-', ''), 8)),
      'tempo',   public.enc_tempo_estimado(p_address)
    )
  );
END;
$$;

-- ── 4) CLAIM atomico da fila: marca ate p_limit 'pending' como 'sending' e devolve (FOR UPDATE SKIP
--       LOCKED -> sem envio duplicado sob dispatchers concorrentes). Reivindica 'sending' preso >15min. ──
CREATE OR REPLACE FUNCTION public.enc_claim_notifications(p_limit int DEFAULT 25)
RETURNS SETOF public.notification_outbox
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.notification_outbox o
  SET state = 'sending'
  WHERE o.id IN (
    SELECT id FROM public.notification_outbox
    WHERE state = 'pending'
       OR (state = 'sending' AND created_at < now() - interval '15 minutes')
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING o.*;
$$;

-- ── 5) Trigger SO de NOTIFICACAO (NAO grava historico — quem grava e trg_order_audit, ja existente).
--       INSERT -> enfileira "Recebido"; UPDATE de status (mudou) -> enfileira o novo status. Best-effort. ──
CREATE OR REPLACE FUNCTION public.enc_on_order_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status) THEN
    BEGIN
      PERFORM public.enc_enqueue_notification(NEW.id, NEW.customer_id, NEW.status, NEW.address);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enc_on_order_notify: enqueue falhou (pedido %): %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_enc_order_notify ON public.orders;
CREATE TRIGGER trg_enc_order_notify
  AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enc_on_order_notify();

-- ── 6) Metricas (Parte 4): duracao entre transicoes por pedido. Le order_events (ja populado pelo audit).
--       security_invoker=true -> respeita a RLS de order_events (admin ve tudo; cliente ve os proprios). ──
CREATE OR REPLACE VIEW public.order_status_durations
WITH (security_invoker = true) AS
SELECT
  e.order_id,
  e.status_novo AS status,
  e.created_at  AS entrou_em,
  LEAD(e.created_at) OVER (PARTITION BY e.order_id ORDER BY e.created_at)                 AS saiu_em,
  LEAD(e.created_at) OVER (PARTITION BY e.order_id ORDER BY e.created_at) - e.created_at   AS duracao
FROM public.order_events e
WHERE e.status_novo IS NOT NULL;

COMMIT;

-- ── VERIFICACAO ──────────────────────────────────────────────────────────────────────────────────
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='orders_status_valid';   -- inclui 'pronto'
-- SELECT tgname FROM pg_trigger WHERE tgrelid='public.orders'::regclass AND NOT tgisinternal; -- + trg_enc_order_notify
-- BEGIN; UPDATE public.orders SET status='preparo' WHERE id=(SELECT id FROM public.orders ORDER BY created_at DESC LIMIT 1);
--   SELECT status,state,vars FROM public.notification_outbox ORDER BY created_at DESC LIMIT 1; ROLLBACK;
