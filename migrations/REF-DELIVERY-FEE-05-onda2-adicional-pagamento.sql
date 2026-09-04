-- REF-DELIVERY-FEE-05 · Onda 2 -- novo componente financeiro "adicional de pagamento" (+R$2,00).
--
-- PRE-REQUISITO: aplicar DEPOIS de REF-DELIVERY-FEE-05-onda1-tabela-comercial-extrapolacao.sql -- esta
-- migration parte do RESULTADO da Onda 1 (get/set_delivery_fee_config/_resolve_delivery_fee ja com
-- "incrementoAcimaFaixas" + extrapolacao matematica + tabela comercial oficial + arredondamento de 1
-- casa decimal). Nada da Onda 1 e' revertido ou duplicado aqui -- so' adiciona o campo novo por cima.
--
-- REGRA COMERCIAL (decisao do dono, aprovada explicitamente 2026-09-04, independente da distancia):
--   ENTREGA + dinheiro/cartao_debito/cartao_credito -> +R$2,00
--   ENTREGA + pix                                   -> +R$0,00
--   RETIRADA (qualquer forma de pagamento)           -> +R$0,00
--   MESA     (qualquer forma de pagamento, quando existir tipo_pedido='mesa') -> +R$0,00
--
-- NAO e' o mesmo componente que maquininha_fee (essa continua intocada, aplica so' em
-- cartao_debito/cartao_credito, independente de entrega/retirada -- ver _resolve_delivery_fee).
-- Os dois coexistem como colunas/campos SEPARADOS, nunca somados silenciosamente num so.
--
-- ACHADO DE AUDITORIA (REF-DELIVERY-FEE-05, auditoria/design previos): nao existia NENHUM
-- componente equivalente a "adicional de pagamento" no sistema antes desta migration -- e' feature
-- nova, simetrica a maquininha_fee, nao uma correcao dela.
--
-- ESTADO REAL DE PRODUCAO CONFIRMADO ANTES DE ESCREVER ESTA MIGRATION (2026-09-04, pg_get_functiondef
-- direto, nao pelo arquivo de migration mais recente do repositorio -- REF-MESA-01 NAO esta aplicada
-- em producao, seu codigo-fonte mais recente no repo nao reflete o banco real):
--   - create_order() ativo == byte-identico a REF-ADDRESS-GEO-INTEGRITY-01-onda2-parte2-ownership-
--     endereco.sql (sem tipo_pedido/mesa_identificador -- so' v_retirada boolean).
--   - orders NAO tem coluna tipo_pedido/origem_pedido/mesa_identificador.
-- Esta migration parte EXATAMENTE dessas versoes -- nenhum campo/coluna da REF-MESA-01 e' introduzido
-- aqui, por instrucao explicita do dono (nao antecipar Mesa fora do escopo desta REF).
--
-- EXTENSIBILIDADE P/ MESA (instrucao explicita do dono, sem implementar REF-MESA-01 aqui): o gate do
-- adicional novo reusa o MESMO parametro p_retirada que create_order ja passa pra _resolve_delivery_fee
-- -- esse booleano hoje significa "sem entrega fisica" (retirada). Quando a REF-MESA-01 for aplicada,
-- create_order vai continuar passando um booleano (so' que calculado a partir de tipo_pedido<>'entrega'
-- em vez de so' 'retirada') -- _resolve_delivery_fee nao precisa mudar de novo, o contrato ja e'
-- extensivel por construcao. Client (deliveryFeeRules.montarResumoFinanceiro) segue a MESMA logica: ja
-- recebe `retirada` como o booleano `semEntregaFisica` (retirada OU mesa) vindo do CheckoutPage.jsx --
-- ver REF-MESA-01 · Onda 2, ja presente no working tree do client (nao em producao).
--
-- DEFAULT "JA NASCE LIGADO" (mesmo precedente da REF-DELIVERY-FEE-01 original -- "cobranca automatica
-- ja nasce LIGADA assim que a migration for aplicada, nao fica esperando o dono ativar depois"):
-- quando delivery_fee_config.adicionalPagamento estiver AUSENTE (config antiga, salva antes desta
-- migration -- caso real da loja "encanto"), tanto _resolve_delivery_fee quanto o client tratam como
-- {ativo:true, valor:2.00} -- nunca como desligado. So' fica desligado se o Admin explicitamente
-- salvar {ativo:false,...} depois desta migration (via set_delivery_fee_config, validado abaixo).
-- Decisao tecnica registrada aqui para nao exigir UPDATE de dado em store_settings.
--
-- Testes: tests/deliveryFee.golden.mjs (client) + scripts/delivery-fee-05-onda2-adicional-pagamento-
-- test.mjs (E2E, projeto Supabase dedicado).
-- Rollback: REF-DELIVERY-FEE-05-onda2-adicional-pagamento-rollback.sql.

BEGIN;

-- ── 1. Schema: nova coluna, separada de delivery_fee/maquininha_fee (rastreabilidade). ──────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS adicional_pagamento_fee numeric NOT NULL DEFAULT 0;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_adicional_pagamento_fee_check CHECK (adicional_pagamento_fee >= 0);

-- ── 2. get_delivery_fee_config: fallback global (tabela oficial + incrementoAcimaFaixas, da Onda 1) ──
-- passa a incluir tambem adicionalPagamento.
CREATE OR REPLACE FUNCTION public.get_delivery_fee_config(p_store_id uuid DEFAULT default_store_id())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT COALESCE(
    (SELECT valor::jsonb FROM public.store_settings WHERE store_id = p_store_id AND chave = 'delivery_fee_config' LIMIT 1),
    '{"version":1,"ativo":true,"maquininha":{"ativo":true,"valor":2.00},"adicionalPagamento":{"ativo":true,"valor":2.00},"incrementoAcimaFaixas":2.00,"faixas":[{"de":0.0,"ate":4.0,"valor":10.00},{"de":4.1,"ate":5.0,"valor":12.00},{"de":5.1,"ate":7.0,"valor":14.00},{"de":7.1,"ate":8.0,"valor":16.00},{"de":8.1,"ate":9.0,"valor":18.00},{"de":9.1,"ate":10.0,"valor":20.00},{"de":10.1,"ate":11.0,"valor":22.00},{"de":11.1,"ate":12.0,"valor":24.00},{"de":12.1,"ate":13.0,"valor":26.00},{"de":13.1,"ate":14.0,"valor":28.00},{"de":14.1,"ate":15.0,"valor":30.00},{"de":15.1,"ate":16.0,"valor":32.00},{"de":16.1,"ate":17.0,"valor":34.00},{"de":17.1,"ate":18.0,"valor":36.00},{"de":18.1,"ate":19.0,"valor":38.00},{"de":19.1,"ate":20.0,"valor":40.00}]}'::jsonb
  ) || jsonb_build_object(
    'configuracao_propria',
    EXISTS (SELECT 1 FROM public.store_settings WHERE store_id = p_store_id AND chave = 'delivery_fee_config')
  );
$function$;

-- ── 3. set_delivery_fee_config: valida e persiste adicionalPagamento (mesmo padrao de maquininha), ────
-- preservando integralmente a validacao de incrementoAcimaFaixas introduzida na Onda 1. Campo
-- adicionalPagamento OPCIONAL no payload (retrocompativel -- ausente persiste o default "ja nasce
-- ligado" {ativo:true, valor:2.00}, nunca quebra por campo faltando).
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
  v_adic         jsonb;
  v_adic_ativo   boolean;
  v_adic_valor   numeric;
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

  -- REF-DELIVERY-FEE-05 · Onda 2: adicionalPagamento -- OPCIONAL no payload (ausente = default "ja
  -- nasce ligado" {ativo:true, valor:2.00}); presente, valida igual a maquininha.
  v_adic := p_config->'adicionalPagamento';
  IF v_adic IS NULL THEN
    v_adic_ativo := true;
    v_adic_valor := 2.00;
  ELSE
    IF jsonb_typeof(v_adic) <> 'object' THEN
      RAISE EXCEPTION '"adicionalPagamento" deve ser um objeto {ativo, valor}' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_adic->'ativo') <> 'boolean' THEN
      RAISE EXCEPTION 'adicionalPagamento.ativo deve ser booleano' USING ERRCODE = '22023';
    END IF;
    v_adic_ativo := (v_adic->>'ativo')::boolean;
    IF nullif(btrim(v_adic->>'valor'), '') IS NULL THEN
      RAISE EXCEPTION 'adicionalPagamento.valor e obrigatorio' USING ERRCODE = '22023';
    END IF;
    v_adic_valor := (v_adic->>'valor')::numeric;
    IF v_adic_valor < 0 THEN
      RAISE EXCEPTION 'adicionalPagamento.valor nao pode ser negativo (recebido %)', v_adic_valor USING ERRCODE = '22023';
    END IF;
  END IF;

  -- REF-DELIVERY-FEE-05 · Onda 1 (preservado): incrementoAcimaFaixas -- OPCIONAL (ausente = default 2.00).
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
    'adicionalPagamento', jsonb_build_object('ativo', v_adic_ativo, 'valor', v_adic_valor),
    'incrementoAcimaFaixas', v_incremento,
    'faixas', v_ordenadas
  );

  INSERT INTO public.store_settings (store_id, chave, valor)
  VALUES (p_store_id, 'delivery_fee_config', v_result::text)
  ON CONFLICT (store_id, chave) DO UPDATE SET valor = EXCLUDED.valor;

  RETURN v_result;
END;
$function$;

-- ── 4. _resolve_delivery_fee: preserva integralmente a extrapolacao/arredondamento da Onda 1 e ─────────
-- acrescenta o calculo de adicional_pagamento_fee.
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

  -- Haversine (km) -- mesma formula/precisao do dominio Address no client
  -- (src/address/utils/coordinates.js). Motor de distancia autoritativo (viaria) e' escopo da Onda 3
  -- desta mesma REF, nao tocado aqui.
  v_dist_raw := 6371 * 2 * asin(sqrt(
      power(sin(radians(v_lat_end - v_lat_loja) / 2), 2) +
      cos(radians(v_lat_loja)) * cos(radians(v_lat_end)) *
      power(sin(radians(v_lng_end - v_lng_loja) / 2), 2)
  ));

  -- REF-DELIVERY-FEE-05 · Onda 1 (preservado): arredonda para 1 casa decimal ANTES de qualquer
  -- comparacao -- ver politica de precisao no cabecalho da migration da Onda 1.
  v_dist_km := round(v_dist_raw::numeric, 1);

  -- REF-ADDRESS-GEO-INTEGRITY-01 · Onda 2, Parte 1: bounding box de plausibilidade, ISOLADO POR
  -- TENANT. INTOCADO nesta onda -- reavaliacao de base (Haversine vs viaria) e' a Onda 4 desta REF.
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
    'adicional_pagamento_fee', v_adicional_pagamento_fee
  );
END;
$function$;

-- ── 5. create_order: le/persiste/compara adicional_pagamento_fee, mesma filosofia de autoridade e ───
-- divergencia em centavos ja aplicada a delivery_fee/maquininha_fee (REF-DELIVERY-FEE-04). Nenhuma
-- mudanca relacionada a tipo_pedido/mesa (fora de escopo desta REF -- ver cabecalho).
CREATE OR REPLACE FUNCTION public.create_order(p_customer jsonb, p_order jsonb, p_items jsonb, p_request_id uuid DEFAULT NULL::uuid, p_store_id uuid DEFAULT default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_customer_id uuid; v_order_id uuid;
  v_name   text := nullif(btrim(p_customer->>'name'), '');
  v_phone  text := public.normalize_phone(p_customer->>'phone');
  v_total  numeric;
  v_pay    text := nullif(btrim(p_order->>'payment_method'), '');
  v_addr   text := nullif(btrim(p_order->>'address'), '');
  v_status text := coalesce(nullif(btrim(p_order->>'status'), ''), 'recebido');
  v_obs    text := nullif(btrim(p_order->>'observacoes'), '');
  v_delivery_fee    numeric;
  v_maquininha_fee  numeric;
  v_adicional_pagamento_fee numeric;
  v_retirada        boolean := coalesce((nullif(btrim(p_order->>'retirada'), ''))::boolean, false);
  v_endereco_id     uuid := nullif(btrim(p_order->>'endereco_id'), '')::uuid;
  v_fee_calc        jsonb;
  v_elem   jsonb; v_err text; v_state text;
  v_t0     timestamptz := clock_timestamp(); v_dur numeric;
  v_log    jsonb := jsonb_build_object(
              'n_items', case when jsonb_typeof(p_items)='array' then jsonb_array_length(p_items) else null end,
              'total', p_order->>'total', 'has_request_id', (p_request_id is not null));
  v_tenant       uuid := nullif(auth.jwt()->>'tenant_id', '')::uuid;
  v_store_id     uuid;
  v_items_resolved jsonb := '[]'::jsonb;
  v_pid            uuid;
  v_calc           jsonb;
  v_item_price     numeric;
begin
  if p_request_id is not null then
    select id into v_order_id from public.orders where request_id = p_request_id;
    if v_order_id is not null then return jsonb_build_object('ok', true, 'order_id', v_order_id, 'idempotent', true); end if;
  end if;

  if not public._rate_limit_hit('create_order', 60, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'error', 'muitas tentativas, aguarde um momento');
  end if;

  if v_tenant is not null then
    if v_tenant <> p_store_id then
      return jsonb_build_object('ok', false, 'error', 'loja invalida');
    end if;
    v_store_id := p_store_id;
  else
    v_store_id := public.resolve_store_from_origin();
    if v_store_id is null then
      return jsonb_build_object('ok', false, 'error', 'loja nao identificada');
    end if;
  end if;

  begin
    if p_customer is null or jsonb_typeof(p_customer) <> 'object' then raise exception 'p_customer ausente/invalido'; end if;
    if v_name  is null then raise exception 'name do cliente e obrigatorio'; end if;
    if v_phone is null then raise exception 'telefone do cliente e obrigatorio'; end if;
    if p_order is null or jsonb_typeof(p_order) <> 'object' then raise exception 'p_order ausente/invalido'; end if;
    if v_pay  is null then raise exception 'payment_method e obrigatorio'; end if;
    if v_addr is null then raise exception 'address e obrigatorio'; end if;

    -- REF-ADDRESS-GEO-INTEGRITY-01 · Onda 2, Parte 2: ownership de endereco_id. INTOCADO.
    if v_endereco_id is not null then
      if auth.uid() is not null then
        if not exists (
          select 1 from public.addresses a
          where a.id = v_endereco_id and a.store_id = v_store_id
            and (a.customer_id is null or a.customer_id in (select c.id from public.customers c where c.auth_user_id = auth.uid()))
        ) then
          v_endereco_id := null;
        end if;
      else
        if not exists (
          select 1 from public.addresses a where a.id = v_endereco_id and a.store_id = v_store_id and a.customer_id is null
        ) then
          v_endereco_id := null;
        end if;
      end if;
    end if;

    -- REF-DELIVERY-FEE-04 · Onda 1: delivery_fee/maquininha_fee SEMPRE recalculados aqui. REF-
    -- DELIVERY-FEE-05: adicional_pagamento_fee entra no MESMO pacote autoritativo -- o que o client
    -- mandou em p_order->>'delivery_fee'/'maquininha_fee'/'adicional_pagamento_fee' nunca e' usado
    -- para PERSISTIR.
    v_fee_calc := public._resolve_delivery_fee(v_store_id, v_retirada, v_pay, v_endereco_id);
    v_delivery_fee := (v_fee_calc->>'delivery_fee')::numeric;
    v_maquininha_fee := (v_fee_calc->>'maquininha_fee')::numeric;
    v_adicional_pagamento_fee := (v_fee_calc->>'adicional_pagamento_fee')::numeric;

    -- REF-DELIVERY-FEE-04 · Onda 2: mesma mecanica de divergencia (comparacao em CENTAVOS, sem
    -- tolerancia arbitraria), agora estendida a adicional_pagamento_fee -- mesma filosofia: campo
    -- ausente no payload preserva o comportamento silencioso (compat com chamador que ainda nao
    -- declara essa expectativa); campo presente e divergente recusa persistir, devolve autoritativo.
    if (p_order ? 'delivery_fee' and round(coalesce((p_order->>'delivery_fee')::numeric,0)*100) <> round(v_delivery_fee*100))
       or (p_order ? 'maquininha_fee' and round(coalesce((p_order->>'maquininha_fee')::numeric,0)*100) <> round(v_maquininha_fee*100))
       or (p_order ? 'adicional_pagamento_fee' and round(coalesce((p_order->>'adicional_pagamento_fee')::numeric,0)*100) <> round(v_adicional_pagamento_fee*100))
    then
      return jsonb_build_object('ok', false, 'error', 'valor da entrega foi atualizado, confirme novamente',
        'divergencia_valor', true, 'delivery_fee', v_delivery_fee, 'maquininha_fee', v_maquininha_fee,
        'adicional_pagamento_fee', v_adicional_pagamento_fee);
    end if;

    if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'p_items deve ser um array'; end if;
    if jsonb_array_length(p_items) = 0 then raise exception 'p_items nao pode ser vazio'; end if;
    for v_elem in select value from jsonb_array_elements(p_items) loop
      if nullif(btrim(v_elem->>'nome_produto'), '') is null then raise exception 'item sem nome_produto'; end if;
      if nullif(btrim(v_elem->>'quantity'), '') is null or (v_elem->>'quantity')::numeric <= 0 then
        raise exception 'item "%" com quantity invalida', v_elem->>'nome_produto'; end if;

      -- REF-PRICE-SOURCE-01 · Onda 2: product_id obrigatorio -- fail-closed. INTOCADO.
      v_pid := nullif(btrim(v_elem->>'product_id'), '')::uuid;
      if v_pid is null then
        raise exception 'item "%" sem produto valido', v_elem->>'nome_produto';
      end if;

      v_calc := public._resolve_item_pricing(v_store_id, v_pid, nullif(btrim(v_elem->>'tamanho_label'), ''),
                                              coalesce(v_elem->'adicionais', '[]'::jsonb));
      v_item_price := (v_calc->>'preco_unitario')::numeric;
      v_items_resolved := v_items_resolved || jsonb_build_array(jsonb_build_object(
        'product_id', v_pid, 'nome_produto', v_elem->>'nome_produto',
        'quantity', (v_elem->>'quantity')::int, 'price', v_item_price, 'preco_unitario', v_item_price,
        'adicionais', v_calc->'adicionais', 'observacoes', nullif(btrim(v_elem->>'observacoes'), '')
      ));
    end loop;

    -- orders.total: soma dos itens (autoritativos) + delivery_fee/maquininha_fee/adicional_pagamento_fee
    -- (todos autoritativos).
    select coalesce(sum((item->>'preco_unitario')::numeric * (item->>'quantity')::numeric), 0)
      into v_total
      from jsonb_array_elements(v_items_resolved) as t(item);
    v_total := v_total + v_delivery_fee + v_maquininha_fee + v_adicional_pagamento_fee;
    if v_total <= 0 then raise exception 'total deve ser > 0 (recebido %)', v_total; end if;

    insert into public.customers (name, phone, store_id) values (v_name, v_phone, v_store_id)
      on conflict (store_id, phone) do update
        set name = case
          when public.customers.auth_user_id is null or public.customers.auth_user_id = auth.uid()
            then excluded.name
          else public.customers.name
        end
      returning id into v_customer_id;
    insert into public.orders (customer_id, total, status, payment_method, address, observacoes, request_id, endereco_id, delivery_fee, maquininha_fee, adicional_pagamento_fee, store_id)
      values (v_customer_id, v_total, v_status, v_pay, v_addr, v_obs, p_request_id,
              v_endereco_id, v_delivery_fee, v_maquininha_fee, v_adicional_pagamento_fee, v_store_id) returning id into v_order_id;
    insert into public.order_items (order_id, product_id, nome_produto, quantity, price, preco_unitario, adicionais, observacoes, store_id)
      select v_order_id, (item->>'product_id')::uuid, item->>'nome_produto',
             (item->>'quantity')::int, (item->>'price')::numeric, (item->>'preco_unitario')::numeric,
             coalesce(item->'adicionais','[]'::jsonb), item->>'observacoes', v_store_id
      from jsonb_array_elements(v_items_resolved) as t(item);

    -- REF-LOYALTY-01: concede 1 selo por pedido VALIDO (mesma transacao). INTOCADO.
    begin
      perform public.loyalty_grant(v_customer_id, v_order_id);
    exception when others then
      null;
    end;

    return jsonb_build_object('ok', true, 'order_id', v_order_id);
  exception
    when unique_violation then
      if p_request_id is not null then
        select id into v_order_id from public.orders where request_id = p_request_id;
        if v_order_id is not null then return jsonb_build_object('ok', true, 'order_id', v_order_id, 'idempotent', true); end if;
      end if;
      v_err := sqlerrm; v_state := sqlstate; v_dur := extract(epoch from clock_timestamp()-v_t0)*1000;
      begin insert into public.application_logs(module,operation,entity,entity_id,request_id,rpc,version,duration_ms,level,message,payload,sqlstate,context,origin)
        values('orders','create_order','order',null,p_request_id,'create_order','delivery-fee-05-onda2',v_dur,'error',v_err,v_log,v_state,'unique_violation',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
    when others then
      v_err := sqlerrm; v_state := sqlstate; v_dur := extract(epoch from clock_timestamp()-v_t0)*1000;
      begin insert into public.application_logs(module,operation,entity,entity_id,request_id,rpc,version,duration_ms,level,message,payload,sqlstate,context,origin)
        values('orders','create_order','order',null,p_request_id,'create_order','delivery-fee-05-onda2',v_dur,'error',v_err,v_log,v_state,'create_order',current_user);
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'error', v_err, 'sqlstate', v_state);
  end;
end;$function$;

-- ── 6. admin_orders_search: RETURNS TABLE com lista EXPLICITA de colunas -- sem esta alteracao o novo ──
-- campo nunca apareceria na lista principal de pedidos do Admin (AdminPedidos.jsx via
-- DataService.getPedidosPagina), mesmo com tudo mais implementado. Resto do corpo byte-identico.
-- Adicionar coluna ao RETURNS TABLE muda o tipo de retorno -- CREATE OR REPLACE sozinho falha
-- ("cannot change return type of existing function"), precisa dropar antes (mesmo padrao ja usado
-- por REF-MESA-01-onda5-admin-orders-search.sql). DROP apaga grants -- GRANT restaurado logo abaixo.
DROP FUNCTION IF EXISTS public.admin_orders_search(text, text, integer, timestamp with time zone, uuid, uuid);

CREATE OR REPLACE FUNCTION public.admin_orders_search(p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_store_id uuid DEFAULT default_store_id())
 RETURNS TABLE(id uuid, customer_id uuid, total numeric, status text, payment_method text, address text, created_at timestamp with time zone, observacoes text, request_id uuid, delivery_fee numeric, maquininha_fee numeric, adicional_pagamento_fee numeric, customers jsonb, order_items jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RAISE EXCEPTION 'apenas administradores desta loja podem buscar pedidos' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    o.id, o.customer_id, o.total, o.status, o.payment_method, o.address, o.created_at,
    o.observacoes, o.request_id, o.delivery_fee, o.maquininha_fee, o.adicional_pagamento_fee,
    CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('name', c.name, 'phone', c.phone) END AS customers,
    coalesce(
      (SELECT jsonb_agg(to_jsonb(oi.*)) FROM public.order_items oi WHERE oi.order_id = o.id),
      '[]'::jsonb
    ) AS order_items
  FROM public.orders o
  LEFT JOIN public.customers c ON c.id = o.customer_id
  WHERE o.store_id = p_store_id
    AND (p_status IS NULL OR o.status = p_status)
    AND (
      p_search IS NULL OR btrim(p_search) = ''
      OR c.name ILIKE '%' || p_search || '%'
      OR c.phone ILIKE '%' || p_search || '%'
      OR replace(o.id::text, '-', '') ILIKE '%' || replace(p_search, '-', '') || '%'
    )
    AND (
      p_cursor_created_at IS NULL
      OR (o.created_at, o.id) < (p_cursor_created_at, p_cursor_id)
    )
  ORDER BY o.created_at DESC, o.id DESC
  LIMIT greatest(1, least(coalesce(p_limit, 20), 100));
END;
$function$;

-- DROP FUNCTION apaga grants -- restaura EXATAMENTE o que existia antes (confirmado por introspeccao
-- direta em producao, 2026-09-04: authenticated=true, anon=false, service_role=true -- NAO e' "TO
-- PUBLIC" como a migration original da REF-MESA-01 assumia; outra REF de hardening restringiu depois).
GRANT EXECUTE ON FUNCTION public.admin_orders_search(text, text, integer, timestamp with time zone, uuid, uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── VERIFICACAO (rodar manualmente apos aplicar) ──────────────────────────────────────────────────
-- 1. Entrega + dinheiro/debito/credito -> adicional_pagamento_fee = 2.00 no pedido criado.
-- 2. Entrega + pix -> adicional_pagamento_fee = 0.
-- 3. Retirada, qualquer forma de pagamento -> adicional_pagamento_fee = 0 (mesmo ramo early-return).
-- 4. Config antiga sem "adicionalPagamento" (caso real da loja "encanto") -> get_delivery_fee_config
--    nao muda (config propria vence, sem merge parcial) mas _resolve_delivery_fee ainda cobra 2.00
--    (default "ja nasce ligado" tratado na ausencia do campo, nao no get).
-- 5. Admin salva a config (mesmo so mexendo em faixas) -> delivery_fee_config passa a incluir
--    "adicionalPagamento" explicito, refletindo o default ate o Admin mudar via UI.
-- 6. Client forja adicional_pagamento_fee=0 ou valor != 2.00 -> divergencia_valor:true, nenhum pedido.
-- 7. Client forja adicional_pagamento_fee em retirada -> mesma divergencia (autoritativo e' 0).
-- 8. delivery_fee/maquininha_fee/divergencia_valor (REF-DELIVERY-FEE-04) continuam intactos.
-- 9. Bounding box/ownership (REF-ADDRESS-GEO-INTEGRITY-01 Onda 2) continuam intactos.
-- 10. Extrapolacao acima de 20km (REF-DELIVERY-FEE-05 Onda 1) continua intacta: 21.0km->R$42,
--     25.0km->R$50, agora testado JUNTO com o adicional de pagamento.
