-- ============================================================================
-- REF-MESA-01 · Onda 7 — ROLLBACK
-- Restaura enc_tempo_estimado/enc_enqueue_notification/enc_render_message para
-- a forma EXATA que estava ao vivo no projeto de E2E antes desta migration
-- (byte-a-byte, incluindo o "Encanto Delivery" hardcoded que REF-COMPANY-02
-- nunca tinha aplicado nesse ambiente -- ver comentário no cabeçalho da
-- migration original). Não tenta "desfazer só a parte de mesa" preservando o
-- fix de {{empresa}} -- rollback restaura o estado anterior real, ponto.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.enc_tempo_estimado(text, uuid);

CREATE OR REPLACE FUNCTION public.enc_tempo_estimado(p_address text, p_store_id uuid DEFAULT default_store_id())
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE
    WHEN p_address ~* 'retirada\s+na\s+loja' THEN 'cerca de 20 min'
    ELSE 'até ' || COALESCE((SELECT valor FROM public.store_settings WHERE store_id = p_store_id AND chave = 'delivery_eta_min' LIMIT 1), '45') || ' min'
  END;
$function$;

GRANT EXECUTE ON FUNCTION public.enc_tempo_estimado(text, uuid) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.enc_enqueue_notification(p_order_id uuid, p_customer_id uuid, p_status text, p_address text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_phone text; v_name text; v_empresa text; v_store uuid;
BEGIN
  IF p_status NOT IN ('recebido','preparo','pronto','entrega','entregue') THEN RETURN; END IF;
  SELECT c.phone, c.name INTO v_phone, v_name FROM public.customers c WHERE c.id = p_customer_id;
  SELECT o.store_id INTO v_store FROM public.orders o WHERE o.id = p_order_id;
  SELECT public.get_company_info(v_store)->>'nomeCurto' INTO v_empresa;
  INSERT INTO public.notification_outbox (order_id, to_phone, status, vars, store_id)
  VALUES (
    p_order_id, v_phone, p_status,
    jsonb_build_object(
      'cliente', COALESCE(v_name, ''),
      'numero',  UPPER(LEFT(REPLACE(p_order_id::text, '-', ''), 8)),
      'tempo',   public.enc_tempo_estimado(p_address, v_store),
      'empresa', COALESCE(v_empresa, 'Encanto')
    ),
    v_store
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.enc_render_message(p_status text, p_vars jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
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
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
