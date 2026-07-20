-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- REF-ORDER-01 — Fluxo profissional de pedidos (Comanda + Historico + Notificacoes + Metricas)
-- DB layer: Parte 2 (historico de status + ator), Parte 3 (fila de notificacoes / outbox) e Parte 4
-- (view de metricas). A Comanda (Parte 1) e 100% frontend e NAO depende desta migration.
--
-- Idempotente e reversivel (ver REF-ORDER-01-order-ops-rollback.sql). Aplicar UMA vez no SQL editor do
-- Supabase (sem service_role no repo). Tudo dentro de 1 transacao.
--
-- SEGURANCA DE PRODUCAO: o trigger de status registra evento + enfileira notificacao em bloco
-- BEGIN/EXCEPTION -> se o log falhar por qualquer motivo, a TROCA DE STATUS NAO E BLOQUEADA (best-effort,
-- mesma filosofia de DS.logEvent). Isso protege o admin de um assumido de schema estar errado.
--
-- PRESSUPOSTOS (order_events criada fora do repo, no dashboard): colunas
--   (order_id uuid, tipo text, status_anterior text, status_novo text, created_at timestamptz default now()).
-- Se a sua order_events tiver colunas NOT NULL alem dessas, o INSERT do historico apenas emite WARNING e
-- segue (nao quebra o pedido) — ajuste o INSERT se quiser o historico 100%. Ha query de verificacao no fim.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── 1) STATUS 'pronto' — garante que orders.status aceita os 6 estados (remove qualquer CHECK de status
--       pre-existente, sob qualquer nome, e recria o correto). CHECK nao tem dependentes -> seguro. ──
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public' AND rel.relname = 'orders' AND con.contype = 'c'
      -- casa SO o CHECK do enum de status do pedido (menciona a coluna status E valores do enum) —
      -- nao dropa por engano um eventual check de outra coluna que so contenha a palavra "status".
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
      AND pg_get_constraintdef(con.oid) ~* '(recebido|entregue)'
  LOOP
    EXECUTE format('ALTER TABLE public.orders DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('recebido','preparo','pronto','entrega','entregue','cancelado'));

-- ── 2) order_events.ator — quem realizou a transicao (rotulo amigavel: admin/cliente/sistema). ──
ALTER TABLE public.order_events ADD COLUMN IF NOT EXISTS ator text;

-- ── 3) notification_outbox — fila (padrao OUTBOX). O envio REAL e da Edge Function `whatsapp-notify`
--       (segredos no servidor). Enquanto nao configurada, a fila acumula 'pending' sem efeito colateral. ──
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
-- Escrita: so o trigger (SECURITY DEFINER) e o service_role (Edge Function). Sem policy p/ 'authenticated'
-- -> clientes nunca leem nem escrevem a fila (protege PII de telefone/nome).

-- ── 4) Helpers puros (SQL) usados pelos triggers. ──
CREATE OR REPLACE FUNCTION public.enc_actor_label()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN public.is_admin() THEN 'admin'
    WHEN auth.uid() IS NOT NULL THEN 'cliente'
    ELSE 'sistema'
  END;
$$;

CREATE OR REPLACE FUNCTION public.enc_tempo_estimado(p_address text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_address ~* 'retirada\s+na\s+loja' THEN 'cerca de 20 min' ELSE '35 a 45 min' END;
$$;

-- Enfileira uma notificacao (best-effort) para um pedido/estado. Usa vars estruturadas; o texto final e
-- renderizado pela Edge Function a partir de messageTemplates. 'cancelado' nao tem template -> nao entra.
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
      -- numero curto = MESMA derivacao do app do cliente (PedidoCard: 8 primeiros hex, sem hifen, maiusculo)
      -- para o "#XXXXXXXX" do WhatsApp casar com o "Meus Pedidos".
      'numero',  UPPER(LEFT(REPLACE(p_order_id::text, '-', ''), 8)),
      'tempo',   public.enc_tempo_estimado(p_address)
    )
  );
END;
$$;

-- ── 4b) CLAIM atomico da fila (padrao outbox): marca ate p_limit linhas 'pending' como 'sending' e as
--        devolve. FOR UPDATE SKIP LOCKED -> duas invocacoes concorrentes da Edge Function NUNCA pegam a
--        mesma linha (sem envio duplicado). Reivindica tambem 'sending' preso >15min (recuperacao de crash). ──
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

-- ── 5a) Trigger de TROCA de status: registra historico + enfileira notificacao (best-effort). ──
CREATE OR REPLACE FUNCTION public.enc_on_order_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Blocos INDEPENDENTES: uma falha no historico NAO pode suprimir a notificacao (e vice-versa).
    -- Cada um e best-effort e nunca bloqueia a troca de status.
    BEGIN
      INSERT INTO public.order_events (order_id, tipo, status_anterior, status_novo, ator, created_at)
      VALUES (NEW.id, 'STATUS_ALTERADO', OLD.status, NEW.status, public.enc_actor_label(), now());
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enc_on_order_status_change: historico falhou (pedido %): %', NEW.id, SQLERRM;
    END;
    BEGIN
      PERFORM public.enc_enqueue_notification(NEW.id, NEW.customer_id, NEW.status, NEW.address);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enc_on_order_status_change: notify falhou (pedido %): %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enc_order_status_change ON public.orders;
CREATE TRIGGER trg_enc_order_status_change
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enc_on_order_status_change();

-- ── 5b) Trigger de CRIACAO: enfileira a notificacao "Recebido" (create_order ja grava o evento de criacao).
CREATE OR REPLACE FUNCTION public.enc_on_order_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    PERFORM public.enc_enqueue_notification(NEW.id, NEW.customer_id, NEW.status, NEW.address);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enc_on_order_created: notify falhou (pedido %): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enc_order_created ON public.orders;
CREATE TRIGGER trg_enc_order_created
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enc_on_order_created();

-- ── 6) Metricas (Parte 4): duracao entre transicoes por pedido. security_invoker=true -> respeita a RLS
--       de order_events (admin ve tudo; cliente ve os proprios). Base pronta mesmo sem UI ainda. ──
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

-- ── VERIFICACAO (rode apos aplicar) ──────────────────────────────────────────────────────────────
-- 1) CHECK de status inclui 'pronto':
--    SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='orders_status_check';
-- 2) Triggers presentes:
--    SELECT tgname FROM pg_trigger WHERE tgrelid='public.orders'::regclass AND NOT tgisinternal;
-- 3) Teste seguro (rollback): BEGIN; UPDATE public.orders SET status='preparo' WHERE id=(SELECT id FROM public.orders ORDER BY created_at DESC LIMIT 1);
--    SELECT * FROM public.order_events WHERE tipo='STATUS_ALTERADO' ORDER BY created_at DESC LIMIT 1;
--    SELECT * FROM public.notification_outbox ORDER BY created_at DESC LIMIT 1; ROLLBACK;
