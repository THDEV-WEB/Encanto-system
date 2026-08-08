-- REF-SAAS-01 · Onda 4.3 — Configuração operacional por loja (subfase 3 de 3 da Onda 4, fecha a Onda 4).
-- Escopo: business_hours_schedule/delivery_fee_config/delivery_eta_min/store_mode migram da tabela
-- `settings` (key-value GLOBAL, uma linha por chave no sistema inteiro) para a nova `store_settings`
-- (key-value POR LOJA, ADR §12.1). As 4 RPCs de leitura (STABLE, sem is_admin() -- lidas pelo storefront
-- anonimo pra mostrar horario/taxa/status) e as 4 de escrita (is_admin() -> is_admin_of(store_id)) sao
-- atualizadas. `enc_tempo_estimado` (usada pela notificacao de WhatsApp) tambem e corrigida -- lia
-- `delivery_eta_min` direto via get_setting(), contornando a RPC dedicada.
-- Ver docs/adr/REF-SAAS-01-fundacao-multitenant.md §9/§10/§12.1 e docs/ref/REF-SAAS-01-plano-ondas.md
-- (secao "Onda 4.3") para a auditoria e o racional completos.

BEGIN;

-- ===== 1. Nova tabela store_settings — mesmo molde de `settings`, com store_id. RLS habilitada SEM
-- nenhuma policy (trancada, mesmo padrao de `settings`/`stores` desde a Onda 0): so RPC SECURITY
-- DEFINER acessa. =====
CREATE TABLE public.store_settings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES public.stores(id),
  chave       text NOT NULL,
  valor       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, chave)
);
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;

-- Backfill: copia os valores ATUAIS da encanto (unica loja hoje) das 4 chaves migradas.
INSERT INTO public.store_settings (store_id, chave, valor)
SELECT (SELECT id FROM public.stores WHERE slug = 'encanto'), chave, valor
FROM public.settings
WHERE chave IN ('business_hours_schedule', 'delivery_fee_config', 'delivery_eta_min', 'store_mode');

-- ===== 2. business_hours_schedule =====
DROP FUNCTION IF EXISTS public.get_business_hours_schedule();

CREATE OR REPLACE FUNCTION public.get_business_hours_schedule(p_store_id uuid DEFAULT public.default_store_id())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT COALESCE(
    (SELECT valor::jsonb FROM public.store_settings WHERE store_id = p_store_id AND chave = 'business_hours_schedule' LIMIT 1),
    '{"version":1,"timezone":"America/Sao_Paulo","schedule":{"domingo":{"fechado":true,"periodos":[]},"segunda":{"fechado":false,"periodos":[{"ini":"10:00","fim":"15:00"}]},"terca":{"fechado":false,"periodos":[{"ini":"10:00","fim":"15:00"},{"ini":"17:00","fim":"22:00"}]},"quarta":{"fechado":false,"periodos":[{"ini":"10:00","fim":"15:00"},{"ini":"17:00","fim":"22:00"}]},"quinta":{"fechado":false,"periodos":[{"ini":"10:00","fim":"15:00"},{"ini":"17:00","fim":"22:00"}]},"sexta":{"fechado":false,"periodos":[{"ini":"10:00","fim":"15:00"},{"ini":"17:00","fim":"22:00"}]},"sabado":{"fechado":false,"periodos":[{"ini":"10:00","fim":"15:00"},{"ini":"17:00","fim":"22:00"}]}},"exceptions":{}}'::jsonb
  );
$function$;

DROP FUNCTION IF EXISTS public.set_business_hours_schedule(jsonb);

