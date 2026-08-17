-- REF-ADDRESS-AUTOCOMPLETE-01 — addresses.confidence: escopo enxuto (exact/street_level/unknown)
-- Aprovado pelo dono em 2026-08-17 (escopo enxuto, nao os 5 niveis completos — ver auditoria em
-- docs/ref/REF-ADDRESS-AUTOCOMPLETE-01-auditoria.md). 'approximate' vira 'unknown'; neighborhood_level/
-- city_level NAO entram nesta migration porque enderecoPlausivel.js ja exige address.road pra qualquer
-- resultado de busca sobreviver ao filtro de plausibilidade (a mesma condicao que ja produz
-- exact/street_level) — esses 2 niveis mais amplos ficariam inertes no schema sem relaxar essa protecao
-- de proposito (protecao forense da REF-DELIVERY-FEE-02 contra aceitar rio/POI como endereco), o que
-- merece gate proprio, nao deve ser bundlado aqui.
--
-- NAO exige UPDATE: introspeccao read-only confirmou (2026-08-17) que 0 das 19 linhas reais de
-- addresses usa 'approximate' (18 usam 'street_level', 1 usa 'exact') — o DROP+ADD CONSTRAINT revalida
-- todas as linhas existentes contra o novo conjunto e passa sem tocar em nenhum dado.
--
-- Companion: REF-ADDRESS-AUTOCOMPLETE-01-confidence-schema-rollback.sql

BEGIN;

ALTER TABLE public.addresses DROP CONSTRAINT addresses_confidence_check;

ALTER TABLE public.addresses
  ADD CONSTRAINT addresses_confidence_check
  CHECK (confidence IS NULL OR confidence IN ('exact', 'street_level', 'unknown'));

COMMIT;

-- Verificação pós-aplicação (rodar manualmente):
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'addresses_confidence_check';
-- SELECT confidence, count(*) FROM public.addresses GROUP BY confidence ORDER BY count(*) DESC;
