-- REF-DELIVERY-FEE-05 · Onda 1 -- tabela comercial OFICIAL + extrapolacao matematica acima do teto.
--
-- ACHADO DE AUDITORIA (REF-DELIVERY-FEE-05, ja fechada): a tabela de faixas ate' entao cadastrada
-- (0-5=R$10, 5.1-6=R$12, 6.1-7=R$14, ...) NUNCA foi a intencao comercial real do dono -- era so' um
-- modelo/exemplo herdado da implementacao original (REF-DELIVERY-FEE-01, 2026-08-05). Provado com 2
-- casos reais: 4,5km deveria custar R$12 (a tabela antiga cobrava R$10) e 5,7km deveria custar R$14
-- (a tabela antiga cobrava R$12).
--
-- REGRA COMERCIAL OFICIAL (fornecida pelo dono, 2026-09-04):
--   0,0-4,0km=R$10  4,1-5,0km=R$12  5,1-7,0km=R$14  7,1-8,0km=R$16  8,1-9,0km=R$18  9,1-10,0km=R$20
--   10,1-11,0km=R$22  11,1-12,0km=R$24  12,1-13,0km=R$26  13,1-14,0km=R$28  14,1-15,0km=R$30
--   15,1-16,0km=R$32  16,1-17,0km=R$34  17,1-18,0km=R$36  18,1-19,0km=R$38  19,1-20,0km=R$40
-- A partir de 7km, a tabela ja seguia (e continua seguindo) um padrao uniforme: +R$2,00 a cada +1km.
-- Essa progressao NAO termina em 20km -- 20km e' so' onde a lista EDITAVEL do Admin para de listar
-- faixas, nunca um teto comercial real. Acima disso, a mesma progressao continua para sempre:
--   20,1-21,0km=R$42  21,1-22,0km=R$44  22,1-23,0km=R$46  23,1-24,0km=R$48  24,1-25,0km=R$50  ...
-- Formalizado como `incrementoAcimaFaixas` (R$/km, novo campo na config, default 2.00) em vez de
-- centenas de faixas hardcoded -- ver resolverTaxaPorDistancia em deliveryFeeRules.js (client) e o
-- bloco de extrapolacao em _resolve_delivery_fee abaixo (servidor), formulas IDENTICAS.
--
-- COMPORTAMENTO ANTIGO SUBSTITUIDO: distancia acima da maior faixa cadastrada deixa de cair
-- incondicionalmente em "fora_de_alcance"/R$0 -- so' cai nesse fallback se `incrementoAcimaFaixas`
-- estiver ausente/invalido/<=0 (defesa em profundidade, nunca deveria ocorrer com o default desta
-- migration) ou se nao houver NENHUMA faixa cadastrada.
--
-- POLITICA DE PRECISAO/ARREDONDAMENTO (decisao explicita desta onda, documentada tambem no client):
-- a distancia Haversine (double precision, alta precisao) e' arredondada para 1 CASA DECIMAL (100m) --
-- MESMA granularidade dos limites "de"/"ate" cadastrados -- ANTES de qualquer comparacao contra
-- bounding box ou faixas/extrapolacao. Isso elimina ambiguidade de ponto flutuante exatamente na
-- fronteira (20.99999999999 e 21.00000000001 arredondam para o MESMO 21.0, caem sempre na MESMA
-- faixa) e garante que a MESMA distancia produza SEMPRE a MESMA taxa em client (arredondarDistanciaKm
-- em deliveryFeeRules.js, Math.round(km*10)/10) e servidor (round(v_dist_km, 1) abaixo) -- formulas
-- espelhadas byte-a-byte. 100m de margem nao e' uma janela pratica de manipulacao (a distancia vem do
-- endereco real do cliente, nunca de um input livre dele) e o arredondamento e' PADRAO
-- (nearest-even/round-half-up do proprio `round()`), nao sempre-pra-baixo -- sem vies sistematico.
--
-- ESTADO REAL DE PRODUCAO CONFIRMADO ANTES DE ESCREVER ESTA MIGRATION (2026-09-04, pg_get_functiondef
-- direto): get_delivery_fee_config/set_delivery_fee_config ativos == byte-identicos a
-- REF-DELIVERY-FEE-01-step1-fee-config-rpc.sql; _resolve_delivery_fee ativo == byte-identico a
-- REF-ADDRESS-GEO-INTEGRITY-01-onda2-parte1-bbox-delivery-fee.sql. create_order NAO e' tocado nesta
-- migration (delivery_fee continua vindo do MESMO _resolve_delivery_fee, so' o calculo interno mudou).
--
-- Ordem de aplicacao: esta migration (Onda 1) ANTES de REF-DELIVERY-FEE-05-onda2-adicional-pagamento.sql
-- -- a Onda 2 parte do resultado desta (get/set_delivery_fee_config/_resolve_delivery_fee ja com
-- incrementoAcimaFaixas + extrapolacao).
--
-- Testes: tests/deliveryFee.golden.mjs (client, tabela nova + fronteiras + extrapolacao) +
-- scripts/delivery-fee-05-onda1-tabela-extrapolacao-test.mjs (E2E, projeto Supabase dedicado).
-- Rollback: REF-DELIVERY-FEE-05-onda1-tabela-comercial-extrapolacao-rollback.sql.

BEGIN;

-- ── 1. get_delivery_fee_config: fallback global passa a ser a tabela OFICIAL + incrementoAcimaFaixas. ──
CREATE OR REPLACE FUNCTION public.get_delivery_fee_config(p_store_id uuid DEFAULT default_store_id())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT COALESCE(
    (SELECT valor::jsonb FROM public.store_settings WHERE store_id = p_store_id AND chave = 'delivery_fee_config' LIMIT 1),
    '{"version":1,"ativo":true,"maquininha":{"ativo":true,"valor":2.00},"incrementoAcimaFaixas":2.00,"faixas":[{"de":0.0,"ate":4.0,"valor":10.00},{"de":4.1,"ate":5.0,"valor":12.00},{"de":5.1,"ate":7.0,"valor":14.00},{"de":7.1,"ate":8.0,"valor":16.00},{"de":8.1,"ate":9.0,"valor":18.00},{"de":9.1,"ate":10.0,"valor":20.00},{"de":10.1,"ate":11.0,"valor":22.00},{"de":11.1,"ate":12.0,"valor":24.00},{"de":12.1,"ate":13.0,"valor":26.00},{"de":13.1,"ate":14.0,"valor":28.00},{"de":14.1,"ate":15.0,"valor":30.00},{"de":15.1,"ate":16.0,"valor":32.00},{"de":16.1,"ate":17.0,"valor":34.00},{"de":17.1,"ate":18.0,"valor":36.00},{"de":18.1,"ate":19.0,"valor":38.00},{"de":19.1,"ate":20.0,"valor":40.00}]}'::jsonb
  ) || jsonb_build_object(
    'configuracao_propria',
    EXISTS (SELECT 1 FROM public.store_settings WHERE store_id = p_store_id AND chave = 'delivery_fee_config')
  );
$function$;

-- ── 2. set_delivery_fee_config: valida/persiste incrementoAcimaFaixas (OPCIONAL no payload -- ausente ──
-- persiste o default 2.00, "ja nasce ligado", mesmo precedente da REF-DELIVERY-FEE-01 original).
CREATE OR REPLACE FUNCTION public.set_delivery_fee_config(p_config jsonb, p_store_id uuid DEFAULT default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_ativo        boolean;
  v_maq          jsonb;
  v_maq_ativo    boolean;
  v_maq_valor    numeric;
  v_incremento   numeric;
  v_faixas       jsonb;
  v_faixa        jsonb;
  v_de           numeric;
  v_ate          numeric;
  v_valor        numeric;
  v_ordenadas    jsonb := '[]'::jsonb;
  v_prev_ate     numeric;
  v_vistos       text[] := ARRAY[]::text[];
  v_chave        text;
  v_result       jsonb;
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RAISE EXCEPTION 'apenas administradores podem alterar a taxa de entrega'
      USING ERRCODE = '42501';
  END IF;

  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION 'payload invalido: esperado um objeto JSON'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_config->'ativo') <> 'boolean' THEN
    RAISE EXCEPTION '"ativo" deve ser booleano' USING ERRCODE = '22023';
  END IF;
  v_ativo := (p_config->>'ativo')::boolean;

  v_maq := p_config->'maquininha';
  IF v_maq IS NULL OR jsonb_typeof(v_maq) <> 'object' THEN
    RAISE EXCEPTION '"maquininha" deve ser um objeto {ativo, valor}' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_maq->'ativo') <> 'boolean' THEN
    RAISE EXCEPTION 'maquininha.ativo deve ser booleano' USING ERRCODE = '22023';
  END IF;
  v_maq_ativo := (v_maq->>'ativo')::boolean;
  IF nullif(btrim(v_maq->>'valor'), '') IS NULL THEN
    RAISE EXCEPTION 'maquininha.valor e obrigatorio' USING ERRCODE = '22023';
  END IF;
  v_maq_valor := (v_maq->>'valor')::numeric;
  IF v_maq_valor < 0 THEN
    RAISE EXCEPTION 'maquininha.valor nao pode ser negativo (recebido %)', v_maq_valor USING ERRCODE = '22023';
  END IF;

  -- REF-DELIVERY-FEE-05 · Onda 1: incrementoAcimaFaixas -- OPCIONAL (ausente = default 2.00). Presente,
  -- precisa ser numero > 0 (zero/negativo desativaria a extensao matematica silenciosamente -- fail
  -- fast em vez disso, mesmo espirito das outras validacoes desta RPC).
  IF p_config ? 'incrementoAcimaFaixas' THEN
    IF nullif(btrim(p_config->>'incrementoAcimaFaixas'), '') IS NULL THEN
      RAISE EXCEPTION 'incrementoAcimaFaixas nao pode ser vazio' USING ERRCODE = '22023';
    END IF;
    v_incremento := (p_config->>'incrementoAcimaFaixas')::numeric;
    IF v_incremento <= 0 THEN
      RAISE EXCEPTION 'incrementoAcimaFaixas deve ser maior que zero (recebido %)', v_incremento USING ERRCODE = '22023';
    END IF;
  ELSE
    v_incremento := 2.00;
  END IF;

  v_faixas := p_config->'faixas';
  IF v_faixas IS NULL OR jsonb_typeof(v_faixas) <> 'array' THEN
    RAISE EXCEPTION '"faixas" deve ser uma lista' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(v_faixas) = 0 THEN
    RAISE EXCEPTION 'informe ao menos uma faixa' USING ERRCODE = '22023';
  END IF;

  FOR v_faixa IN SELECT * FROM jsonb_array_elements(v_faixas) LOOP
    IF jsonb_typeof(v_faixa) <> 'object' THEN
      RAISE EXCEPTION 'faixa invalida (esperado objeto com de/ate/valor)' USING ERRCODE = '22023';
    END IF;
    IF nullif(btrim(v_faixa->>'de'), '') IS NULL OR nullif(btrim(v_faixa->>'ate'), '') IS NULL
       OR nullif(btrim(v_faixa->>'valor'), '') IS NULL THEN
      RAISE EXCEPTION 'faixa incompleta: informe de, ate e valor' USING ERRCODE = '22023';
    END IF;
    v_de := (v_faixa->>'de')::numeric;
    v_ate := (v_faixa->>'ate')::numeric;
    v_valor := (v_faixa->>'valor')::numeric;
    IF v_de < 0 THEN
      RAISE EXCEPTION 'faixa %-%: "de" nao pode ser negativo', v_de, v_ate USING ERRCODE = '22023';
    END IF;
    IF v_ate <= v_de THEN
      RAISE EXCEPTION 'faixa %-%: "ate" deve ser maior que "de"', v_de, v_ate USING ERRCODE = '22023';
    END IF;
    IF v_valor < 0 THEN
      RAISE EXCEPTION 'faixa %-%: valor nao pode ser negativo', v_de, v_ate USING ERRCODE = '22023';
    END IF;
    v_chave := v_de::text || '-' || v_ate::text;
    IF v_chave = ANY(v_vistos) THEN
      RAISE EXCEPTION 'faixa duplicada: % km ate % km', v_de, v_ate USING ERRCODE = '22023';
    END IF;
    v_vistos := array_append(v_vistos, v_chave);
  END LOOP;

  v_prev_ate := NULL;
  FOR v_de, v_ate IN
    SELECT (f->>'de')::numeric, (f->>'ate')::numeric
    FROM jsonb_array_elements(v_faixas) f
    ORDER BY 1
  LOOP
    IF v_prev_ate IS NOT NULL AND v_de < v_prev_ate THEN
      RAISE EXCEPTION 'faixas sobrepostas: verifique os intervalos ao redor de % km', v_de USING ERRCODE = '22023';
    END IF;
    v_prev_ate := v_ate;
  END LOOP;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('de', (f->>'de')::numeric, 'ate', (f->>'ate')::numeric, 'valor', (f->>'valor')::numeric) ORDER BY (f->>'de')::numeric),
    '[]'::jsonb
  )
    INTO v_ordenadas
    FROM jsonb_array_elements(v_faixas) f;

  v_result := jsonb_build_object(
    'version', 1,
    'ativo', v_ativo,
    'maquininha', jsonb_build_object('ativo', v_maq_ativo, 'valor', v_maq_valor),
    'incrementoAcimaFaixas', v_incremento,
    'faixas', v_ordenadas
  );

  INSERT INTO public.store_settings (store_id, chave, valor)
  VALUES (p_store_id, 'delivery_fee_config', v_result::text)
  ON CONFLICT (store_id, chave) DO UPDATE SET valor = EXCLUDED.valor;

  RETURN v_result;
