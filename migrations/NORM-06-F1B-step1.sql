-- NORM-06 · F1B · Etapa 2 — Triggers de invariante STI (I1..I4)
-- ATOMICO (BEGIN/COMMIT). Cria 4 funcoes + 4 triggers (CREATE OR REPLACE — idempotente; PG17.6).
-- Corresponde ao ADR NORM-06 sec.5 (I1..I4) + NORM-06A sec.2.4. NAO cria/altera tabela, coluna, indice,
-- constraint ou policy. NAO corrige dados (so adiciona triggers; baseline ja conforme — pre-validacao 0 violacoes).
--
-- D-I4-ADIC (ratificada na F1B): I4 tambem bloqueia business->collection quando ha adicionais
--   apontando a categoria (aplica_categoria_id), nao so produtos (categoria_id) — preserva I3 (soundness).
--
-- DESENHO DE LOCK (fecha TOCTOU sob READ COMMITTED — revisao adversarial F1B, achado MAJOR):
--   As leituras de categoria em I1/I2/I3 usam SELECT ... FOR SHARE. Um flip de tipo (UPDATE categories
--   SET tipo=...) pega FOR NO KEY UPDATE na linha da categoria; FOR SHARE conflita com isso, serializando
--   "adicionar referrer" vs "flipar tipo". Quem roda por ultimo re-le o estado commitado e rejeita
--   corretamente — logo nenhum par concorrente persiste estado invalido. (Validado por teste de concorrencia
--   na suite npm run test:f1b, caso C1.)
--
-- ESCOPO DO ENFORCEMENT (registro honesto):
--   - Cobre INSERT/UPDATE das colunas referenciadoras (collection_id/categoria_id/aplica_categoria_id) e UPDATE OF tipo.
--   - DELETE/TRUNCATE nao podem CRIAR inconsistencia de tipo (so removem linhas); COPY FROM dispara as BEFORE INSERT.
--   - Rename de categories.id e delegado as FKs (fk_categoria/adicionais_*/product_collections_* sao ON UPDATE NO ACTION,
--     bloqueando troca de PK enquanto houver referrer) — nao a estas triggers.
--   - Restores/bulk-loads sob session_replication_role='replica' ou com triggers desabilitadas CONTORNAM o enforcement
--     e exigem revalidacao pos-carga.
--   - As FKs existentes garantem EXISTENCIA das referencias; estas triggers checam apenas o TIPO da categoria.
-- Rollback: migrations/NORM-06-F1B-step1-rollback.sql
BEGIN;

-- ── I1 ── product_collections.collection_id deve referenciar categoria tipo='collection'.
CREATE OR REPLACE FUNCTION public.trg_sti_pc_collection_is_collection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tipo text;
BEGIN
  -- collection_id e NOT NULL (schema) + FK -> categories: existencia garantida. FOR SHARE: fecha TOCTOU vs flip de tipo.
  SELECT c.tipo INTO v_tipo FROM public.categories c WHERE c.id = NEW.collection_id FOR SHARE;
  IF v_tipo IS DISTINCT FROM 'collection' THEN
    RAISE EXCEPTION
      'STI I1: product_collections.collection_id=% referencia categoria tipo=% (exigido: collection)',
      NEW.collection_id, COALESCE(v_tipo, '(inexistente)')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_sti_pc_collection
  BEFORE INSERT OR UPDATE OF collection_id ON public.product_collections
  FOR EACH ROW EXECUTE FUNCTION public.trg_sti_pc_collection_is_collection();

-- ── I2 ── products.categoria_id (quando NOT NULL) deve referenciar categoria tipo='business'.
CREATE OR REPLACE FUNCTION public.trg_sti_product_categoria_is_business()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tipo text;
BEGIN
  IF NEW.categoria_id IS NULL THEN
    RETURN NEW;  -- categoria_id e nullable (FK ON DELETE SET NULL): sem categoria de negocio = permitido.
  END IF;
  SELECT c.tipo INTO v_tipo FROM public.categories c WHERE c.id = NEW.categoria_id FOR SHARE;
  IF v_tipo IS DISTINCT FROM 'business' THEN
    RAISE EXCEPTION
      'STI I2: products.categoria_id=% referencia categoria tipo=% (exigido: business)',
      NEW.categoria_id, COALESCE(v_tipo, '(inexistente)')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_sti_product_categoria
  BEFORE INSERT OR UPDATE OF categoria_id ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.trg_sti_product_categoria_is_business();

