-- ADR REF-ADDRESS-02 · Onda 4 — busca fuzzy local (pg_trgm) sobre tabela curada de bairros/ruas
-- Aditivo, idempotente, reversível (companion: REF-ADDRESS-02-onda4-gazetteer-rollback.sql).
-- NÃO altera addresses/orders/create_order/nenhuma tabela de pedido.
-- Ground truth via introspecção direta (2026-07-27): unaccent(text) é STABLE nesta base (não IMMUTABLE)
-- -> não pode ser usado direto em coluna gerada/índice funcional; pg_trgm disponível (v1.6) mas não
-- instalada; unaccent já vive no schema `public` (não em `extensions`) — pg_trgm instalada no mesmo
-- schema por consistência com o precedente já existente nesta base.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Wrapper IMMUTABLE de unaccent: fixa o dicionário explicitamente (forma de 2 argumentos) em vez de
-- depender da configuração de busca textual corrente (é isso que torna a forma de 1 argumento STABLE
-- e não IMMUTABLE) — padrão documentado do próprio Postgres para permitir indexar/gerar coluna com unaccent.
CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- Tabela curada: bairros/ruas conhecidas das cidades atendidas. Referência pública (sem PII) — cresce
-- por SQL puro (INSERT), sem exigir mudança de código nem deploy.
CREATE TABLE IF NOT EXISTS public.address_gazetteer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cidade text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('bairro', 'rua')),
  nome text NOT NULL,
  nome_normalizado text GENERATED ALWAYS AS (public.immutable_unaccent(lower(nome))) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS address_gazetteer_trgm_idx
  ON public.address_gazetteer USING gin (nome_normalizado gin_trgm_ops);

CREATE UNIQUE INDEX IF NOT EXISTS address_gazetteer_uniq
  ON public.address_gazetteer (cidade, tipo, nome_normalizado);

ALTER TABLE public.address_gazetteer ENABLE ROW LEVEL SECURITY;

-- Leitura pública (mesmo padrão do catálogo — dado de referência, sem PII); escrita só authenticated
-- (curadoria manual via SQL editor por enquanto; UI de admin fica para fase futura).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'address_gazetteer' AND policyname = 'Leitura publica gazetteer') THEN
    CREATE POLICY "Leitura publica gazetteer" ON public.address_gazetteer FOR SELECT TO anon, authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'address_gazetteer' AND policyname = 'Escrita admin gazetteer') THEN
    CREATE POLICY "Escrita admin gazetteer" ON public.address_gazetteer FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Busca fuzzy: melhores candidatos por similaridade de trigrama. threshold fixo na função (não depende
-- de GUC de sessão) — nunca lança por query vazia/curta/sem match (devolve 0 linhas).
CREATE OR REPLACE FUNCTION public.buscar_gazetteer(p_query text, p_cidade text DEFAULT NULL, p_limit int DEFAULT 5)
RETURNS TABLE (id uuid, cidade text, tipo text, nome text, similaridade real)
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog', 'public'
SET pg_trgm.similarity_threshold = 0.3
AS $$
  SELECT g.id, g.cidade, g.tipo, g.nome,
         similarity(g.nome_normalizado, public.immutable_unaccent(lower(p_query))) AS similaridade
  FROM public.address_gazetteer g
  WHERE (p_cidade IS NULL OR g.cidade = p_cidade)
    AND g.nome_normalizado % public.immutable_unaccent(lower(p_query))
  ORDER BY similaridade DESC
  LIMIT GREATEST(p_limit, 1);
$$;

REVOKE ALL ON FUNCTION public.buscar_gazetteer(text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buscar_gazetteer(text, text, int) TO anon, authenticated;

-- Seed inicial (starter set — EXPANSÍVEL por INSERT puro, sem mudança de código): só os nomes
-- confirmados AO VIVO nesta referência (Ondas 0/3, testes reais contra Nominatim/Photon). Crescer esta
-- lista é curadoria de conteúdo, registrada como trabalho futuro no ADR §18 (não bloqueia esta onda).
INSERT INTO public.address_gazetteer (cidade, tipo, nome) VALUES
  ('Timbó', 'bairro', 'Araponguinhas'),
  ('Timbó', 'bairro', 'Estados'),
  ('Timbó', 'rua', 'Rua João Schlei'),
  ('Timbó', 'rua', 'Rua Amazonas')
ON CONFLICT DO NOTHING;

COMMIT;

-- Verificação pós-aplicação (manual, se aplicar fora do runner administrativo):
-- SELECT extname FROM pg_extension WHERE extname='pg_trgm';
-- SELECT * FROM public.buscar_gazetteer('Rua Joao Schlay');  -- deve achar 'Rua João Schlei' por similaridade
-- SELECT count(*) FROM public.address_gazetteer;
