-- ROLLBACK REF-CLIENTE-02 Onda 2 — restaura a policy anterior de leitura de order_events.
-- ATENCAO: a policy antiga (USING true) reabre o vazamento (qualquer autenticado le todos os eventos).
-- Usar apenas se precisar reverter a Onda 2.
BEGIN;

DROP POLICY IF EXISTS order_events_read_own ON public.order_events;

CREATE POLICY order_events_read_auth ON public.order_events
  FOR SELECT TO authenticated
  USING (true);

COMMIT;
