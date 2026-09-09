-- ============================================================================
-- REF-PAGAMENTO-01 · Onda 4 — ROLLBACK do fix de timestamp
-- ----------------------------------------------------------------------------
-- Restaura o texto EXATO da funcao como ficou na Onda 2 -- incluindo o bug da
-- unidade do timestamp (rollback desfaz a migration, nao decide se o estado
-- anterior era correto).
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
    v_ts_instant := to_timestamp(v_ts::numeric / 1000.0);
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  IF v_ts_instant < now() - interval '10 minutes' OR v_ts_instant > now() + interval '2 minutes' THEN
    RETURN false;
  END IF;

  v_manifest := 'id:' || p_data_id || ';request-id:' || p_x_request_id || ';ts:' || v_ts || ';';
  v_esperado := public._hmac_sha256_hex(v_manifest, p_secret);
  RETURN v_esperado = lower(v_v1);
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
