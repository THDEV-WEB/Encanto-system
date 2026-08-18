-- ROLLBACK — REF-SEC-DATA-01-harden-r9-r18-r19.sql
-- Restaura R9 (grants de pg_net) e R18 (limites do bucket products) para o estado anterior.
-- Nao usar em producao sem motivo forte — os grants/limites originais sao os proprios achados da
-- auditoria. R19 NAO tem rollback funcional: as 3 funcoes (get_setting/normalize_phone/send_alert)
-- continuam existindo com o MESMO corpo de sempre (a migration so as versionou, nunca mudou
-- comportamento) — nao ha "estado anterior" pra restaurar, e um DROP FUNCTION seria destrutivo (essas
-- funcoes sao dependencia de outras 10+ funcoes do sistema).

BEGIN;

-- Reverte R18 — bucket 'products' volta a nao ter limite de tamanho/tipo.
UPDATE storage.buckets
   SET file_size_limit = NULL,
       allowed_mime_types = NULL
 WHERE id = 'products';

-- Reverte R9 — restaura EXECUTE de anon/authenticated em todas as funcoes do schema net.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'net'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', r.sig);
  END LOOP;
END $$;

COMMIT;
