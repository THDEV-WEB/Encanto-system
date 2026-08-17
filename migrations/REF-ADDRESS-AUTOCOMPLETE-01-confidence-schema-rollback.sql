-- Rollback de REF-ADDRESS-AUTOCOMPLETE-01-confidence-schema.sql — volta o CHECK ao conjunto de 3
-- valores anterior (exact/street_level/approximate). Seguro mesmo que já existam linhas com
-- confidence='unknown' gravadas após a migration aplicar: reverte o CONSTRAINT para IN
-- ('exact','street_level','approximate'), que rejeitaria 'unknown' daqui pra frente — mas linhas já
-- gravadas com 'unknown' ficam com um valor fora do novo CHECK (Postgres não revalida linhas
-- existentes ao trocar o CONSTRAINT, só valida a partir de agora). Se isso acontecer, normalizar essas
-- linhas para 'approximate' antes ou depois do rollback, conforme o caso.

BEGIN;

ALTER TABLE public.addresses DROP CONSTRAINT addresses_confidence_check;

ALTER TABLE public.addresses
  ADD CONSTRAINT addresses_confidence_check
  CHECK (confidence IS NULL OR confidence IN ('exact', 'street_level', 'approximate'));

COMMIT;
