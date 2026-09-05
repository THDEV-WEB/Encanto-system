-- Rollback de REF-DELIVERY-FEE-05-onda3-3-resolve-fee-cache.sql — restaura _resolve_delivery_fee
-- EXATAMENTE como estava antes desta Onda (confirmado por introspeccao real do banco, 2026-09-04/05,
-- byte-a-byte identico entre producao e E2E antes desta migration): Haversine sempre, sem
-- delivery_route_cache, sem 'distancia_fonte' no retorno.
BEGIN;

CREATE OR REPLACE FUNCTION public._resolve_delivery_fee(p_store_id uuid, p_retirada boolean, p_payment_method text, p_endereco_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_config         jsonb;
  v_company        jsonb;
  v_maq            jsonb;
  v_maq_ativo      boolean;
  v_maq_valor      numeric;
  v_maquininha_fee numeric := 0;
  v_adic           jsonb;
  v_adic_ativo     boolean;
  v_adic_valor     numeric;
  v_adicional_pagamento_fee numeric := 0;
  v_lat_loja       double precision;
  v_lng_loja       double precision;
  v_lat_end        double precision;
  v_lng_end        double precision;
  v_dist_raw       double precision;
  v_dist_km        numeric;
  v_faixa          jsonb;
  v_maior_faixa    jsonb;
  v_maior_ate      numeric;
  v_raio_bbox_km   numeric;
  v_incremento     numeric;
  v_km_extras      numeric;
  v_delivery_fee   numeric;
BEGIN
  IF p_retirada THEN
    RETURN jsonb_build_object('delivery_fee', 0, 'maquininha_fee', 0, 'adicional_pagamento_fee', 0);
  END IF;

  v_config := public.get_delivery_fee_config(p_store_id);

  v_maq := v_config->'maquininha';
  v_maq_ativo := COALESCE((v_maq->>'ativo')::boolean, false);
  v_maq_valor := COALESCE((v_maq->>'valor')::numeric, 0);
  IF v_maq_ativo AND p_payment_method IN ('cartao_debito', 'cartao_credito') THEN
    v_maquininha_fee := v_maq_valor;
  END IF;

  v_adic := v_config->'adicionalPagamento';
  IF v_adic IS NULL THEN
    v_adic_ativo := true;
    v_adic_valor := 2.00;
  ELSE
    v_adic_ativo := COALESCE((v_adic->>'ativo')::boolean, true);
    v_adic_valor := COALESCE((v_adic->>'valor')::numeric, 2.00);
  END IF;
  IF v_adic_ativo AND p_payment_method IN ('dinheiro', 'cartao_debito', 'cartao_credito') THEN
    v_adicional_pagamento_fee := v_adic_valor;
  END IF;

  IF NOT COALESCE((v_config->>'ativo')::boolean, false) THEN
    RETURN jsonb_build_object('delivery_fee', 0, 'maquininha_fee', v_maquininha_fee, 'adicional_pagamento_fee', v_adicional_pagamento_fee);
  END IF;

  IF p_endereco_id IS NULL THEN
    RETURN jsonb_build_object('delivery_fee', 0, 'maquininha_fee', v_maquininha_fee, 'adicional_pagamento_fee', v_adicional_pagamento_fee);
  END IF;

  SELECT latitude, longitude INTO v_lat_end, v_lng_end
    FROM public.addresses
   WHERE id = p_endereco_id AND store_id = p_store_id;

  IF NOT FOUND OR v_lat_end IS NULL OR v_lng_end IS NULL THEN
    RETURN jsonb_build_object('delivery_fee', 0, 'maquininha_fee', v_maquininha_fee, 'adicional_pagamento_fee', v_adicional_pagamento_fee);
  END IF;

  v_company := public.get_company_info(p_store_id);
  v_lat_loja := NULLIF(v_company->>'lojaLat', '')::double precision;
  v_lng_loja := NULLIF(v_company->>'lojaLng', '')::double precision;

  IF v_lat_loja IS NULL OR v_lng_loja IS NULL THEN
    RETURN jsonb_build_object('delivery_fee', 0, 'maquininha_fee', v_maquininha_fee, 'adicional_pagamento_fee', v_adicional_pagamento_fee);
  END IF;

  v_dist_raw := 6371 * 2 * asin(sqrt(
      power(sin(radians(v_lat_end - v_lat_loja) / 2), 2) +
      cos(radians(v_lat_loja)) * cos(radians(v_lat_end)) *
      power(sin(radians(v_lng_end - v_lng_loja) / 2), 2)
  ));

  v_dist_km := round(v_dist_raw::numeric, 1);

  v_maior_ate := (SELECT max((f->>'ate')::numeric) FROM jsonb_array_elements(COALESCE(v_config->'faixas', '[]'::jsonb)) f);
  v_raio_bbox_km := GREATEST(COALESCE(v_maior_ate, 0) * 3, 50);

  IF v_dist_km > v_raio_bbox_km THEN
    RAISE EXCEPTION 'coordenadas de entrega implausiveis para esta loja (% km, alem do raio maximo de % km)',
      v_dist_km, v_raio_bbox_km;
  END IF;

  SELECT f INTO v_faixa
    FROM jsonb_array_elements(COALESCE(v_config->'faixas', '[]'::jsonb)) f
   WHERE v_dist_km <= (f->>'ate')::numeric
   ORDER BY (f->>'ate')::numeric
   LIMIT 1;

  IF v_faixa IS NOT NULL THEN
    v_delivery_fee := COALESCE((v_faixa->>'valor')::numeric, 0);
  ELSE
    v_maior_faixa := (
      SELECT f FROM jsonb_array_elements(COALESCE(v_config->'faixas', '[]'::jsonb)) f
      ORDER BY (f->>'ate')::numeric DESC LIMIT 1
    );
    v_incremento := (v_config->>'incrementoAcimaFaixas')::numeric;
    IF v_maior_faixa IS NOT NULL AND v_incremento IS NOT NULL AND v_incremento > 0 THEN
      v_km_extras := ceil(v_dist_km - (v_maior_faixa->>'ate')::numeric);
      v_delivery_fee := COALESCE((v_maior_faixa->>'valor')::numeric, 0) + v_incremento * v_km_extras;
    ELSE
      RETURN jsonb_build_object('delivery_fee', 0, 'maquininha_fee', v_maquininha_fee, 'adicional_pagamento_fee', v_adicional_pagamento_fee);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'delivery_fee', v_delivery_fee,
    'maquininha_fee', v_maquininha_fee,
    'adicional_pagamento_fee', v_adicional_pagamento_fee
  );
END;
$function$;

COMMIT;
