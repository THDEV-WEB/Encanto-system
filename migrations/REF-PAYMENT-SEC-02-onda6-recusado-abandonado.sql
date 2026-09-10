-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- REF-PAYMENT-SEC-02 · Onda 6 — pedido com pagamento RECUSADO que o cliente nunca reenvia fica preso
-- em 'aguardando_pagamento' pra sempre (achado adicional, identificado pela sessao paralela projetos-f4
-- durante a REF-LOYALTY-02 Onda 5, territorio desta REF por envolver o webhook de pagamento).
--
-- ACHADO: _processar_webhook_payment_intent (branch 'recusado', ver Onda 2) DELIBERADAMENTE preserva
-- orders.status='aguardando_pagamento' quando um pagamento e' recusado -- pra permitir nova tentativa
-- com o MESMO order_id (novo payment_intent). Decisao correta quando o cliente tenta de novo. Mas se
-- o cliente NUNCA reenvia, o pedido fica preso pra sempre: 'recusado' e' um estado TERMINAL da maquina
-- de payment_intents (nenhuma transicao SAI dele), entao _expirar_payment_intents_pendentes (cron a
-- cada 5min) nunca o alcanca -- esse cron so' cobre status='pendente'. Nem o selo de fidelidade (nunca
-- concedido, correto) nem o pedido (nunca fechado, incorreto) se recuperam desse caso especifico.
--
-- FIX (extensao do MESMO cron ja em producao, mesmo espirito do branch 'expirado' ja existente):
-- pedidos em 'aguardando_pagamento' cujo payment_intent MAIS RECENTE (nao qualquer um -- o cliente pode
-- ter varios ao longo do tempo, retry legitimo cria um novo) esta' 'recusado' ha' mais de 15 minutos
-- (mesma janela ja usada pro 'pendente') sao cancelados. payment_status NAO e' tocado (ja esta'
-- 'recusado', setado corretamente pelo webhook quando a recusa aconteceu) -- so' orders.status muda,
-- fechando o pedido. Se o cliente tentar de novo DEPOIS da recusa mas ANTES dos 15min, o payment_intent
-- mais recente passa a ser o novo (pendente/aprovado/etc), entao esse pedido fica automaticamente FORA
-- do escopo desta limpeza (join lateral sempre pega o payment_intent mais recente por order_id).
--
-- Nenhuma mudanca na maquina de estados de payment_intents.status, nenhuma mudanca em
-- _processar_webhook_payment_intent -- so' o cron de limpeza (mesmo padrao ja aprovado e em producao
-- pro caso 'expirado').
-- ════════════════════════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public._expirar_payment_intents_pendentes()
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH expirados AS (
    UPDATE public.payment_intents
    SET status = 'expirado', updated_at = now()
    WHERE status = 'pendente' AND created_at < now() - interval '15 minutes'
    RETURNING id, order_id
  ),
  pedidos_cancelados_expirado AS (
    UPDATE public.orders o
    SET status = 'cancelado', payment_status = 'expirado'
    FROM expirados e
    WHERE o.id = e.order_id AND o.status = 'aguardando_pagamento'
    RETURNING o.id
  ),
  -- REF-PAYMENT-SEC-02 · Onda 6: pedidos com pagamento recusado abandonado (ver cabecalho acima).
  recusados_abandonados AS (
    SELECT o.id AS order_id
    FROM public.orders o
    JOIN LATERAL (
      SELECT pi.status, pi.updated_at
      FROM public.payment_intents pi
      WHERE pi.order_id = o.id
      ORDER BY pi.created_at DESC
      LIMIT 1
    ) mais_recente ON true
    WHERE o.status = 'aguardando_pagamento'
      AND mais_recente.status = 'recusado'
      AND mais_recente.updated_at < now() - interval '15 minutes'
  ),
  pedidos_cancelados_recusado AS (
    UPDATE public.orders o
    SET status = 'cancelado'
    FROM recusados_abandonados r
    WHERE o.id = r.order_id AND o.status = 'aguardando_pagamento'
    RETURNING o.id
  )
  SELECT count(*)::integer FROM expirados;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