-- ── I3 ── adicionais.aplica_categoria_id (quando NOT NULL) deve referenciar categoria tipo='business'.
CREATE OR REPLACE FUNCTION public.trg_sti_adicional_categoria_is_business()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tipo text;
BEGIN
  IF NEW.aplica_categoria_id IS NULL THEN
    RETURN NEW;  -- nullable (FK ON DELETE CASCADE): adicional sem categoria-alvo = permitido.
  END IF;
  SELECT c.tipo INTO v_tipo FROM public.categories c WHERE c.id = NEW.aplica_categoria_id FOR SHARE;
  IF v_tipo IS DISTINCT FROM 'business' THEN
    RAISE EXCEPTION
      'STI I3: adicionais.aplica_categoria_id=% referencia categoria tipo=% (exigido: business)',
      NEW.aplica_categoria_id, COALESCE(v_tipo, '(inexistente)')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_sti_adicional_categoria
  BEFORE INSERT OR UPDATE OF aplica_categoria_id ON public.adicionais
  FOR EACH ROW EXECUTE FUNCTION public.trg_sti_adicional_categoria_is_business();

-- ── I4 ── troca de categories.tipo que gere inconsistencia (bloqueia ANTES de persistir).
--   business->collection: bloqueia se ainda for usada como categoria de negocio
--     (produtos.categoria_id [I2] OU adicionais.aplica_categoria_id [I3 / D-I4-ADIC]).
--   collection->business: bloqueia se houver membros de colecao (product_collections.collection_id [I1]).
--   O UPDATE da categoria pega FOR NO KEY UPDATE na linha; as contagens veem o estado correto serializado
--   pelo FOR SHARE das triggers referrer (vide DESENHO DE LOCK no cabecalho).
CREATE OR REPLACE FUNCTION public.trg_sti_categoria_tipo_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_n_products int;
  v_n_adic     int;
  v_n_members  int;
BEGIN
  -- So age quando o tipo realmente muda (UPDATE OF tipo dispara mesmo sem mudanca de valor).
  IF NEW.tipo IS NOT DISTINCT FROM OLD.tipo THEN
    RETURN NEW;
  END IF;

  IF OLD.tipo = 'business' AND NEW.tipo = 'collection' THEN
    SELECT count(*) INTO v_n_products FROM public.products p WHERE p.categoria_id = OLD.id;
    IF v_n_products > 0 THEN
      RAISE EXCEPTION
        'STI I4: categoria %(%) nao pode virar collection: % produto(s) a referenciam como categoria_id (I2)',
        OLD.id, OLD.nome, v_n_products
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT count(*) INTO v_n_adic FROM public.adicionais a WHERE a.aplica_categoria_id = OLD.id;
    IF v_n_adic > 0 THEN
      RAISE EXCEPTION
        'STI I4: categoria %(%) nao pode virar collection: % adicional(is) a referenciam como aplica_categoria_id (I3/D-I4-ADIC)',
        OLD.id, OLD.nome, v_n_adic
        USING ERRCODE = 'check_violation';
    END IF;

  ELSIF OLD.tipo = 'collection' AND NEW.tipo = 'business' THEN
    SELECT count(*) INTO v_n_members FROM public.product_collections pc WHERE pc.collection_id = OLD.id;
    IF v_n_members > 0 THEN
      RAISE EXCEPTION
        'STI I4: categoria %(%) nao pode virar business: % membro(s) em product_collections a referenciam (I1)',
        OLD.id, OLD.nome, v_n_members
        USING ERRCODE = 'check_violation';
    END IF;

  ELSE
    -- Defesa em profundidade: inalcancavel enquanto categories_tipo_chk (business|collection) viver
    -- e o no-op acima retornar para NEW=OLD. Blinda contra afrouxamento futuro do CHECK.
    RAISE EXCEPTION
      'STI I4: transicao de tipo nao suportada %->% (categoria %)', OLD.tipo, NEW.tipo, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_sti_categoria_tipo
  BEFORE UPDATE OF tipo ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.trg_sti_categoria_tipo_guard();

COMMIT;
