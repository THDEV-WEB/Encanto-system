-- REF-CLIENTE-02 Onda 2 — restringe a LEITURA de order_events (corrige vazamento).
-- ANTES: policy order_events_read_auth USING(true) -> QUALQUER autenticado lia TODOS os eventos de
--        todos os pedidos (inclui PII no payload de CLIENTE_ATUALIZADO). Vazamento.
-- DEPOIS: admin (is_admin) ve tudo; cliente ve SO os eventos dos PROPRIOS pedidos (via customer/auth_user_id).
-- Escopo: SOMENTE a policy de SELECT. A escrita de eventos e feita por create_order/trigger (SECURITY
-- DEFINER) e NAO e afetada. Nao cria/dropa tabela, nao toca dados. Reversivel (ver -rollback.sql).
BEGIN;

DROP POLICY IF EXISTS order_events_read_auth ON public.order_events;

CREATE POLICY order_events_read_own ON public.order_events
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR order_id IN (
      SELECT o.id
      FROM public.orders o
      JOIN public.customers c ON c.id = o.customer_id
      WHERE c.auth_user_id = auth.uid()
    )
  );

COMMIT;
