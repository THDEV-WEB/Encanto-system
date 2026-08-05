-- REF-DELIVERY-FEE-01 · Passo 1 — Configuracao administravel da taxa de entrega automatica por distancia.
-- Reutiliza public.settings (chave/valor) — UMA chave 'delivery_fee_config', valor = objeto JSON (texto).
-- Espelha exatamente o padrao ja provado por REF-BUSINESS-HOURS-04 (business_hours_schedule: substituicao
-- TOTAL do objeto, nao PATCH) e REF-DELIVERY-01 (delivery_eta_min): RPC SECURITY DEFINER dedicada para
-- leitura publica (get_setting generico NAO funciona no client — a RLS de settings e TRANCADA, ver
-- REF-DELIVERY-01a) + RPC SECURITY DEFINER restrita a admin para escrita, com validacao completa no servidor
-- (nunca confia so no cliente).
--
-- FORMATO do objeto:
--   {
--     "version": 1,
--     "ativo": true,                          -- liga/desliga a cobranca automatica (Admin > Taxa de Entrega)
--     "maquininha": { "ativo": true, "valor": 2.00 },  -- acrescimo de retorno da maquininha (debito/credito)
--     "faixas": [ { "de": 0.0, "ate": 5.0, "valor": 10.00 }, ... ]  -- faixas De/Ate (km) -> valor (R$)
--   }
--
-- Semente = EXATAMENTE a tabela fornecida pelo dono (17 faixas, 0-21km, R$10 a R$42) + maquininha R$2,00
-- ativa + cobranca automatica JA NASCE LIGADA (decisao explicita do dono, 2026-08-05: a feature so entra em
-- producao com a tabela padrao ja funcionando, sem etapa manual de ativacao). Nenhum valor fica hardcoded na
-- regra de calculo (services/delivery/deliveryFeeRules.js, Onda 2) — tudo vem deste registro, editavel pelo
-- Admin sem deploy.
--
-- localizarFaixa (regra pura, client): para uma distancia continua, encontra a faixa de MENOR "ate" que seja
-- >= distancia (as faixas sao contiguas por design: cada "de" comeca logo apos o "ate" anterior, ex. 5.0 ->
-- 5.1). Isso evita qualquer buraco de cobertura entre faixas sem exigir que o admin digite limites exatos.
-- Distancia > maior "ate" cadastrado, ou sem coordenadas -> decisao do dono: NUNCA bloqueia o checkout,
-- segue com taxa R$0 e aviso de que a loja confirma depois (Onda 4).
--
-- Validacao SERVIDOR (set_delivery_fee_config) espelha a UI do Admin (Onda 6): cada faixa numerica,
-- de >= 0, ate > de, valor >= 0, sem faixas duplicadas (mesmo de+ate), sem sobreposicao (intervalos
-- [de,ate] nao podem se cruzar). maquininha.valor >= 0. version normalizado no servidor (nunca confia no
-- cliente). Retorna o objeto CANONICO persistido (faixas ordenadas por "de") — fonte truthful.
--
-- Sem tabela nova, sem localStorage como fonte, FONTE UNICA no banco. IDEMPOTENTE (INSERT ... ON CONFLICT
-- DO NOTHING / CREATE OR REPLACE / grants repetiveis). Rollback em arquivo separado.

BEGIN;

INSERT INTO public.settings (chave, valor)
VALUES (
  'delivery_fee_config',
  '{"version":1,"ativo":true,"maquininha":{"ativo":true,"valor":2.00},"faixas":[{"de":0.0,"ate":5.0,"valor":10.00},{"de":5.1,"ate":6.0,"valor":12.00},{"de":6.1,"ate":7.0,"valor":14.00},{"de":7.1,"ate":8.0,"valor":16.00},{"de":8.1,"ate":9.0,"valor":18.00},{"de":9.1,"ate":10.0,"valor":20.00},{"de":10.1,"ate":11.0,"valor":22.00},{"de":11.1,"ate":12.0,"valor":24.00},{"de":12.1,"ate":13.0,"valor":26.00},{"de":13.1,"ate":14.0,"valor":28.00},{"de":14.1,"ate":15.0,"valor":30.00},{"de":15.1,"ate":16.0,"valor":32.00},{"de":16.1,"ate":17.0,"valor":34.00},{"de":17.1,"ate":18.0,"valor":36.00},{"de":18.1,"ate":19.0,"valor":38.00},{"de":19.1,"ate":20.0,"valor":40.00},{"de":20.1,"ate":21.0,"valor":42.00}]}'
)
ON CONFLICT (chave) DO NOTHING;

