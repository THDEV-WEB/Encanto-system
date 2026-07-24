-- REF-ADMIN-03 · Onda 1 — Integridade definitiva de categories/products.categoria_ids.
-- ATOMICO (BEGIN/COMMIT). Idempotente (CREATE OR REPLACE / IF NOT EXISTS).
--
-- CONTEXTO (auditoria real do schema de producao, 2026-07-24): a FK `fk_categoria` cobre
-- `products.categoria_id` (coluna singular, legada) com ON DELETE SET NULL. `categoria_ids` (text[],
-- fonte real da arquitetura multi-categoria, REF-ADMIN-CATALOG-01) NAO PODE ter FK (Postgres nao
-- suporta FK em coluna array) e ate hoje nao tinha NENHUM enforcement no banco — a unica protecao era
-- o guard de aplicacao em DS.delCat (REF-ADMIN-01), que conta produtos via `.contains()` ANTES do
-- DELETE. As triggers STI existentes (NORM-06 F1B, trg_sti_product_categoria/trg_sti_categoria_tipo)
-- ja validam TIPO da categoria referenciada por categoria_id/aplica_categoria_id/collection_id, mas
-- nenhuma delas cobre DELETE de categories nem toca categoria_ids — o registro "ESCOPO DO ENFORCEMENT"
-- do proprio NORM-06-F1B-step1.sql documenta isso explicitamente ("DELETE/TRUNCATE nao podem CRIAR
-- inconsistencia de tipo" — mas podem sim orfanizar categoria_ids, um invariante DIFERENTE do STI).
--
-- DECISAO (REF-ADMIN-03, avaliadas tambem CHECK constraint [nao se aplica a array x outra tabela] e
-- RPC atomica [mesmo efeito, mais reescrita de UI]): trigger BEFORE DELETE em categories, no MESMO
-- estilo/convencao das triggers STI ja existentes (RAISE EXCEPTION + ERRCODE=check_violation,
-- CREATE OR REPLACE TRIGGER). Fecha o caso real (delete de categoria em uso) e qualquer caminho de
-- escrita futuro que nao seja o DS.delCat (ex.: SQL direto, uma futura API SaaS/multi-admin).
--
-- ESCOPO DO ENFORCEMENT (registro honesto, mesmo padrao do NORM-06-F1B):
--   - Cobre DELETE de categories referenciada por products.categoria_ids.
--   - NAO fecha 100% da corrida sob concorrencia real: nao existe (e esta migration NAO cria) uma
--     trigger simetrica em products validando categoria_ids no INSERT/UPDATE com FOR SHARE na
--     categoria — isso fecharia a corrida via lock conflitante (mesmo desenho do NORM-06-F1B), mas
--     introduziria um subsistema de integridade referencial NOVO para o array inteiro (hoje
--     categoria_ids nao tem NENHUMA validacao de existencia, nem fora desta trigger) — fora do escopo
--     desta REF (fortalecer o que ja existe, nao construir enforcement novo para um invariante
--     diferente). Ver ADR REF-ADMIN-03 §Onda 1 para a analise completa de custo/beneficio.
--   - O guard de aplicacao (DS.delCat) continua sendo a 1a linha (mensagem imediata com contagem
--     exata); esta trigger e defesa em profundidade (2a linha), nao substitui a 1a.
--
-- Indice: products nao tinha indice em categoria_ids (so products_pkey) — GIN acelera tanto a
-- contagem desta trigger quanto DS.produtosNaCategoria/prodInCat conforme o catalogo cresce.
--
-- Rollback: migrations/REF-ADMIN-03-categoria-delete-guard-rollback.sql
BEGIN;

CREATE INDEX IF NOT EXISTS products_categoria_ids_gin_idx
  ON public.products USING gin (categoria_ids);

CREATE OR REPLACE FUNCTION public.trg_categoria_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_n_products int;
BEGIN
  -- OLD ja esta com row lock (DELETE) — nenhum FOR SHARE adicional necessario para a leitura em si.
  SELECT count(*) INTO v_n_products FROM public.products p WHERE p.categoria_ids @> ARRAY[OLD.id];
  IF v_n_products > 0 THEN
    RAISE EXCEPTION
      'categoria %(%) nao pode ser excluida: % produto(s) a referenciam via categoria_ids',
      OLD.id, OLD.nome, v_n_products
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE TRIGGER trg_categoria_delete
  BEFORE DELETE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.trg_categoria_delete_guard();

COMMIT;

-- ── VERIFICACAO ──────────────────────────────────────────────────────────────────────────────────
-- SELECT indexname FROM pg_indexes WHERE tablename='products' AND indexname='products_categoria_ids_gin_idx';
-- SELECT tgname FROM pg_trigger WHERE tgrelid='public.categories'::regclass AND NOT tgisinternal; -- + trg_categoria_delete
-- BEGIN;
--   INSERT INTO categories(id,nome,ordem,ativo,slug,tipo) VALUES ('zz_test','zz_test',999,true,'zz-test-verif','business');
--   INSERT INTO products(id,nome,descricao,preco,categoria_id,categoria_ids,disponivel,adicionais_gratis)
--     VALUES (gen_random_uuid(),'zz_test_prod','x',1,'zz_test',ARRAY['zz_test'],true,0);
--   DELETE FROM categories WHERE id='zz_test'; -- deve falhar com check_violation
-- ROLLBACK;
