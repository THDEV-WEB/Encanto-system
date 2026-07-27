-- REF-COMPANY-02 (7/9) — Nome institucional (nomeCurto) nas notificacoes automaticas de WhatsApp.
--
-- CONTEXTO: as 5 mensagens de status (recebido/preparo/pronto/entrega/entregue) tinham "Encanto Delivery"
-- hardcoded em TRES copias mantidas manualmente em sincronia: src/services/notifications/messageTemplates.js
-- (canonico JS), supabase/functions/whatsapp-notify/templates.ts (espelho da Edge Function) e esta funcao
-- SQL abaixo, enc_render_message (migrations/REF-ORDER-01b-whatsapp-dispatch.sql — dispatcher SQL-nativo
-- agendado via pg_cron a cada 30s, provavelmente o caminho de envio realmente ativo em producao). As duas
-- primeiras trocam "Encanto Delivery" por um placeholder generico {{empresa}} (sem mudar o renderer, que
-- ja faz substituicao generica de {{chave}}); esta migration fecha a terceira copia.
--
-- DECISAO (ADR REF-COMPANY-02 §Decisao B): {{empresa}} e resolvido em UM UNICO PONTO —
-- enc_enqueue_notification, o mesmo lugar que ja monta cliente/numero/tempo no vars jsonb da fila
-- (notification_outbox). Os dois disparadores (esta funcao SQL e a Edge Function) apenas fazem
-- substituicao generica do vars recebido — nenhum dos dois consulta company_info por conta propria.
-- Trade-off aceito: ate ~30s de defasagem (janela do cron) se o admin renomear a empresa com a fila
-- cheia — mesmo modelo de frescor ja usado para cliente/numero/tempo (tambem snapshots no enqueue).
--
-- Requer REF-ORDER-01-order-ops.sql, REF-ORDER-01b-whatsapp-dispatch.sql e REF-COMPANY-02-nome-split.sql
-- (ja aplicadas). Idempotente (CREATE OR REPLACE). Rollback em arquivo separado.

BEGIN;

-- enc_enqueue_notification ganha 'empresa' no vars (busca get_company_info()->>'nomeCurto', SECURITY
-- DEFINER + mesmo banco, sem hop de rede). Tudo o mais identico a REF-ORDER-01-order-ops.sql.
CREATE OR REPLACE FUNCTION public.enc_enqueue_notification(p_order_id uuid, p_customer_id uuid, p_status text, p_address text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_phone text; v_name text; v_empresa text;
BEGIN
  IF p_status NOT IN ('recebido','preparo','pronto','entrega','entregue') THEN RETURN; END IF;
  SELECT c.phone, c.name INTO v_phone, v_name FROM public.customers c WHERE c.id = p_customer_id;
  SELECT public.get_company_info()->>'nomeCurto' INTO v_empresa;
  INSERT INTO public.notification_outbox (order_id, to_phone, status, vars)
  VALUES (
    p_order_id, v_phone, p_status,
    jsonb_build_object(
      'cliente', COALESCE(v_name, ''),
      -- numero curto = MESMA derivacao do app do cliente (8 primeiros hex, sem hifen, maiusculo)
      'numero',  UPPER(LEFT(REPLACE(p_order_id::text, '-', ''), 8)),
      'tempo',   public.enc_tempo_estimado(p_address),
      'empresa', COALESCE(v_empresa, 'Encanto')
    )
  );
END;
$$;

-- enc_render_message: "Encanto Delivery" -> {{empresa}} nos 5 templates (mesmo texto canonico de
-- messageTemplates.js/templates.ts) + uma linha de replace para o novo placeholder. Fallback 'Encanto'
-- cobre linhas 'pending' antigas, enfileiradas antes desta migration (vars sem 'empresa' ainda).
CREATE OR REPLACE FUNCTION public.enc_render_message(p_status text, p_vars jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE tpl text; out text;
BEGIN
  tpl := CASE p_status
    WHEN 'recebido' THEN $t$🍽️ {{empresa}}

Olá, {{cliente}}.
Recebemos seu pedido #{{numero}}.
Agora nossa equipe iniciará o preparo.

Tempo estimado:
{{tempo}}

Obrigado pela preferência.$t$
    WHEN 'preparo' THEN $t$👨‍🍳 {{empresa}}

Seu pedido #{{numero}}
já está sendo preparado.
Em breve seguirá para a próxima etapa.$t$
    WHEN 'pronto' THEN $t$✅ {{empresa}}

Seu pedido #{{numero}}
está pronto.
Se for retirada, já pode ser buscado.
Se for entrega, nosso entregador sairá em instantes.$t$
    WHEN 'entrega' THEN $t$🛵 {{empresa}}

Seu pedido #{{numero}}
acabou de sair para entrega.
Já está a caminho.$t$
    WHEN 'entregue' THEN $t$❤️ {{empresa}}

Seu pedido foi entregue.
Esperamos que tenha gostado.
Muito obrigado pela preferência.$t$
    ELSE NULL
  END;
  IF tpl IS NULL THEN RETURN NULL; END IF;
  out := replace(tpl, '{{cliente}}', coalesce(p_vars->>'cliente',''));
  out := replace(out, '{{numero}}',  coalesce(p_vars->>'numero',''));
  out := replace(out, '{{tempo}}',   coalesce(p_vars->>'tempo',''));
  out := replace(out, '{{empresa}}', coalesce(nullif(p_vars->>'empresa',''), 'Encanto'));
  RETURN out;
END;
$$;

COMMIT;
