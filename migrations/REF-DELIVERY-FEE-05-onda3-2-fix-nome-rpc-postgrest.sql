-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- REF-DELIVERY-FEE-05 · Onda 3.2 — FIX: renomeia _upsert_delivery_route_cache -> upsert_delivery_route_cache.
--
-- BUG ENCONTRADO NA VALIDACAO EMPIRICA (2026-09-05, apos configurar OPENROUTESERVICE_API_KEY no E2E e
-- invocar a Edge Function route-distance de verdade): a chamada real ao HeiGIT funcionava perfeitamente
-- (distanceKm/durationMin corretos), mas a gravacao em delivery_route_cache SEMPRE falhava, com o erro
-- do PostgREST "Could not find the function public._upsert_delivery_route_cache(...) in the schema
-- cache" -- mesmo apos NOTIFY pgrst,'reload schema' e um RESTART COMPLETO do projeto (descartando
-- cache desatualizado como causa).
--
-- CAUSA RAIZ: convencao do PostgREST de OCULTAR da API REST/RPC qualquer funcao cujo nome comece com
-- underscore (usada neste projeto para sinalizar "helper interno", ex.: _resolve_delivery_fee,
-- _resolve_item_pricing) -- essas outras funcoes NUNCA precisaram ser chamadas via `.rpc()` do
-- supabase-js (so' de dentro de outra funcao SECURITY DEFINER, chamada direto em SQL). Esta e' a
-- PRIMEIRA funcao desta familia que precisa ser invocada via API REST (pela Edge Function, que so' fala
-- com o banco via PostgREST, mesmo usando a service_role key) -- e o prefixo underscore a torna
-- invisivel para esse caminho, apesar de existir no banco com os grants corretos (confirmado por
-- introspeccao: funcao presente, schema public, GRANT EXECUTE correto para service_role).
--
-- FIX: renomear (ALTER FUNCTION...RENAME TO, preserva GRANTs/owner automaticamente) para um nome SEM
-- underscore inicial. A protecao de seguranca continua sendo o GRANT (so' service_role, REVOKE de
-- PUBLIC/anon/authenticated) -- nunca dependeu do nome comecar com underscore, entao renomear nao
-- reduz seguranca nenhuma.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
BEGIN;

ALTER FUNCTION public._upsert_delivery_route_cache(uuid, double precision, double precision, double precision, double precision, numeric, numeric, text, text)
  RENAME TO upsert_delivery_route_cache;

COMMIT;

NOTIFY pgrst, 'reload schema';
