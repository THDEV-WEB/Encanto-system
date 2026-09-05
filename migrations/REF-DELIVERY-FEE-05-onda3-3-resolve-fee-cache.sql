-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- REF-DELIVERY-FEE-05 · Onda 3.3 — _resolve_delivery_fee passa a usar a distancia viaria AUTORITATIVA
-- (delivery_route_cache, gravado pela Edge Function na Onda 3.2) quando disponivel e fresca, caindo em
-- Haversine SQL (fallback tecnico, INTOCADO) quando nao ha cache/expirou.
--
-- ALTERACAO MINIMA E LOCALIZADA (conforme instrucao explicita): so' a origem do numero de km muda.
-- Bounding box de plausibilidade (GEO-INTEGRITY-01), localizacao de faixa, extrapolacao (Onda 1),
-- maquininha/adicional de pagamento (Onda 2), assinatura da funcao e o CONTRATO de create_order() —
-- tudo 100% preservado, nao tocado.
--
-- CHAVE DE LOOKUP: NUMERICA (store_id + origem/destino arredondados a 4 casas), nunca textual -- ver
-- comentario de cabecalho da migration da Onda 3.1 (evita divergencia de formatacao entre o
-- round(...)::text do Postgres e o Number.toString() do Deno). Deriva SEMPRE de v_lat_loja/v_lng_loja
-- (get_company_info, ja lido) e v_lat_end/v_lng_end (addresses, ja lido, escopado a p_store_id) --
-- NUNCA de nada que viesse do payload do client (create_order so passa p_endereco_id, nunca
-- coordenadas cruas) -- por construcao, nao ha caminho para o client "escolher" qual linha do cache
-- e' lida.
--
-- FRESCOR: 24 horas (TTL inicial aprovado, ver relatorio de design). Cache mais velho que isso e'
-- tratado exatamente como cache ausente -- cai no Haversine, nunca usa um valor desatualizado.
--
-- FONTE: o jsonb de retorno ganha 'distancia_fonte' ('rota'|'haversine_fallback') -- so' informativo,
-- ADITIVO -- create_order() ja le so' delivery_fee/maquininha_fee/adicional_pagamento_fee do retorno,
-- um campo a mais nao quebra nada nem exige tocar em create_order() (que permanece INTOCADO nesta
-- Onda, conforme instrucao).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
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
  v_dist_cache     numeric;
  v_fonte          text;
  v_faixa          jsonb;
  v_maior_faixa    jsonb;
  v_maior_ate      numeric;
  v_raio_bbox_km   numeric;
  v_incremento     numeric;
  v_km_extras      numeric;
  v_delivery_fee   numeric;