-- Leitura PUBLICA (loja anon precisa calcular a taxa no checkout; Admin precisa exibir o form). SECURITY
-- DEFINER: le settings direto, ignora a RLS (mesma razao de get_business_hours_schedule/get_company_info).
-- Default embutido = a mesma semente acima, defesa em profundidade caso a chave nunca tenha sido inserida.
CREATE OR REPLACE FUNCTION public.get_delivery_fee_config()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT COALESCE(
    (SELECT valor::jsonb FROM public.settings WHERE chave = 'delivery_fee_config' LIMIT 1),
    '{"version":1,"ativo":true,"maquininha":{"ativo":true,"valor":2.00},"faixas":[{"de":0.0,"ate":5.0,"valor":10.00},{"de":5.1,"ate":6.0,"valor":12.00},{"de":6.1,"ate":7.0,"valor":14.00},{"de":7.1,"ate":8.0,"valor":16.00},{"de":8.1,"ate":9.0,"valor":18.00},{"de":9.1,"ate":10.0,"valor":20.00},{"de":10.1,"ate":11.0,"valor":22.00},{"de":11.1,"ate":12.0,"valor":24.00},{"de":12.1,"ate":13.0,"valor":26.00},{"de":13.1,"ate":14.0,"valor":28.00},{"de":14.1,"ate":15.0,"valor":30.00},{"de":15.1,"ate":16.0,"valor":32.00},{"de":16.1,"ate":17.0,"valor":34.00},{"de":17.1,"ate":18.0,"valor":36.00},{"de":18.1,"ate":19.0,"valor":38.00},{"de":19.1,"ate":20.0,"valor":40.00},{"de":20.1,"ate":21.0,"valor":42.00}]}'::jsonb
  );
$function$;

-- Escrita restrita ao administrador. Substitui a configuracao INTEIRA (validada) e retorna o objeto
-- canonico persistido. is_admin() ja definido em AUTH-01-step1-fundacao.sql.
CREATE OR REPLACE FUNCTION public.set_delivery_fee_config(p_config jsonb)
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
  IF NOT public.is_admin() THEN
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

  v_faixas := p_config->'faixas';
  IF v_faixas IS NULL OR jsonb_typeof(v_faixas) <> 'array' THEN
    RAISE EXCEPTION '"faixas" deve ser uma lista' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(v_faixas) = 0 THEN
    RAISE EXCEPTION 'informe ao menos uma faixa' USING ERRCODE = '22023';
  END IF;

  -- (1) valida CADA faixa: objeto, numerica, de>=0, ate>de, valor>=0.
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

  -- (2) sem sobreposicao: percorre em ordem crescente de "de"; cada faixa so pode comecar no fim (ou
  -- depois) da anterior. Toque exato (0-5 seguido de 5-10) seria sobreposicao (5<=5) — este projeto usa
  -- faixas com gap de 0.1 (5.0 -> 5.1) por design, entao um toque exato aqui indica erro de cadastro.
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

  -- faixas CANONICAS (ordenadas por "de", so os 3 campos esperados — remove qualquer campo extra enviado).
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
    'faixas', v_ordenadas
  );

  INSERT INTO public.settings (chave, valor)
  VALUES ('delivery_fee_config', v_result::text)
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor;

  RETURN v_result;
END;
$function$;

-- Grants (defense-in-depth, mesmo padrao de get/set_business_hours_schedule, get/set_company_info).
REVOKE ALL ON FUNCTION public.get_delivery_fee_config()      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_delivery_fee_config(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_delivery_fee_config(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_delivery_fee_config()      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_delivery_fee_config(jsonb) TO authenticated;

COMMIT;

-- Expoe as novas funcoes na API PostgREST imediatamente.
NOTIFY pgrst, 'reload schema';

-- ── VERIFICACAO (rodar manualmente apos aplicar) ──────────────────────────────────────────────────
-- SELECT get_delivery_fee_config();  -- deve devolver a semente com 17 faixas + ativo:true + maquininha
-- SELECT set_delivery_fee_config('{"ativo":true,"maquininha":{"ativo":true,"valor":2},"faixas":[{"de":0,"ate":5,"valor":10}]}'::jsonb);  -- como anon: 42501; como admin: substitui e retorna canonico
