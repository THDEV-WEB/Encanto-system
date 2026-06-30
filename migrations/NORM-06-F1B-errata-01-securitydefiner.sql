-- NORM-06 · F1B · ERRATA-01 — funções STI viram SECURITY DEFINER (decoupla STI da RLS).
-- MOTIVO (regressão viva descoberta na revisão da NORM-06.1): as triggers STI usam SELECT ... categories ... FOR SHARE.
--   Sob o role 'authenticated' (admin) com RLS, o FOR SHARE numa tabela sem policy lockável (UPDATE/ALL) retorna
--   0 linhas -> a trigger vê tipo=(inexistente) -> rejeita TODA escrita que referencie categoria. Verificado:
--   authenticated INSERT/UPDATE de product com categoria_id falha com 'STI I2 ... (inexistente)'.
-- CORREÇÃO: SECURITY DEFINER faz o FOR SHARE rodar como dono (postgres, que bypassa RLS) -> enxerga/trava a
--   categoria independentemente do role do escritor. Preserva o lock (TOCTOU fechado). search_path fixado
--   (segurança de SECURITY DEFINER; nomes já totalmente qualificados public.*). Sem dynamic SQL, só leitura+RAISE.
-- ATÔMICO. CREATE OR REPLACE FUNCTION (idempotente); os triggers referenciam por nome -> usam a nova versão.
-- Rollback: migrations/NORM-06-F1B-errata-01-securitydefiner-rollback.sql (volta a SECURITY INVOKER).
BEGIN;

CREATE OR REPLACE FUNCTION public.trg_sti_pc_collection_is_collection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
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
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
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
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
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
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
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

-- Privilégios mínimos: trigger functions disparam via trigger sem precisar de EXECUTE p/ o role que escreve
--   (verificado: REVOKE não quebra o disparo). Remove EXECUTE de PUBLIC e dos roles Supabase -> não chamáveis
--   diretamente (defesa em profundidade p/ SECURITY DEFINER; de todo modo, trigger function chamada fora de
--   contexto de trigger já erra). REVOKE após o CREATE garante o estado final mesmo se o Supabase re-conceder.
REVOKE EXECUTE ON FUNCTION public.trg_sti_pc_collection_is_collection()    FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.trg_sti_product_categoria_is_business()  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.trg_sti_adicional_categoria_is_business() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.trg_sti_categoria_tipo_guard()           FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
