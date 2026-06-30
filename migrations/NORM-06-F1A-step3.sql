-- NORM-06 · F1A · Etapa 3 — Indices do Collection Engine (tabela product_collections)
-- ATOMICO (BEGIN/COMMIT). Idempotente (IF NOT EXISTS). SOMENTE CREATE INDEX.
-- Corresponde ao ADR NORM-06 sec.7 F1A "Indices" / NORM-06A sec.2.3:
--   (collection_id, fixado DESC, ordem)  e  (product_id).
-- NAO cria constraints (Etapa 4). NAO altera tabela/coluna/policy/trigger.
-- Indices de paginacao de products NAO entram (F3b, fora do NORM-06).
-- Rollback: migrations/NORM-06-F1A-step3-rollback.sql
BEGIN;

CREATE INDEX IF NOT EXISTS pc_collection_idx
  ON public.product_collections (collection_id, fixado DESC, ordem);

CREATE INDEX IF NOT EXISTS pc_product_idx
  ON public.product_collections (product_id);

COMMIT;