CREATE OR REPLACE FUNCTION public.set_business_hours_schedule(p_schedule jsonb, p_store_id uuid DEFAULT public.default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_dias        text[] := ARRAY['domingo','segunda','terca','quarta','quinta','sexta','sabado'];
  v_dia         text;
  v_dia_obj     jsonb;
  v_fechado     boolean;
  v_periodos    jsonb;
  v_periodo     jsonb;
  v_ini         text;
  v_fim         text;
  v_ini_min     int;
  v_fim_min     int;
  v_prev_fim    int;
  v_ordenados   jsonb;
  v_schedule    jsonb := '{}'::jsonb;
  v_exceptions  jsonb;
  v_result      jsonb;
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RAISE EXCEPTION 'apenas administradores podem alterar o horario de funcionamento'
      USING ERRCODE = '42501';
  END IF;

  IF p_schedule IS NULL OR jsonb_typeof(p_schedule) <> 'object' OR NOT (p_schedule ? 'schedule')
     OR jsonb_typeof(p_schedule->'schedule') <> 'object' THEN
    RAISE EXCEPTION 'payload invalido: esperado {"schedule": {"domingo":{...}, ...}}'
      USING ERRCODE = '22023';
  END IF;

  FOREACH v_dia IN ARRAY v_dias LOOP
    v_dia_obj := p_schedule->'schedule'->v_dia;
    IF v_dia_obj IS NULL OR jsonb_typeof(v_dia_obj) <> 'object' THEN
      RAISE EXCEPTION 'dia ausente ou invalido: %', v_dia USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(v_dia_obj->'fechado') <> 'boolean' THEN
      RAISE EXCEPTION '%: campo "fechado" deve ser booleano', v_dia USING ERRCODE = '22023';
    END IF;
    v_fechado := (v_dia_obj->>'fechado')::boolean;

    v_periodos := COALESCE(v_dia_obj->'periodos', '[]'::jsonb);
    IF jsonb_typeof(v_periodos) <> 'array' THEN
      RAISE EXCEPTION '%: "periodos" deve ser uma lista', v_dia USING ERRCODE = '22023';
    END IF;

    FOR v_periodo IN SELECT * FROM jsonb_array_elements(v_periodos) LOOP
      IF jsonb_typeof(v_periodo) <> 'object' THEN
        RAISE EXCEPTION '%: periodo invalido (esperado objeto com ini/fim)', v_dia USING ERRCODE = '22023';
      END IF;
      v_ini := v_periodo->>'ini';
      v_fim := v_periodo->>'fim';
      IF v_ini IS NULL OR v_fim IS NULL
         OR v_ini !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         OR v_fim !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
        RAISE EXCEPTION '%: horario invalido (% - %), use HH:MM entre 00:00 e 23:59', v_dia, v_ini, v_fim
          USING ERRCODE = '22023';
      END IF;
      v_ini_min := split_part(v_ini, ':', 1)::int * 60 + split_part(v_ini, ':', 2)::int;
      v_fim_min := split_part(v_fim, ':', 1)::int * 60 + split_part(v_fim, ':', 2)::int;
      IF v_fim_min <= v_ini_min THEN
        RAISE EXCEPTION '%: periodo % - % invalido (fim deve ser depois do inicio)', v_dia, v_ini, v_fim
          USING ERRCODE = '22023';
      END IF;
    END LOOP;

    v_prev_fim := NULL;
    FOR v_ini_min, v_fim_min IN
      SELECT (split_part(p->>'ini', ':', 1)::int * 60 + split_part(p->>'ini', ':', 2)::int),
             (split_part(p->>'fim', ':', 1)::int * 60 + split_part(p->>'fim', ':', 2)::int)
      FROM jsonb_array_elements(v_periodos) p
      ORDER BY 1
    LOOP
      IF v_prev_fim IS NOT NULL AND v_ini_min < v_prev_fim THEN
        RAISE EXCEPTION '%: periodos sobrepostos ou duplicados', v_dia USING ERRCODE = '22023';
      END IF;
      v_prev_fim := v_fim_min;
    END LOOP;

    SELECT COALESCE(jsonb_agg(p ORDER BY (p->>'ini')), '[]'::jsonb)
      INTO v_ordenados
      FROM jsonb_array_elements(v_periodos) p;

    v_schedule := v_schedule || jsonb_build_object(v_dia, jsonb_build_object('fechado', v_fechado, 'periodos', v_ordenados));
  END LOOP;

  v_exceptions := p_schedule->'exceptions';
  IF v_exceptions IS NULL OR jsonb_typeof(v_exceptions) <> 'object' THEN
    v_exceptions := '{}'::jsonb;
  END IF;

  v_result := jsonb_build_object(
    'version', 1,
    'timezone', 'America/Sao_Paulo',
    'schedule', v_schedule,
    'exceptions', v_exceptions
  );

  INSERT INTO public.store_settings (store_id, chave, valor)
  VALUES (p_store_id, 'business_hours_schedule', v_result::text)
  ON CONFLICT (store_id, chave) DO UPDATE SET valor = EXCLUDED.valor;

  RETURN v_result;
END;
$function$;

-- ===== 3. delivery_fee_config =====
DROP FUNCTION IF EXISTS public.get_delivery_fee_config();

CREATE OR REPLACE FUNCTION public.get_delivery_fee_config(p_store_id uuid DEFAULT public.default_store_id())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT COALESCE(
    (SELECT valor::jsonb FROM public.store_settings WHERE store_id = p_store_id AND chave = 'delivery_fee_config' LIMIT 1),
    '{"version":1,"ativo":true,"maquininha":{"ativo":true,"valor":2.00},"faixas":[{"de":0.0,"ate":5.0,"valor":10.00},{"de":5.1,"ate":6.0,"valor":12.00},{"de":6.1,"ate":7.0,"valor":14.00},{"de":7.1,"ate":8.0,"valor":16.00},{"de":8.1,"ate":9.0,"valor":18.00},{"de":9.1,"ate":10.0,"valor":20.00},{"de":10.1,"ate":11.0,"valor":22.00},{"de":11.1,"ate":12.0,"valor":24.00},{"de":12.1,"ate":13.0,"valor":26.00},{"de":13.1,"ate":14.0,"valor":28.00},{"de":14.1,"ate":15.0,"valor":30.00},{"de":15.1,"ate":16.0,"valor":32.00},{"de":16.1,"ate":17.0,"valor":34.00},{"de":17.1,"ate":18.0,"valor":36.00},{"de":18.1,"ate":19.0,"valor":38.00},{"de":19.1,"ate":20.0,"valor":40.00},{"de":20.1,"ate":21.0,"valor":42.00}]}'::jsonb
  );
$function$;

DROP FUNCTION IF EXISTS public.set_delivery_fee_config(jsonb);

CREATE OR REPLACE FUNCTION public.set_delivery_fee_config(p_config jsonb, p_store_id uuid DEFAULT public.default_store_id())
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
    'faixas', v_ordenadas
  );

  INSERT INTO public.store_settings (store_id, chave, valor)
  VALUES (p_store_id, 'delivery_fee_config', v_result::text)
  ON CONFLICT (store_id, chave) DO UPDATE SET valor = EXCLUDED.valor;

  RETURN v_result;
