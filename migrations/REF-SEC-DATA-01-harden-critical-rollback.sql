-- ROLLBACK — REF-SEC-DATA-01-harden-critical.sql
-- Restaura exatamente os grants anteriores (R1/R2/R3/R7). Nao usar em producao sem motivo forte —
-- os grants originais sao os proprios achados criticos da auditoria.

BEGIN;

-- Reverte o default privilege (causa raiz do R3).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLES TO anon, authenticated;

-- Reverte R3 — restaura TRUNCATE/REFERENCES/TRIGGER nas 18 tabelas.
GRANT TRUNCATE, REFERENCES, TRIGGER ON public.address_gazetteer   TO anon, authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON public.adicionais          TO anon, authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON public.admins              TO anon, authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON public.application_logs    TO anon, authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON public.categories          TO anon, authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON public.customers           TO anon, authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON public.loyalty_accounts    TO anon, authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON public.loyalty_events      TO anon, authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON public.notification_outbox TO anon, authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON public.order_events        TO anon, authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON public.order_items         TO anon, authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON public.orders              TO anon, authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON public.product_collections TO anon, authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON public.products            TO anon, authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON public.settings            TO anon, authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON public.store_settings      TO anon, authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON public.stores              TO anon, authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON public.super_admins        TO anon, authenticated;

-- Reverte R1 + R2 + R7 — restaura EXECUTE a authenticated nas 4 funcoes.
GRANT EXECUTE ON FUNCTION public.check_alert_thresholds() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_and_alert() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_orders(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_logs(integer, integer) TO authenticated;

COMMIT;
