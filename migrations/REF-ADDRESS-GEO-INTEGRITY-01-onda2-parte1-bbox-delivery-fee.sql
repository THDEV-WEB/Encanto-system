-- REF-ADDRESS-GEO-INTEGRITY-01 · Onda 2, Parte 1 -- bounding box de plausibilidade geografica em
-- _resolve_delivery_fee(), isolado por tenant. Mitigacao parcial, NAO definitiva -- ver ressalva no
-- fim deste comentario e no ADR desta REF.
--
-- CAUSA RAIZ (auditoria Onda 1, 2026-08-30, reproduzida com dados descartaveis no projeto E2E,
-- BEGIN...ROLLBACK, 14/14 testes -- nunca em producao): save_structured_address grava latitude/
-- longitude exatamente como o client manda, sem cruzar contra rua/bairro/cidade/cep. _resolve_
-- delivery_fee (REF-DELIVERY-FEE-04) usa essas coordenadas como fonte autoritativa de distancia/
-- taxa, sem revalidar. Provado: endereco textual real e distante + coordenada fake perto da loja ->
-- servidor cobra a faixa barata; coordenada fake "fora de alcance" -> servidor cobra R$0,00 mesmo
-- para endereco real vizinho da loja (ate 100% da taxa evitada, por pedido).
--
-- ANALISE DE DADOS REAIS que embasa o limite escolhido (leitura, 2026-08-30, projeto de producao --
-- SOMENTE SELECT, nenhuma escrita): a UNICA loja com delivery_fee_config completo hoje (Encanto)
-- tem faixas de 0 a 21km (17 faixas, R$10 a R$42). Nenhuma outra loja ativa tem config equivalente
-- para comparar. Modelo de negocio da plataforma e' entrega LOCAL (mesma cidade/regiao, nivel Anota-
-- Ai/Pedidos10/Leva-la) -- nenhum cenario legitimo de delivery de comida opera a dezenas/centenas de
-- km do estabelecimento.
--
-- REGRA ADOTADA (isolada por tenant, sem numero fixo global hardcoded):
--   raio_bbox_km = GREATEST(maior "ate" configurado NAS PROPRIAS faixas da loja * 3, 50)
--
--   - Multiplicador 3x sobre a maior faixa: da margem generosa para (a) imprecisao de geocoding
--     legitima (o pior caso ja documentado no codigo, REF-DELIVERY-FEE-02 "Rio Itajai-Acu", foi da
--     ordem de poucos km, nunca dezenas) e (b) a loja aumentar sua area de cobertura no futuro
--     ajustando so as faixas, sem precisar de nova migration. Para a Encanto hoje: 21km * 3 = 63km.
--   - Piso de 50km: protege lojas novas/pequenas com poucas faixas curtas configuradas (ex.: uma
--     loja que so define ate 3km) de um bbox apertado demais para o ruido normal de GPS/geocoding
--     em area urbana.
--   - Acima deste raio, a distancia so pode ser erro de geocoding em escala impossivel para este
--     modelo de negocio OU coordenada deliberadamente manipulada -- nunca um pedido real.
--
-- COMPORTAMENTO: dentro do raio (incluindo "fora de alcance" das faixas pagas, ate o raio bbox) ->
-- ZERO mudanca, delivery_fee=0 continua sendo o fallback aceito (decisao de negocio ja tomada na
-- REF-DELIVERY-FEE-04 Onda 1). ALEM do raio bbox -> _resolve_delivery_fee lanca EXCEPTION, capturada
-- pelo "exception when others" ja existente em create_order() (mesmo padrao de erro ja usado por
-- _resolve_item_pricing para produto invalido) -- create_order() NAO e alterado por esta migration,
-- so passa a poder receber esse erro novo do mesmo jeito que ja recebe qualquer outro.
--
-- RESSALVA EXPLICITA (nao e' solucao definitiva, documentado tambem no ADR desta REF): esta
-- mitigacao SO pega manipulacao GROSSEIRA (coordenada fora do raio plausivel da loja). O ataque
-- "fino" -- endereco textual distante com coordenada fake que ainda cai DENTRO do raio real de
-- entrega da loja (ex.: T2 da auditoria Onda 1: endereco a ~12km mascarado como ~0.9km, faixa
-- barata) -- CONTINUA nao coberto. Fechar esse caso exigiria validar o TEXTO do endereco contra a
-- coordenada (geocodificacao ou base de CEP/bairro), deliberadamente fora do escopo desta Onda 2.
--
-- Testes: scripts/address-geo-integrity-01-onda2-test.mjs (projeto E2E dedicado, BEGIN...ROLLBACK).
-- Nao altera create_order(), a regra das faixas, o calculo Haversine, nem nenhuma outra REF.

BEGIN;

CREATE OR REPLACE FUNCTION public._resolve_delivery_fee(
  p_store_id       uuid,
  p_retirada       boolean,
  p_payment_method text,
  p_endereco_id    uuid
) RETURNS jsonb
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
  v_lat_loja       double precision;
  v_lng_loja       double precision;
  v_lat_end        double precision;
  v_lng_end        double precision;
  v_dist_km        double precision;
  v_faixa          jsonb;
  v_maior_ate      numeric;
  v_raio_bbox_km   numeric;
BEGIN
  IF p_retirada THEN
    -- retirada na loja: sem motoboy, sem maquininha -- mesma regra do client (montarResumoFinanceiro),
    -- nunca dependeu de distancia. Zero ambiguidade, ignora qualquer coisa que o client mande.
    RETURN jsonb_build_object('delivery_fee', 0, 'maquininha_fee', 0);
  END IF;

  v_config := public.get_delivery_fee_config(p_store_id);

  -- maquininha: puro lookup de tabela, independe de distancia/endereco -- fecha 100%.
  v_maq := v_config->'maquininha';
  v_maq_ativo := COALESCE((v_maq->>'ativo')::boolean, false);
  v_maq_valor := COALESCE((v_maq->>'valor')::numeric, 0);
  IF v_maq_ativo AND p_payment_method IN ('cartao_debito', 'cartao_credito') THEN
    v_maquininha_fee := v_maq_valor;
  END IF;

  -- Cobranca automatica desligada no Admin -- mesmo fallback do client (status 'desativado').
  IF NOT COALESCE((v_config->>'ativo')::boolean, false) THEN
    RETURN jsonb_build_object('delivery_fee', 0, 'maquininha_fee', v_maquininha_fee);
  END IF;

  -- Sem endereco_id: nada para validar distancia -- mesmo fallback do client honesto
  -- (status 'sem_coordenadas' -> R$0). Decisao explicita do dono (2026-08-29).
  IF p_endereco_id IS NULL THEN
    RETURN jsonb_build_object('delivery_fee', 0, 'maquininha_fee', v_maquininha_fee);
  END IF;

  -- Endereco escopado ao MESMO store_id (nunca de outra loja) -- mesma anti-enumeracao de
  -- _resolve_item_pricing: NOT FOUND cai no mesmo fallback silencioso de "sem coordenadas", nao
  -- revela se o id existe em outra loja.
  SELECT latitude, longitude INTO v_lat_end, v_lng_end
    FROM public.addresses
   WHERE id = p_endereco_id AND store_id = p_store_id;

  IF NOT FOUND OR v_lat_end IS NULL OR v_lng_end IS NULL THEN
    RETURN jsonb_build_object('delivery_fee', 0, 'maquininha_fee', v_maquininha_fee);
  END IF;

  v_company := public.get_company_info(p_store_id);
  v_lat_loja := NULLIF(v_company->>'lojaLat', '')::double precision;
  v_lng_loja := NULLIF(v_company->>'lojaLng', '')::double precision;

  -- Loja sem pino cadastrado (StatusLocalizacaoLoja ainda pendente, REF-DELIVERY-FEE-02) -- mesmo
  -- fallback do client (sem coordenadas da loja = sem distancia calculavel).
  IF v_lat_loja IS NULL OR v_lng_loja IS NULL THEN
    RETURN jsonb_build_object('delivery_fee', 0, 'maquininha_fee', v_maquininha_fee);
  END IF;

  -- Haversine (km) -- mesma formula/precisao do dominio Address no client
  -- (src/address/utils/coordinates.js). So' straight-line: o client pode ter mostrado a distancia de
  -- ROTA VIARIA real (HeiGIT); perto de uma fronteira de faixa o valor cobrado pode divergir
  -- ligeiramente do exibido no checkout -- ressalva conhecida e aceita (ver cabecalho do arquivo).
  v_dist_km := 6371 * 2 * asin(sqrt(
      power(sin(radians(v_lat_end - v_lat_loja) / 2), 2) +
      cos(radians(v_lat_loja)) * cos(radians(v_lat_end)) *
      power(sin(radians(v_lng_end - v_lng_loja) / 2), 2)
  ));

  -- REF-ADDRESS-GEO-INTEGRITY-01 · Onda 2, Parte 1: bounding box de plausibilidade, ISOLADO POR
  -- TENANT (deriva das PROPRIAS faixas da loja, nunca um raio fixo global) -- ver justificativa
  -- completa e dados reais no cabecalho desta migration. So' bloqueia manipulacao GROSSEIRA; o
  -- ataque fino dentro do raio real de entrega continua sendo limitacao conhecida (mesmo cabecalho).
  v_maior_ate := (SELECT max((f->>'ate')::numeric) FROM jsonb_array_elements(COALESCE(v_config->'faixas', '[]'::jsonb)) f);
  v_raio_bbox_km := GREATEST(COALESCE(v_maior_ate, 0) * 3, 50);

  IF v_dist_km > v_raio_bbox_km THEN
    RAISE EXCEPTION 'coordenadas de entrega implausiveis para esta loja (% km, alem do raio maximo de % km)',
      round(v_dist_km::numeric, 1), v_raio_bbox_km;
  END IF;

  -- localizarFaixa (regra pura, client): menor "ate" que seja >= distancia (faixas contiguas por
  -- design). Distancia > maior "ate" cadastrado -> fora de alcance, mesmo fallback R$0.
  SELECT f INTO v_faixa
    FROM jsonb_array_elements(COALESCE(v_config->'faixas', '[]'::jsonb)) f
   WHERE v_dist_km <= (f->>'ate')::numeric
   ORDER BY (f->>'ate')::numeric
   LIMIT 1;

  IF v_faixa IS NULL THEN
    RETURN jsonb_build_object('delivery_fee', 0, 'maquininha_fee', v_maquininha_fee);
  END IF;

  RETURN jsonb_build_object('delivery_fee', COALESCE((v_faixa->>'valor')::numeric, 0), 'maquininha_fee', v_maquininha_fee);
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── VERIFICACAO (rodar manualmente apos aplicar) ──────────────────────────────────────────────────
-- 1. Endereco legitimo dentro do raio bbox -> delivery_fee calculado normalmente, sem mudanca.
-- 2. Endereco com coordenada a centenas de km da loja -> create_order retorna ok:false com o erro
--    'coordenadas de entrega implausiveis...' (via exception when others ja existente).
-- 3. Endereco "fora de alcance" das faixas pagas mas DENTRO do raio bbox -> delivery_fee=0, IDENTICO
--    ao comportamento anterior a esta migration (decisao de negocio preservada).
