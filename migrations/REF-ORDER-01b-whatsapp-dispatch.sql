-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- REF-ORDER-01b — Dispatcher de notificacoes WhatsApp na PROPRIA base (pg_net + Vault + pg_cron).
-- Fecha o fluxo de ponta a ponta SEM Edge Function: drena notification_outbox, renderiza a mensagem,
-- envia pela WhatsApp Cloud API via net.http_post e confirma o resultado lendo net._http_response.
--
-- CREDENCIAIS ISOLADAS no Vault do Supabase (nao no codigo):
--   vault: 'whatsapp_token', 'whatsapp_phone_number_id' (+ opcional 'whatsapp_api_version', default v21.0)
-- Sem esses secrets -> o dispatcher e NO-OP (a fila acumula 'pending'; nada e perdido).
--
-- Templates: enc_render_message() ESPELHA src/services/notifications/messageTemplates.js (manter em sync;
-- o preview do admin usa o .js). Idempotente/reversivel (ver -rollback). Requer REF-ORDER-01-order-ops.sql.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
BEGIN;

-- guarda o id da requisicao pg_net p/ confirmar o resultado depois (2xx=sent / erro=failed)
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS net_request_id bigint;

-- ── Normalizacao de telefone BR (espelha WhatsAppService.normalizePhoneBR) ──
CREATE OR REPLACE FUNCTION public.enc_normalize_phone_br(p_phone text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d text;
BEGIN
  d := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  IF d = '' THEN RETURN ''; END IF;
  IF length(d) <= 11 THEN d := '55' || d; END IF;   -- sem DDI -> assume Brasil
  RETURN d;
END;
$$;

-- ── Render do template por status (ESPELHO de messageTemplates.js). Placeholders {{cliente}}/{{numero}}/{{tempo}}. ──
CREATE OR REPLACE FUNCTION public.enc_render_message(p_status text, p_vars jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE tpl text; out text;
BEGIN
  tpl := CASE p_status
    WHEN 'recebido' THEN $t$🍽️ Encanto Delivery

Olá, {{cliente}}.
Recebemos seu pedido #{{numero}}.
Agora nossa equipe iniciará o preparo.

Tempo estimado:
{{tempo}}

Obrigado pela preferência.$t$
    WHEN 'preparo' THEN $t$👨‍🍳 Encanto Delivery

Seu pedido #{{numero}}
já está sendo preparado.
Em breve seguirá para a próxima etapa.$t$
    WHEN 'pronto' THEN $t$✅ Encanto Delivery

Seu pedido #{{numero}}
está pronto.
Se for retirada, já pode ser buscado.
Se for entrega, nosso entregador sairá em instantes.$t$
    WHEN 'entrega' THEN $t$🛵 Encanto Delivery

Seu pedido #{{numero}}
acabou de sair para entrega.
Já está a caminho.$t$
    WHEN 'entregue' THEN $t$❤️ Encanto Delivery

Seu pedido foi entregue.
Esperamos que tenha gostado.
Muito obrigado pela preferência.$t$
    ELSE NULL
  END;
  IF tpl IS NULL THEN RETURN NULL; END IF;
  out := replace(tpl, '{{cliente}}', coalesce(p_vars->>'cliente',''));
  out := replace(out, '{{numero}}',  coalesce(p_vars->>'numero',''));
  out := replace(out, '{{tempo}}',   coalesce(p_vars->>'tempo',''));
  RETURN out;
END;
$$;

-- ── Dispatcher: CONFIRMA os 'sending' ja respondidos, depois DESPACHA os 'pending' (claim atomico). ──
CREATE OR REPLACE FUNCTION public.enc_dispatch_notifications()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_token text; v_phone_id text; v_version text;
  v_row record; v_msg text; v_to text; v_req bigint;
  v_desp int := 0; v_conf int := 0; v_pul int := 0;
BEGIN
  -- credenciais (Vault). Ausentes -> NO-OP (fila fica pending).
  SELECT decrypted_secret INTO v_token    FROM vault.decrypted_secrets WHERE name = 'whatsapp_token'           LIMIT 1;
  SELECT decrypted_secret INTO v_phone_id FROM vault.decrypted_secrets WHERE name = 'whatsapp_phone_number_id' LIMIT 1;
  SELECT decrypted_secret INTO v_version  FROM vault.decrypted_secrets WHERE name = 'whatsapp_api_version'      LIMIT 1;
  IF v_token IS NULL OR v_phone_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'whatsapp_not_configured');
  END IF;
  v_version := coalesce(v_version, 'v21.0');

  -- (1) CONFIRMACAO: resolve 'sending' cujos requests ja responderam.
  UPDATE public.notification_outbox o SET
    state      = CASE WHEN r.status_code BETWEEN 200 AND 299 THEN 'sent' ELSE 'failed' END,
    last_error = CASE WHEN r.status_code BETWEEN 200 AND 299 THEN NULL
                      ELSE 'http_' || coalesce(r.status_code::text, r.error_msg, 'err') || ' ' || left(coalesce(r.content, ''), 240) END,
    sent_at    = now()
  FROM net._http_response r
  WHERE r.id = o.net_request_id AND o.state = 'sending';
  GET DIAGNOSTICS v_conf = ROW_COUNT;

  -- (2) DESPACHO: claim atomico de pendentes -> render -> net.http_post -> guarda request_id, state='sending'.
  FOR v_row IN SELECT * FROM public.enc_claim_notifications(25) LOOP
    v_msg := public.enc_render_message(v_row.status, v_row.vars);
    v_to  := public.enc_normalize_phone_br(v_row.to_phone);
    IF v_msg IS NULL OR v_to = '' THEN
      UPDATE public.notification_outbox SET
        state = 'skipped', message = v_msg, attempts = attempts + 1,
        last_error = CASE WHEN v_to = '' THEN 'phone_missing' ELSE 'sem_template' END
      WHERE id = v_row.id;
      v_pul := v_pul + 1;
      CONTINUE;
    END IF;
    v_req := net.http_post(
      url     := format('https://graph.facebook.com/%s/%s/messages', v_version, v_phone_id),
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_token, 'Content-Type', 'application/json'),
      body    := jsonb_build_object(
        'messaging_product', 'whatsapp', 'recipient_type', 'individual', 'to', v_to, 'type', 'text',
        'text', jsonb_build_object('preview_url', false, 'body', v_msg))
    );
    UPDATE public.notification_outbox SET
      message = v_msg, net_request_id = v_req, attempts = attempts + 1, last_error = NULL
    WHERE id = v_row.id;   -- permanece 'sending' (claim ja marcou); confirmacao no proximo ciclo
    v_desp := v_desp + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'despachados', v_desp, 'confirmados', v_conf, 'pulados', v_pul);
END;
$$;

COMMIT;

-- ── Agendamento (fora da transacao) — a cada 30s. Reaplicavel (unschedule antes). ──
SELECT cron.unschedule('enc-dispatch-whatsapp') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'enc-dispatch-whatsapp');
SELECT cron.schedule('enc-dispatch-whatsapp', '30 seconds', $$SELECT public.enc_dispatch_notifications();$$);
