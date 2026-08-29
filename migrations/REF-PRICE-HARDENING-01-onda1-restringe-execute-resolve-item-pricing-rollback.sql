-- REF-PRICE-HARDENING-01 -- rollback: restaura o EXECUTE de anon/authenticated em
-- public._resolve_item_pricing(), exatamente como estava antes desta migration (herdado do
-- ALTER DEFAULT PRIVILEGES do schema public, nunca revogado ate esta acao).

BEGIN;

GRANT EXECUTE ON FUNCTION public._resolve_item_pricing(uuid, uuid, text, jsonb) TO anon, authenticated;

COMMIT;
