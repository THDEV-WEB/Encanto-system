-- ============================================================================
-- REF-MESA-01 · Onda 7 — WhatsApp/notificações: elimina a última dependência da
-- regex sobre address + fecha o hedge "se for retirada... se for entrega..."
-- ----------------------------------------------------------------------------
-- Três funções tocadas, nesta ordem de dependência:
--
-- 1) enc_tempo_estimado — trocou p_address por p_tipo_pedido (mesma assinatura
--    (text, uuid), CREATE OR REPLACE simples). Ganha o 3º ramo de mesa
--    ("preparo em andamento", igual ao canônico JS
--    services/delivery/deliveryEtaFormat.js::MESA_TEMPO_TEXTO, Onda 5). Última
--    regex (/retirada\s+na\s+loja/i) do sistema inteiro sendo eliminada aqui.
--
-- 2) enc_enqueue_notification — passa a ler tipo_pedido/mesa_identificador de
--    orders (mesmo SELECT que já buscava store_id, sem nova query) em vez de só
--    receber address; usa tipo_pedido pra chamar enc_tempo_estimado (fix acima)
--    e pra resolver a nova var `situacao` (fix do hedge, ver item 3). Assinatura
--    p_address é mantida (mesmo que não usada mais pra classificar tipo) — só
--    pra não precisar mudar o trigger enc_on_order_notify/enc_on_order_notify()
--    que a chama, reduzindo o raio de mudança.
--
-- 3) enc_render_message — ACHADO OPERACIONAL (registrado, não é bug desta REF):
--    a versão vigente no projeto de E2E ainda era a de REF-ORDER-01b (hardcoded
--    "Encanto Delivery", nunca substituía {{empresa}}) — a correção de
--    REF-COMPANY-02 (2026-07-26, já commitada) nunca tinha sido aplicada nesse
--    ambiente. Esta migration parte da versão CORRETA já commitada (com
--    {{empresa}}) como base, antes de acrescentar {{situacao}} — não é uma
--    correção "de carona" fora de escopo, é a linha de base correta que
--    qualquer CREATE OR REPLACE desta função precisaria usar de qualquer forma.
--    Template de 'pronto' troca o hedge de 2 frases fixas por {{situacao}}
--    (resolvida no enqueue, nunca no render) — 3 ramos explícitos nunca mais
--    ternário de 2 vias. tests/whatsapp-templates.golden.mjs (Onda 7) reaponta
--    a checagem de sincronia pra ESTE arquivo, mesmo padrão já usado quando
--    REF-COMPANY-02 sucedeu REF-ORDER-01b (a antiga fica congelada como
--    registro histórico, nunca mais editada em vigor).
--
-- NÃO tocado: enc_dispatch_notifications (despacho/HTTP, agnóstico a
-- conteúdo), o trigger enc_on_order_notify (mesma assinatura de chamada),
-- template do status 'entrega' (inalcançável por mesa/retirada desde a Onda 5
-- — fluxoDoTipo nunca produz esse status pra esses dois tipos).
-- ============================================================================

BEGIN;

-- Renomear p_address -> p_tipo_pedido muda o NOME do parametro (mesmo tipo, (text,uuid)) -- CREATE OR
-- REPLACE sozinho falha ("cannot change name of input parameter"). Precisa dropar antes.
DROP FUNCTION IF EXISTS public.enc_tempo_estimado(text, uuid);

CREATE OR REPLACE FUNCTION public.enc_tempo_estimado(p_tipo_pedido text, p_store_id uuid DEFAULT default_store_id())
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE
    WHEN p_tipo_pedido = 'retirada' THEN 'cerca de 20 min'
    WHEN p_tipo_pedido = 'mesa' THEN 'preparo em andamento'
    ELSE 'até ' || COALESCE((SELECT valor FROM public.store_settings WHERE store_id = p_store_id AND chave = 'delivery_eta_min' LIMIT 1), '45') || ' min'
  END;
$function$;

-- DROP FUNCTION apaga grants -- restaura exatamente o que existia antes (PUBLIC).
GRANT EXECUTE ON FUNCTION public.enc_tempo_estimado(text, uuid) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.enc_enqueue_notification(p_order_id uuid, p_customer_id uuid, p_status text, p_address text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_phone text; v_name text; v_empresa text; v_store uuid; v_tipo text; v_mesa text;
BEGIN
  IF p_status NOT IN ('recebido','preparo','pronto','entrega','entregue') THEN RETURN; END IF;
  SELECT c.phone, c.name INTO v_phone, v_name FROM public.customers c WHERE c.id = p_customer_id;
  -- REF-MESA-01 · Onda 7: tipo_pedido/mesa_identificador junto do store_id, mesma query -- p_address
  -- deixa de ser usado pra classificar tipo (fonte de verdade agora e' a coluna estruturada).
  SELECT o.store_id, o.tipo_pedido, o.mesa_identificador INTO v_store, v_tipo, v_mesa FROM public.orders o WHERE o.id = p_order_id;
  SELECT public.get_company_info(v_store)->>'nomeCurto' INTO v_empresa;
  INSERT INTO public.notification_outbox (order_id, to_phone, status, vars, store_id)
  VALUES (
    p_order_id, v_phone, p_status,
    jsonb_build_object(
      'cliente', COALESCE(v_name, ''),
      'numero',  UPPER(LEFT(REPLACE(p_order_id::text, '-', ''), 8)),
      'tempo',   public.enc_tempo_estimado(v_tipo, v_store),
      'empresa', COALESCE(v_empresa, 'Encanto'),
      -- REF-MESA-01 · Onda 7: fecha o hedge do template 'pronto' -- 3 ramos explicitos, espelhado
      -- byte-a-byte por services/notifications/messageTemplates.js::situacaoPronto.
      'situacao', CASE v_tipo
                    WHEN 'retirada' THEN 'Já pode ser buscado.'
                    WHEN 'mesa' THEN 'Em breve será servido em sua mesa.'
                    ELSE 'Nosso entregador sairá em instantes.'
                  END,
      'mesa', COALESCE(v_mesa, '')
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
{{situacao}}$t$
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
  out := replace(out, '{{situacao}}', coalesce(p_vars->>'situacao',''));
  RETURN out;
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