END;
$function$;

-- ===== 4. delivery_eta_min =====
DROP FUNCTION IF EXISTS public.get_delivery_eta();

CREATE OR REPLACE FUNCTION public.get_delivery_eta(p_store_id uuid DEFAULT public.default_store_id())
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT COALESCE((SELECT valor FROM public.store_settings WHERE store_id = p_store_id AND chave = 'delivery_eta_min' LIMIT 1), '45');
$function$;

DROP FUNCTION IF EXISTS public.set_delivery_eta(integer);

CREATE OR REPLACE FUNCTION public.set_delivery_eta(p_min integer, p_store_id uuid DEFAULT public.default_store_id())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_min int;
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RAISE EXCEPTION 'apenas administradores podem alterar o tempo de entrega'
      USING ERRCODE = '42501';
  END IF;

  v_min := p_min;
  IF v_min IS NULL OR v_min < 10 OR v_min > 180 THEN
    RAISE EXCEPTION 'tempo invalido: % (use entre 10 e 180 minutos)', p_min
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.store_settings (store_id, chave, valor)
  VALUES (p_store_id, 'delivery_eta_min', v_min::text)
  ON CONFLICT (store_id, chave) DO UPDATE SET valor = EXCLUDED.valor;

  RETURN v_min;
END;
$function$;

