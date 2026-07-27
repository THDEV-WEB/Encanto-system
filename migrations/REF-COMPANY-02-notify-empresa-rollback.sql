-- Rollback REF-COMPANY-02 (7/9) — restaura enc_enqueue_notification/enc_render_message aos corpos
-- anteriores (sem 'empresa'/{{empresa}}), copiados verbatim de REF-ORDER-01-order-ops.sql e
-- REF-ORDER-01b-whatsapp-dispatch.sql. Ambas sao RPCs vivas (trigger + pg_cron) — CREATE OR REPLACE,
-- nunca DROP.

BEGIN;

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
      'numero',  UPPER(LEFT(REPLACE(p_order_id::text, '-', ''), 8)),
      'tempo',   public.enc_tempo_estimado(p_address)
    )
  );
END;
$$;

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

COMMIT;
