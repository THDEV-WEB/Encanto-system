-- NORM-06 · F1A · Etapa 2 — DDL (colunas + backfill de slug + CREATE TABLE + RLS provisoria)
-- Aplicado via run.mjs --file. ATOMICO (BEGIN/COMMIT). Idempotente onde possivel (IF NOT EXISTS).
-- Expressao de slug: forma CORRIGIDA da Errata-01 (NORM-06-F1A-errata-01-slug.md).
-- NAO inclui indices (Etapa 3) nem constraints CHECK/UNIQUE/FK/slug-NOT-NULL (Etapa 4).
-- Corresponde ao ADR NORM-06 sec.7 F1A "1) Estrutura" + "2) medida temporaria" + Errata-01.
-- Rollback: migrations/NORM-06-F1A-step2-rollback.sql
BEGIN;

-- 2.1 — colunas novas em categories (STI + identidade visual + janela de colecao)
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS slug       text,
  ADD COLUMN IF NOT EXISTS descricao  text,
  ADD COLUMN IF NOT EXISTS imagem     text,
  ADD COLUMN IF NOT EXISTS banner     text,
  ADD COLUMN IF NOT EXISTS tipo       text NOT NULL DEFAULT 'business',
  ADD COLUMN IF NOT EXISTS estrategia text,
  ADD COLUMN IF NOT EXISTS definicao  jsonb,
  ADD COLUMN IF NOT EXISTS starts_at  timestamptz,
  ADD COLUMN IF NOT EXISTS ends_at    timestamptz;

-- 2.2 — backfill de slug (expressao CORRIGIDA da Errata-01; mesma do guard da Etapa 1)
UPDATE public.categories
   SET slug = trim(both '-' from regexp_replace(lower(unaccent(nome)), '[^a-z0-9]+', '-', 'g'))
 WHERE slug IS NULL;

-- 2.3 — CREATE TABLE product_collections (colunas + PK; UNIQUE e FK ficam na Etapa 4; indices na Etapa 3)
CREATE TABLE IF NOT EXISTS public.product_collections (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid        NOT NULL,
  collection_id text        NOT NULL,
  ordem         int         NOT NULL DEFAULT 0,
  fixado        boolean     NOT NULL DEFAULT false,
  created_at    timestamptz DEFAULT now()
);

-- 2.4 — medida TEMPORARIA de compatibilidade (RLS da tabela nova; revisao integral no HARDEN-RLS / NORM-06.1)
ALTER TABLE public.product_collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY pc_public_read ON public.product_collections FOR SELECT TO public USING (true);

COMMIT;