-- ===== 5. store_mode =====
DROP FUNCTION IF EXISTS public.get_store_mode();

CREATE OR REPLACE FUNCTION public.get_store_mode(p_store_id uuid DEFAULT public.default_store_id())
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT COALESCE((SELECT valor FROM public.store_settings WHERE store_id = p_store_id AND chave = 'store_mode' LIMIT 1), 'AUTO');
$function$;

DROP FUNCTION IF EXISTS public.set_store_mode(text);

CREATE OR REPLACE FUNCTION public.set_store_mode(p_mode text, p_store_id uuid DEFAULT public.default_store_id())
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_mode text;
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RAISE EXCEPTION 'apenas administradores podem alterar o status da loja'
      USING ERRCODE = '42501';
  END IF;

  v_mode := upper(coalesce(p_mode, ''));
  IF v_mode NOT IN ('AUTO', 'OPEN', 'CLOSED') THEN
    RAISE EXCEPTION 'modo invalido: % (use AUTO, OPEN ou CLOSED)', p_mode
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.store_settings (store_id, chave, valor)
  VALUES (p_store_id, 'store_mode', v_mode)
  ON CONFLICT (store_id, chave) DO UPDATE SET valor = EXCLUDED.valor;

  RETURN v_mode;
END;
$function$;

-- ===== 6. enc_tempo_estimado: lia delivery_eta_min direto via get_setting() (settings GLOBAL),
-- contornando a RPC dedicada -- unico outro leitor dessa chave alem das 4 RPCs acima. Ganha p_store_id;
-- enc_enqueue_notification (corrigida na Onda 4.1, ja resolve v_store da propria orders) passa a
-- propagar esse valor na chamada. =====
DROP FUNCTION IF EXISTS public.enc_tempo_estimado(text);

CREATE OR REPLACE FUNCTION public.enc_tempo_estimado(p_address text, p_store_id uuid DEFAULT public.default_store_id())
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE
    WHEN p_address ~* 'retirada\s+na\s+loja' THEN 'cerca de 20 min'
    ELSE 'até ' || COALESCE((SELECT valor FROM public.store_settings WHERE store_id = p_store_id AND chave = 'delivery_eta_min' LIMIT 1), '45') || ' min'
  END;
$function$;

CREATE OR REPLACE FUNCTION public.enc_enqueue_notification(p_order_id uuid, p_customer_id uuid, p_status text, p_address text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_phone text; v_name text; v_empresa text; v_store uuid;
BEGIN
  IF p_status NOT IN ('recebido','preparo','pronto','entrega','entregue') THEN RETURN; END IF;
  SELECT c.phone, c.name INTO v_phone, v_name FROM public.customers c WHERE c.id = p_customer_id;
  SELECT o.store_id INTO v_store FROM public.orders o WHERE o.id = p_order_id;
  SELECT public.get_company_info()->>'nomeCurto' INTO v_empresa;
  INSERT INTO public.notification_outbox (order_id, to_phone, status, vars, store_id)
  VALUES (
    p_order_id, v_phone, p_status,
    jsonb_build_object(
      'cliente', COALESCE(v_name, ''),
      'numero',  UPPER(LEFT(REPLACE(p_order_id::text, '-', ''), 8)),
      'tempo',   public.enc_tempo_estimado(p_address, v_store),
      'empresa', COALESCE(v_empresa, 'Encanto')
    ),
    v_store
  );
END;
$function$;

-- ===== 7. Remove as 4 chaves da settings GLOBAL — nada mais as le (confirmado por auditoria: nenhuma
-- outra RPC referenciava essas chaves alem das 8 acima + enc_tempo_estimado, ja corrigida). Deixa-las
-- pra tras seria dado morto e enganoso (ADR §12.1 — settings fica reservada pro que e genuinamente da
-- plataforma). =====
DELETE FROM public.settings WHERE chave IN ('business_hours_schedule', 'delivery_fee_config', 'delivery_eta_min', 'store_mode');

COMMIT;