END;
$function$;

-- ── 3. _resolve_delivery_fee: arredondamento de 1 casa decimal + extrapolacao matematica acima do ──────
-- teto cadastrado. maquininha/bbox/ownership continuam byte-identicos na LOGICA (so' a variavel de
-- distancia passa a ser numeric arredondada em vez de double precision crua).
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
  -- (src/address/utils/coordinates.js). So' straight-line: motor de distancia autoritativo (viaria) e'
  -- escopo da Onda 3 desta mesma REF, nao tocado aqui.
  v_dist_raw := 6371 * 2 * asin(sqrt(
      power(sin(radians(v_lat_end - v_lat_loja) / 2), 2) +
      cos(radians(v_lat_loja)) * cos(radians(v_lat_end)) *
      power(sin(radians(v_lng_end - v_lng_loja) / 2), 2)
  ));

  -- REF-DELIVERY-FEE-05 · Onda 1: arredonda para 1 CASA DECIMAL ANTES de qualquer comparacao (bbox,
  -- faixa exata, extrapolacao) -- politica de precisao documentada no cabecalho desta migration. MESMA
  -- formula do client (arredondarDistanciaKm, Math.round(km*10)/10) -- garante taxa identica nos dois
  -- lados para a mesma distancia.
  v_dist_km := round(v_dist_raw::numeric, 1);

  -- REF-ADDRESS-GEO-INTEGRITY-01 · Onda 2, Parte 1: bounding box de plausibilidade, ISOLADO POR
  -- TENANT (deriva das PROPRIAS faixas da loja, nunca um raio fixo global). INTOCADO na logica --
  -- reavaliacao de base (Haversine vs viaria) e' a Onda 4 desta REF.
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
    -- REF-DELIVERY-FEE-05 · Onda 1: extrapolacao matematica acima da maior faixa cadastrada --
    -- "depois de 7km, cada faixa completa de 1km acrescenta R$2,00", para sempre. Formula IDENTICA a
    -- resolverTaxaPorDistancia (client): kmExtras = ceil(v_dist_km - maiorFaixa.ate); valor =
    -- maiorFaixa.valor + incremento * kmExtras. incrementoAcimaFaixas ausente/invalido/<=0 ou nenhuma
    -- faixa cadastrada -> comportamento antigo preservado (fora de alcance, R$0 -- nunca bloqueia).
    v_maior_faixa := (
      SELECT f FROM jsonb_array_elements(COALESCE(v_config->'faixas', '[]'::jsonb)) f
      ORDER BY (f->>'ate')::numeric DESC LIMIT 1
    );
    v_incremento := (v_config->>'incrementoAcimaFaixas')::numeric;
    IF v_maior_faixa IS NOT NULL AND v_incremento IS NOT NULL AND v_incremento > 0 THEN
      v_km_extras := ceil(v_dist_km - (v_maior_faixa->>'ate')::numeric);
      v_delivery_fee := COALESCE((v_maior_faixa->>'valor')::numeric, 0) + v_incremento * v_km_extras;
    ELSE
      RETURN jsonb_build_object('delivery_fee', 0, 'maquininha_fee', v_maquininha_fee);
    END IF;
  END IF;

  RETURN jsonb_build_object('delivery_fee', v_delivery_fee, 'maquininha_fee', v_maquininha_fee);
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── VERIFICACAO (rodar manualmente apos aplicar) ──────────────────────────────────────────────────
-- 1. 4,0km -> R$10; 4,1km -> R$12; 5,0km -> R$12; 5,1km -> R$14; 7,0km -> R$14; 7,1km -> R$16.
-- 2. 20,0km -> R$40; 20,1km -> R$42; 21,0km -> R$42; 21,1km -> R$44; 23,0km -> R$46; 25,0km -> R$50.
-- 3. Caso real ~4,5km -> R$12; caso real ~5,7km -> R$14 (mesma distancia Haversine da auditoria).
-- 4. Config antiga sem "incrementoAcimaFaixas" (loja com config propria salva antes desta migration)
--    -> default 2.00 aplicado (extrapolacao funciona mesmo sem o Admin reconfigurar).
-- 5. delivery_fee/maquininha_fee/divergencia_valor (REF-DELIVERY-FEE-04) continuam intactos.
-- 6. Bounding box/ownership (REF-ADDRESS-GEO-INTEGRITY-01 Onda 2) continuam intactos.
