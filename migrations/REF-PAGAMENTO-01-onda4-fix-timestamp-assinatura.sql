-- ============================================================================
-- REF-PAGAMENTO-01 · Onda 4 — FIX: unidade do timestamp na assinatura do webhook
-- ----------------------------------------------------------------------------
-- ACHADO REAL (2026-09-09, via diagnostico contra um webhook DE VERDADE enviado
-- pelo Mercado Pago -- nao simulacao): o campo "ts" do header x-signature vem
-- em SEGUNDOS desde epoch (confirmado empiricamente: ts=1788992943 bate com a
-- data/hora real do evento). A Onda 2 assumiu MILISSEGUNDOS (mesma convencao
-- de Date.now() do JS) e dividia por 1000 antes de converter -- com um valor
-- que ja estava em segundos, a divisao por 1000 produzia uma data proxima de
-- 1970, sempre fora da janela de frescor de 10min/2min, rejeitando QUALQUER
-- assinatura real do Mercado Pago (mesmo com o HMAC matematicamente correto
-- -- confirmado por diagnostico: o HMAC recalculado bateu exatamente com o
-- "v1" do header, o problema era 100% a checagem de frescor).
--
-- Por que os testes da Onda 2 nao pegaram isso: o proprio script de teste
-- (scripts/pagamento-01-onda2-webhook-test.mjs) gerava "ts" de teste via
-- Date.now() (milissegundos) -- mesma suposicao errada dos dois lados,
-- testes e codigo concordando entre si sem nunca validar contra o formato
-- REAL do Mercado Pago. Corrigido nesta migration + no script de teste
-- (ts de teste agora em segundos, Math.floor(Date.now()/1000), mesma
-- convencao real).
--
-- Unica mudanca: to_timestamp(v_ts::numeric / 1000.0) -> to_timestamp(v_ts::numeric).
-- Todo o resto da funcao (manifest, HMAC, janela de frescor de 10min/2min)
-- continua identico -- so a UNIDADE do timestamp estava errada.
--
-- create_order()/_resolve_delivery_fee() continuam intocados (nem perto
-- deste arquivo).
--
-- Testes: scripts/pagamento-01-onda2-webhook-test.mjs (regressao, ts
-- corrigido) + scripts/pagamento-01-onda4-webhook-real-test.mjs (ts
-- corrigido) + validacao final contra um webhook REAL do Mercado Pago
-- (nao um script -- o proprio MP reenviando/enviando de novo).
-- Rollback: REF-PAGAMENTO-01-onda4-fix-timestamp-assinatura-rollback.sql
-- (restaura o texto EXATO da Onda 2, incluindo o bug -- rollback desfaz a
-- migration, nao decide se o estado anterior era certo).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._validar_assinatura_webhook_mp(p_data_id text, p_x_request_id text, p_x_signature text, p_secret text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_ts text;
  v_v1 text;
  v_manifest text;
  v_esperado text;
  v_ts_instant timestamptz;
BEGIN
  IF p_data_id IS NULL OR p_x_request_id IS NULL OR p_x_signature IS NULL OR p_secret IS NULL THEN
    RETURN false;
  END IF;

  v_ts := (regexp_match(p_x_signature, 'ts=([0-9]+)'))[1];
  v_v1 := (regexp_match(p_x_signature, 'v1=([0-9a-fA-F]+)'))[1];
  IF v_ts IS NULL OR v_v1 IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    -- FIX Onda 4: "ts" do Mercado Pago e' em SEGUNDOS (confirmado empiricamente contra um
    -- webhook real) -- to_timestamp() ja espera segundos, sem dividir por 1000.
    v_ts_instant := to_timestamp(v_ts::numeric);
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  -- Defesa em profundidade ADICIONAL, nao exigida pela doc oficial do Mercado Pago (que nao define
  -- janela de frescor) -- ver cabecalho da migration.
  IF v_ts_instant < now() - interval '10 minutes' OR v_ts_instant > now() + interval '2 minutes' THEN
    RETURN false;
  END IF;

  -- Manifest EXATO documentado pelo Mercado Pago ("Webhooks - assinatura secreta"):
  -- id:{data.id};request-id:{x-request-id};ts:{timestamp};
  v_manifest := 'id:' || p_data_id || ';request-id:' || p_x_request_id || ';ts:' || v_ts || ';';
  v_esperado := public._hmac_sha256_hex(v_manifest, p_secret);
  RETURN v_esperado = lower(v_v1);
END;
$function$;
-- CREATE OR REPLACE preserva os grants existentes (REVOKE ALL da Onda 2 continua valendo).

NOTIFY pgrst, 'reload schema';

COMMIT;
