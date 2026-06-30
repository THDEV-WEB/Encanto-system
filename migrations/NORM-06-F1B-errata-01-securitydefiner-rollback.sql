-- Rollback da F1B ERRATA-01. Volta as 4 funções STI a SECURITY INVOKER (estado original da F1B step1).
-- ⚠️ AVISO: reverter RE-INTRODUZ a regressão — sob role 'authenticated' o FOR SHARE volta a não enxergar a
--   categoria sob RLS, quebrando escritas que referenciem categoria. Reverter só se for desfazer a F1B inteira.
-- ATÔMICO. CREATE OR REPLACE FUNCTION (sem SECURITY DEFINER = INVOKER padrão).
BEGIN;

CREATE OR REPLACE FUNCTION public.trg_sti_pc_collection_is_collection()
RETURNS trigger LANGUAGE plpgsql
AS $$
DECLARE v_tipo text;
BEGIN
  SELECT c.tipo INTO v_tipo FROM public.categories c WHERE c.id = NEW.collection_id FOR SHARE;
  IF v_tipo IS DISTINCT FROM 'collection' THEN
    RAISE EXCEPTION 'STI I1: product_collections.collection_id=% referencia categoria tipo=% (exigido: collection)',
      NEW.collection_id, COALESCE(v_tipo, '(inexistente)') USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_sti_product_categoria_is_business()
RETURNS trigger LANGUAGE plpgsql
AS $$
DECLARE v_tipo text;
BEGIN
  IF NEW.categoria_id IS NULL THEN RETURN NEW; END IF;
  SELECT c.tipo INTO v_tipo FROM public.categories c WHERE c.id = NEW.categoria_id FOR SHARE;
  IF v_tipo IS DISTINCT FROM 'business' THEN
    RAISE EXCEPTION 'STI I2: products.categoria_id=% referencia categoria tipo=% (exigido: business)',
      NEW.categoria_id, COALESCE(v_tipo, '(inexistente)') USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_sti_adicional_categoria_is_business()
RETURNS trigger LANGUAGE plpgsql
AS $$
DECLARE v_tipo text;
BEGIN
  IF NEW.aplica_categoria_id IS NULL THEN RETURN NEW; END IF;
  SELECT c.tipo INTO v_tipo FROM public.categories c WHERE c.id = NEW.aplica_categoria_id FOR SHARE;
  IF v_tipo IS DISTINCT FROM 'business' THEN
    RAISE EXCEPTION 'STI I3: adicionais.aplica_categoria_id=% referencia categoria tipo=% (exigido: business)',
      NEW.aplica_categoria_id, COALESCE(v_tipo, '(inexistente)') USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_sti_categoria_tipo_guard()
RETURNS trigger LANGUAGE plpgsql
AS $$
DECLARE v_n_products int; v_n_adic int; v_n_members int;
BEGIN
  IF NEW.tipo IS NOT DISTINCT FROM OLD.tipo THEN RETURN NEW; END IF;
  IF OLD.tipo = 'business' AND NEW.tipo = 'collection' THEN
    SELECT count(*) INTO v_n_products FROM public.products p WHERE p.categoria_id = OLD.id;
    IF v_n_products > 0 THEN
      RAISE EXCEPTION 'STI I4: categoria %(%) nao pode virar collection: % produto(s) a referenciam como categoria_id (I2)',
        OLD.id, OLD.nome, v_n_products USING ERRCODE = 'check_violation';
    END IF;
    SELECT count(*) INTO v_n_adic FROM public.adicionais a WHERE a.aplica_categoria_id = OLD.id;
    IF v_n_adic > 0 THEN
      RAISE EXCEPTION 'STI I4: categoria %(%) nao pode virar collection: % adicional(is) a referenciam como aplica_categoria_id (I3/D-I4-ADIC)',
        OLD.id, OLD.nome, v_n_adic USING ERRCODE = 'check_violation';
    END IF;
  ELSIF OLD.tipo = 'collection' AND NEW.tipo = 'business' THEN
    SELECT count(*) INTO v_n_members FROM public.product_collections pc WHERE pc.collection_id = OLD.id;
    IF v_n_members > 0 THEN
      RAISE EXCEPTION 'STI I4: categoria %(%) nao pode virar business: % membro(s) em product_collections a referenciam (I1)',
        OLD.id, OLD.nome, v_n_members USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    RAISE EXCEPTION 'STI I4: transicao de tipo nao suportada %->% (categoria %)', OLD.tipo, NEW.tipo, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

COMMIT;
