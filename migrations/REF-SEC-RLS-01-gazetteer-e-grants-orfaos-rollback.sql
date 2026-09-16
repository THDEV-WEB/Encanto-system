-- ============================================================================
-- REF-SEC-RLS-01 — ROLLBACK
-- ----------------------------------------------------------------------------
-- Restaura a policy e os grants exatamente como estavam antes desta migration (confirmado por
-- leitura direta de produção antes de qualquer mudança).
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS "Escrita admin gazetteer" ON public.address_gazetteer;
CREATE POLICY "Escrita admin gazetteer" ON public.address_gazetteer
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stores                   TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_settings           TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rate_limit_hits          TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_route_cache     TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_route_requests  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings                 TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