BEGIN
  IF p_retirada THEN
    -- retirada na loja: sem motoboy, sem maquininha -- mesma regra do client (montarResumoFinanceiro),
    -- nunca dependeu de distancia. REF-DELIVERY-FEE-05: adicional de pagamento tambem zerado aqui --
    -- mesma logica (sem motoboy, sem "levar/trazer troco/maquininha"). Zero ambiguidade, ignora
    -- qualquer coisa que o client mande.
    RETURN jsonb_build_object('delivery_fee', 0, 'maquininha_fee', 0, 'adicional_pagamento_fee', 0);
  END IF;

  v_config := public.get_delivery_fee_config(p_store_id);

  -- maquininha: puro lookup de tabela, independe de distancia/endereco -- fecha 100%. INTOCADO.
  v_maq := v_config->'maquininha';
  v_maq_ativo := COALESCE((v_maq->>'ativo')::boolean, false);
  v_maq_valor := COALESCE((v_maq->>'valor')::numeric, 0);
  IF v_maq_ativo AND p_payment_method IN ('cartao_debito', 'cartao_credito') THEN
    v_maquininha_fee := v_maq_valor;
  END IF;

  -- REF-DELIVERY-FEE-05: adicional de pagamento -- dinheiro/debito/credito, SO' EM ENTREGA (ja
  -- garantido por nao termos retornado no ramo p_retirada acima). Componente SEPARADO de maquininha
  -- (coexistem, nunca somados num campo so). Ausente em v_config -> default "ja nasce ligado" (mesmo
  -- precedente da REF-DELIVERY-FEE-01 original) -- ver cabecalho da migration.
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

  -- Cobranca automatica desligada no Admin -- mesmo fallback do client (status 'desativado'). So'
  -- afeta delivery_fee (distancia) -- maquininha/adicional de pagamento sao independentes disso,
  -- mesma regra ja existente pra maquininha.
  IF NOT COALESCE((v_config->>'ativo')::boolean, false) THEN
    RETURN jsonb_build_object('delivery_fee', 0, 'maquininha_fee', v_maquininha_fee, 'adicional_pagamento_fee', v_adicional_pagamento_fee);
  END IF;

  -- Sem endereco_id: nada para validar distancia -- mesmo fallback do client honesto
  -- (status 'sem_coordenadas' -> R$0 na taxa de distancia). Decisao explicita do dono (2026-08-29).
  IF p_endereco_id IS NULL THEN
    RETURN jsonb_build_object('delivery_fee', 0, 'maquininha_fee', v_maquininha_fee, 'adicional_pagamento_fee', v_adicional_pagamento_fee);
  END IF;

  -- Endereco escopado ao MESMO store_id (nunca de outra loja) -- mesma anti-enumeracao de
  -- _resolve_item_pricing: NOT FOUND cai no mesmo fallback silencioso de "sem coordenadas", nao
  -- revela se o id existe em outra loja.
  SELECT latitude, longitude INTO v_lat_end, v_lng_end
    FROM public.addresses
   WHERE id = p_endereco_id AND store_id = p_store_id;

  IF NOT FOUND OR v_lat_end IS NULL OR v_lng_end IS NULL THEN
    RETURN jsonb_build_object('delivery_fee', 0, 'maquininha_fee', v_maquininha_fee, 'adicional_pagamento_fee', v_adicional_pagamento_fee);
  END IF;

  v_company := public.get_company_info(p_store_id);
  v_lat_loja := NULLIF(v_company->>'lojaLat', '')::double precision;
  v_lng_loja := NULLIF(v_company->>'lojaLng', '')::double precision;

  -- Loja sem pino cadastrado (StatusLocalizacaoLoja ainda pendente, REF-DELIVERY-FEE-02) -- mesmo
  -- fallback do client (sem coordenadas da loja = sem distancia calculavel).
  IF v_lat_loja IS NULL OR v_lng_loja IS NULL THEN
    RETURN jsonb_build_object('delivery_fee', 0, 'maquininha_fee', v_maquininha_fee, 'adicional_pagamento_fee', v_adicional_pagamento_fee);
  END IF;

  -- REF-DELIVERY-FEE-05 · Onda 3.3: distancia viaria AUTORITATIVA via delivery_route_cache (gravado
  -- pela Edge Function route-distance, Onda 3.2), quando fresca (<=24h). Chave NUMERICA derivada
  -- SOMENTE de coordenadas ja lidas do banco acima (loja/endereco) -- nunca de payload do client.
  -- Cache ausente/expirado -> Haversine SQL (fallback tecnico ja existente, sem NENHUM fator de
  -- correcao/multiplicador).
  SELECT distance_km INTO v_dist_cache
    FROM public.delivery_route_cache
   WHERE store_id     = p_store_id
     AND origem_lat    = round(v_lat_loja::numeric, 4)
     AND origem_lng    = round(v_lng_loja::numeric, 4)
     AND destino_lat   = round(v_lat_end::numeric, 4)
     AND destino_lng   = round(v_lng_end::numeric, 4)
     AND perfil        = 'driving-car'
     AND atualizado_em > now() - interval '24 hours';

  IF v_dist_cache IS NOT NULL THEN
    v_dist_raw := v_dist_cache;
    v_fonte := 'rota';
  ELSE
    -- Haversine (km) -- mesma formula/precisao do dominio Address no client
    -- (src/address/utils/coordinates.js). INTOCADA -- fallback tecnico, nunca substituto comercial.
    v_dist_raw := 6371 * 2 * asin(sqrt(
        power(sin(radians(v_lat_end - v_lat_loja) / 2), 2) +
        cos(radians(v_lat_loja)) * cos(radians(v_lat_end)) *
        power(sin(radians(v_lng_end - v_lng_loja) / 2), 2)
    ));
    v_fonte := 'haversine_fallback';
  END IF;

  -- REF-DELIVERY-FEE-05 · Onda 1 (preservado): arredonda para 1 casa decimal ANTES de qualquer
  -- comparacao -- ver politica de precisao no cabecalho da migration da Onda 1.
  v_dist_km := round(v_dist_raw::numeric, 1);

  -- REF-ADDRESS-GEO-INTEGRITY-01 · Onda 2, Parte 1: bounding box de plausibilidade, ISOLADO POR
  -- TENANT. INTOCADO -- reavaliacao de base (Haversine vs viaria) e' a Onda 4 desta REF.
  v_maior_ate := (SELECT max((f->>'ate')::numeric) FROM jsonb_array_elements(COALESCE(v_config->'faixas', '[]'::jsonb)) f);
  v_raio_bbox_km := GREATEST(COALESCE(v_maior_ate, 0) * 3, 50);

  IF v_dist_km > v_raio_bbox_km THEN
    RAISE EXCEPTION 'coordenadas de entrega implausiveis para esta loja (% km, alem do raio maximo de % km)',
      v_dist_km, v_raio_bbox_km;
  END IF;

  -- localizarFaixa (regra pura, client): menor "ate" que seja >= distancia (faixas contiguas por
  -- design).
  SELECT f INTO v_faixa
    FROM jsonb_array_elements(COALESCE(v_config->'faixas', '[]'::jsonb)) f
   WHERE v_dist_km <= (f->>'ate')::numeric
   ORDER BY (f->>'ate')::numeric
   LIMIT 1;

  IF v_faixa IS NOT NULL THEN
    v_delivery_fee := COALESCE((v_faixa->>'valor')::numeric, 0);
  ELSE
    -- REF-DELIVERY-FEE-05 · Onda 1 (preservado): extrapolacao matematica acima da maior faixa
    -- cadastrada -- ver formula/justificativa completa no cabecalho da migration da Onda 1.
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
    'adicional_pagamento_fee', v_adicional_pagamento_fee,
    'distancia_fonte', v_fonte
  );
END;
$function$;

COMMIT;
