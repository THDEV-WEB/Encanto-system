-- ROLLBACK · REF-PROMO-01 · Onda 1
-- Restaura _resolve_item_pricing() para o corpo EXATO anterior (REF-PRICE-SOURCE-01-onda1, confirmado
-- byte-a-byte via pg_get_functiondef em producao antes desta REF) e remove a constraint nova.

BEGIN;

CREATE OR REPLACE FUNCTION public._resolve_item_pricing(
  p_store_id     uuid,
  p_product_id   uuid,
  p_tamanho_label text,
  p_adicionais   jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_prod          record;
  v_tamanho       jsonb;
  v_base          numeric;
  v_cota          numeric;
  v_usados_gratis int := 0;
  v_soma_ads      numeric := 0;
  v_ads_out       jsonb := '[]'::jsonb;
  v_ids_vistos    uuid[] := '{}';
  v_ad_elem       jsonb;
  v_ad_id         uuid;
  v_ad            record;
  v_eh_gratis     boolean;
  v_preco_ad      numeric;
BEGIN
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'produto invalido';
  END IF;

  SELECT preco, preco_promo, tamanhos, adicionais_gratis
    INTO v_prod
    FROM public.products
   WHERE id = p_product_id AND store_id = p_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'produto invalido';
  END IF;

  IF jsonb_typeof(v_prod.tamanhos) = 'array' AND jsonb_array_length(v_prod.tamanhos) > 0 THEN
    SELECT t INTO v_tamanho
      FROM jsonb_array_elements(v_prod.tamanhos) t
     WHERE p_tamanho_label IS NOT NULL AND (t->>'label') = p_tamanho_label
     LIMIT 1;
    IF v_tamanho IS NULL THEN
      v_tamanho := v_prod.tamanhos->0;
    END IF;

    v_base := NULLIF(COALESCE((v_tamanho->>'preco')::numeric, (v_tamanho->>'price')::numeric), 0);
    IF v_base IS NULL THEN v_base := v_prod.preco; END IF;

    v_cota := COALESCE((v_tamanho->>'adicionais_gratis')::numeric, v_prod.adicionais_gratis, 0);
  ELSE
    v_base := CASE WHEN v_prod.preco_promo IS NOT NULL AND v_prod.preco_promo <> 0
                   THEN v_prod.preco_promo ELSE v_prod.preco END;
    v_cota := COALESCE(v_prod.adicionais_gratis, 0);
  END IF;

  IF p_adicionais IS NOT NULL AND jsonb_typeof(p_adicionais) = 'array' THEN
    FOR v_ad_elem IN SELECT value FROM jsonb_array_elements(p_adicionais) LOOP
      v_ad_id := NULLIF(btrim(v_ad_elem->>'id'), '')::uuid;
      IF v_ad_id IS NULL THEN
        RAISE EXCEPTION 'adicional invalido';
      END IF;
      IF v_ad_id = ANY(v_ids_vistos) THEN
        CONTINUE;
      END IF;
      v_ids_vistos := array_append(v_ids_vistos, v_ad_id);

      SELECT id, nome, tipo, preco, grupo, subgrupo_label INTO v_ad
        FROM public.adicionais
       WHERE id = v_ad_id AND store_id = p_store_id AND ativo = true;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'adicional invalido';
      END IF;

      v_eh_gratis := (v_ad.tipo = 'gratis' OR v_ad.preco = 0);
      IF v_eh_gratis THEN
        v_usados_gratis := v_usados_gratis + 1;
        IF v_usados_gratis <= v_cota THEN
          v_preco_ad := 0;
        ELSE
          v_preco_ad := CASE WHEN v_ad.preco <> 0 THEN v_ad.preco ELSE 2.00 END;
        END IF;
      ELSE
        v_preco_ad := v_ad.preco;
      END IF;

      v_soma_ads := v_soma_ads + v_preco_ad;
      v_ads_out := v_ads_out || jsonb_build_array(jsonb_build_object(
        'id', v_ad.id, 'nome', v_ad.nome, 'preco', v_preco_ad,
        'tipo', v_ad.tipo, 'grupo', v_ad.grupo, 'subgrupo_label', v_ad.subgrupo_label
      ));
    END LOOP;
  END IF;

  RETURN jsonb_build_object('preco_unitario', v_base + v_soma_ads, 'adicionais', v_ads_out);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._resolve_item_pricing(uuid,uuid,text,jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._resolve_item_pricing(uuid,uuid,text,jsonb) FROM PUBLIC;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_preco_promo_check;

COMMIT;
