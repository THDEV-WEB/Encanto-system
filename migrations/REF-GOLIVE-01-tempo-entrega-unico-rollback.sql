-- Rollback de REF-GOLIVE-01-tempo-entrega-unico.sql — restaura enc_tempo_estimado() ao comportamento
-- hardcoded original (migrations/REF-ORDER-01-order-ops.sql), IMMUTABLE, sem consultar settings.
-- Idempotente (CREATE OR REPLACE).

BEGIN;

CREATE OR REPLACE FUNCTION public.enc_tempo_estimado(p_address text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_address ~* 'retirada\s+na\s+loja' THEN 'cerca de 20 min' ELSE '35 a 45 min' END;
$$;

COMMIT;
