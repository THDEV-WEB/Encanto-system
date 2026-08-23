-- REF-STORE-ONBOARD-01 · Onda 3 (P3 + P1) — auditoria aprovada 2026-08-22/23.
-- Baseline: Onda 2 fechada/VERDE (commit d271354), 2 tenants reais em producao (Encanto, Aquarios Bar).
-- NAO recria get_store_by_domain/resolve_store_from_origin/provision_store/link_store_admin/
-- platform_list_tenants/platform_tenant_detail/platform_set_store_status/platform_unlink_store_admin --
-- todas continuam exatamente como estao (P2 desta Onda e' 100% frontend, sem migration -- ver
-- src/components/admin/PlatformTenants.jsx).
--
-- Objetivo desta migration:
--   1. platform_set_store_dominio(p_store_id, p_dominio) -- P3: self-service de dominio pelo Platform
--      Console (hoje so' via SQL manual, como no rename da Aquarios Bar). NAO chamada nesta migration
--      contra nenhuma loja real -- Encanto continua com seu dominio legado intacto, Aquarios Bar continua
--      com o dela, por decisao explicita do dono ("Nao migrar Encanto para o modelo novo").
--   2. platform_clone_catalog(p_source_store_id, p_target_store_id) -- P1: ferramenta de
--      clonagem/seed de catalogo (categories/products/adicionais/product_collections) pra loja nova, com
--      remapeamento de id (categories.id e products.id sao PK GLOBAL, nao por loja -- nunca reusa o id da
--      origem) e SEM copiar pedidos/customers/addresses/autenticacao/credenciais/segredos -- essas tabelas
--      nem sao tocadas por esta funcao. So' clona pra um catalogo VAZIO (semeadura, nunca merge). Produtos
--      clonados nascem com disponivel=false (mesmo espirito do "seed neutro" de company_info -- loja nova
--      nao deve aparecer com itens comprariveis de verdade ate o dono revisar cada um). Imagens: URL
--      copiada como referencia (aponta pro mesmo arquivo do Storage da loja de origem ate o novo tenant
--      trocar) -- nao duplica o objeto fisico no Storage, decisao registrada aqui, nao e' lacuna.

BEGIN;

-- ===== 1. platform_set_store_dominio: P3 -- edita o dominio de uma loja pelo Platform Console. =====
CREATE OR REPLACE FUNCTION public.platform_set_store_dominio(p_store_id uuid, p_dominio text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_dominio text;
  v_nome    text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'apenas o super admin da plataforma pode alterar o dominio de uma loja'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store_id) THEN
    RAISE EXCEPTION 'loja nao encontrada: %', p_store_id USING ERRCODE = '22023';
  END IF;

  -- vazio/NULL limpa o dominio personalizado -- a loja volta a resolver so pelo padrao automatico
  -- ({slug}.lojas.valionsistemas.com.br via 3o ramo do COALESCE em get_store_by_domain), sem ficar
  -- irresolvivel: nunca e' um estado de erro.
  v_dominio := NULLIF(lower(trim(both from coalesce(p_dominio, ''))), '');

  IF v_dominio IS NOT NULL THEN
    IF length(v_dominio) > 255
       OR v_dominio !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' THEN
      RAISE EXCEPTION 'dominio invalido: % (use um hostname valido, ex.: minhaloja.com.br)', p_dominio
        USING ERRCODE = '22023';
    END IF;
  END IF;

  BEGIN
    UPDATE public.stores SET dominio = v_dominio WHERE id = p_store_id RETURNING nome INTO v_nome;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'este dominio ja esta em uso por outra loja: %', v_dominio USING ERRCODE = '23505';
  END;

  RETURN jsonb_build_object('store_id', p_store_id, 'nome', v_nome, 'dominio', v_dominio);
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_set_store_dominio(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.platform_set_store_dominio(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_set_store_dominio(uuid, text) TO authenticated;

-- ===== 2. platform_clone_catalog: P1 -- clonagem/seed de catalogo pra loja nova (catalogo vazio). =====
CREATE OR REPLACE FUNCTION public.platform_clone_catalog(p_source_store_id uuid, p_target_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_map_cat     jsonb := '{}'::jsonb; -- old category id (text) -> new category id (text)
  v_map_prod    jsonb := '{}'::jsonb; -- old product id (text)  -> new product id (text)
  v_cat         record;
  v_prod        record;
  v_ad          record;
  v_pc          record;
  v_new_cat_id  text;
  v_new_prod_id uuid;
  v_n_cat  int := 0;
  v_n_prod int := 0;
  v_n_ad   int := 0;
  v_n_pc   int := 0;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'apenas o super admin da plataforma pode clonar catalogo entre lojas'
      USING ERRCODE = '42501';
  END IF;

  IF p_source_store_id = p_target_store_id THEN
    RAISE EXCEPTION 'loja de origem e destino nao podem ser a mesma' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_source_store_id) THEN
    RAISE EXCEPTION 'loja de origem nao encontrada: %', p_source_store_id USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_target_store_id) THEN
    RAISE EXCEPTION 'loja de destino nao encontrada: %', p_target_store_id USING ERRCODE = '22023';
  END IF;

  -- Seguranca: so clona pra um catalogo VAZIO -- clonagem e' semeadura de loja nova, nunca merge com
  -- catalogo que a loja de destino ja tenha criado por conta propria.
  IF EXISTS (SELECT 1 FROM public.categories WHERE store_id = p_target_store_id)
     OR EXISTS (SELECT 1 FROM public.products WHERE store_id = p_target_store_id) THEN
    RAISE EXCEPTION 'a loja de destino ja tem catalogo proprio -- clonagem so e permitida em catalogo vazio'
      USING ERRCODE = '22023';
  END IF;

  -- 1) categories -- id sempre NOVO (categories.id e' PK global, nao por loja -- nunca reusa o id da
  -- origem, senao colidiria com a linha original). Mapa old->new alimenta os remapeamentos abaixo.
  FOR v_cat IN SELECT * FROM public.categories WHERE store_id = p_source_store_id ORDER BY ordem, nome LOOP
    v_new_cat_id := gen_random_uuid()::text;
    v_map_cat := v_map_cat || jsonb_build_object(v_cat.id, v_new_cat_id);
    INSERT INTO public.categories (
      id, nome, ordem, ativo, icone, cor, slug, descricao, imagem, banner, tipo, estrategia,
      definicao, starts_at, ends_at, store_id
    ) VALUES (
      v_new_cat_id, v_cat.nome, v_cat.ordem, v_cat.ativo, v_cat.icone, v_cat.cor, v_cat.slug,
      v_cat.descricao, v_cat.imagem, v_cat.banner, v_cat.tipo, v_cat.estrategia,
      v_cat.definicao, v_cat.starts_at, v_cat.ends_at, p_target_store_id
    );
    v_n_cat := v_n_cat + 1;
  END LOOP;

  -- 2) products -- id novo, categoria_id/categoria_ids remapeados pro novo id (nunca aponta de volta pra
  -- categoria da loja de origem). disponivel FORCADO false -- loja nova nao aparenta operacional de
  -- verdade ate o dono revisar/ativar cada item (mesmo espirito do seed neutro de company_info).
  FOR v_prod IN SELECT * FROM public.products WHERE store_id = p_source_store_id LOOP
    v_new_prod_id := gen_random_uuid();
    v_map_prod := v_map_prod || jsonb_build_object(v_prod.id::text, v_new_prod_id::text);
    INSERT INTO public.products (
      id, nome, descricao, preco, image_url, categoria_id, preco_promo, imagem_url, disponivel,
      adicionais_gratis, grupos_ad, upsell_bebida, badge, destaque, ordem, tamanhos, composicao,
      categoria_ids, store_id
    ) VALUES (
      v_new_prod_id, v_prod.nome, v_prod.descricao, v_prod.preco, v_prod.image_url,
      v_map_cat ->> v_prod.categoria_id,
      v_prod.preco_promo, v_prod.imagem_url, false,
      v_prod.adicionais_gratis, v_prod.grupos_ad, v_prod.upsell_bebida, v_prod.badge, v_prod.destaque,
      v_prod.ordem, v_prod.tamanhos, v_prod.composicao,
      (SELECT array_agg(v_map_cat ->> elem) FROM unnest(v_prod.categoria_ids) AS elem WHERE v_map_cat ? elem),
      p_target_store_id
    );
    v_n_prod := v_n_prod + 1;
  END LOOP;

  -- 3) adicionais -- id novo, aplica_categoria_id remapeado (NULL = aplica a todas, preservado).
  FOR v_ad IN SELECT * FROM public.adicionais WHERE store_id = p_source_store_id LOOP
    INSERT INTO public.adicionais (
      id, nome, grupo, tipo, preco, ativo, ordem, aplica_categoria_id, descricao, subgrupo_label, store_id
    ) VALUES (
      gen_random_uuid(), v_ad.nome, v_ad.grupo, v_ad.tipo, v_ad.preco, v_ad.ativo, v_ad.ordem,
      v_map_cat ->> v_ad.aplica_categoria_id, v_ad.descricao, v_ad.subgrupo_label, p_target_store_id
    );
    v_n_ad := v_n_ad + 1;
  END LOOP;

  -- 4) product_collections -- so clona o vinculo se AMBOS os lados (produto e colecao) foram clonados
  -- com sucesso (map contem as duas chaves) -- nunca cria referencia pra id da loja de origem.
  FOR v_pc IN SELECT * FROM public.product_collections WHERE store_id = p_source_store_id LOOP
    IF (v_map_prod ? v_pc.product_id::text) AND (v_map_cat ? v_pc.collection_id) THEN
      INSERT INTO public.product_collections (id, product_id, collection_id, ordem, fixado, store_id)
      VALUES (
        gen_random_uuid(), (v_map_prod ->> v_pc.product_id::text)::uuid, v_map_cat ->> v_pc.collection_id,
        v_pc.ordem, v_pc.fixado, p_target_store_id
      );
      v_n_pc := v_n_pc + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'source_store_id', p_source_store_id, 'target_store_id', p_target_store_id,
    'categorias', v_n_cat, 'produtos', v_n_prod, 'adicionais', v_n_ad, 'colecoes', v_n_pc
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_clone_catalog(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.platform_clone_catalog(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_clone_catalog(uuid, uuid) TO authenticated;

COMMIT;

-- Expoe as novas funcoes na API PostgREST imediatamente.
NOTIFY pgrst, 'reload schema';
