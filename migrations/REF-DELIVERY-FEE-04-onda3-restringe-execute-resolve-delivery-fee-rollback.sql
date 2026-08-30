-- REF-DELIVERY-FEE-04 · Onda 3 -- rollback: restaura o EXECUTE de anon/authenticated em
-- public._resolve_delivery_fee(), exatamente como estava antes desta migration (herdado do
-- ALTER DEFAULT PRIVILEGES do schema public, nunca revogado ate esta acao).

BEGIN;

GRANT EXECUTE ON FUNCTION public._resolve_delivery_fee(uuid, boolean, text, uuid) TO anon, authenticated;

COMMIT;
