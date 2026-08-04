-- REF-BUSINESS-HOURS-04 — Cronograma SEMANAL de funcionamento como configuracao administrativa.
-- Ate aqui (HB-01/02/03) so o OVERRIDE (AUTO/OPEN/CLOSED) vivia no banco (store_mode); o cronograma em
-- si (quais dias abrem, em quais horarios, quantos periodos) continuava HARDCODED em
-- src/services/businessHours/schedule.js. Esta migration fecha essa lacuna: reutiliza public.settings
-- (chave/valor) — UMA chave 'business_hours_schedule', valor = objeto JSON (texto). Espelha exatamente o
-- padrao ja provado por REF-BUSINESS-HOURS-03 (store_mode), REF-DELIVERY-01 (delivery_eta_min) e
-- REF-COMPANY-01 (company_info, tambem um objeto JSON inteiro numa chave so).
--
-- FORMATO do objeto (preparado para evoluir — ver comentario de set_business_hours_schedule):
--   {
--     "version": 1,
--     "timezone": "America/Sao_Paulo",
--     "schedule": {
--       "domingo": { "fechado": true,  "periodos": [] },
--       "segunda": { "fechado": false, "periodos": [{"ini":"10:00","fim":"15:00"}] },
--       ... terca..sabado (nomes dos dias, nao indices — legibilidade no banco) ...
--     },
--     "exceptions": {}   -- gancho para feriados/datas especiais; vazio de proposito nesta entrega
--   }
--
-- get_business_hours_schedule() -> leitura PUBLICA (anon + authenticated), SECURITY DEFINER (mesma razao
-- de get_store_mode/get_delivery_eta/get_company_info: a RLS de settings e TRANCADA, get_setting generico
-- NAO enxerga a linha chamado do browser anonimo).
-- set_business_hours_schedule(jsonb) -> escrita restrita a ADMIN (is_admin()). Recebe o objeto INTEIRO
-- (nao e PATCH como set_company_info: aqui a substituicao e total, pois o cronograma e uma unidade so).
-- Revalida SERVIDOR tudo que a UI ja valida: os 7 dias presentes, "fechado" booleano, "periodos" lista de
-- {ini,fim} em HH:MM (00:00-23:59), fim>ini, sem sobreposicao nem duplicata dentro do dia. version/timezone
-- sao normalizados no servidor (ignora o que o cliente mandar); exceptions aceito se for objeto, senao {}.
-- Retorna o objeto CANONICO persistido (periodos ordenados por horario) — fonte truthful.
--
-- Sem tabela nova, sem localStorage como fonte, FONTE UNICA no banco. IDEMPOTENTE (INSERT ... ON CONFLICT
-- DO NOTHING / CREATE OR REPLACE / grants repetiveis), VERSIONADA, preserva os dados existentes de settings
-- (so acrescenta a chave 'business_hours_schedule'). Rollback em arquivo separado.

BEGIN;

-- Semente idempotente = EXATAMENTE o horario hoje hardcoded em schedule.js (zero mudanca de comportamento
-- no deploy): domingo fechado; segunda so manha; terca-sabado manha+noite. Nao sobrescreve se ja existir.
INSERT INTO public.settings (chave, valor)
VALUES (
  'business_hours_schedule',
  '{"version":1,"timezone":"America/Sao_Paulo","schedule":{"domingo":{"fechado":true,"periodos":[]},"segunda":{"fechado":false,"periodos":[{"ini":"10:00","fim":"15:00"}]},"terca":{"fechado":false,"periodos":[{"ini":"10:00","fim":"15:00"},{"ini":"17:00","fim":"22:00"}]},"quarta":{"fechado":false,"periodos":[{"ini":"10:00","fim":"15:00"},{"ini":"17:00","fim":"22:00"}]},"quinta":{"fechado":false,"periodos":[{"ini":"10:00","fim":"15:00"},{"ini":"17:00","fim":"22:00"}]},"sexta":{"fechado":false,"periodos":[{"ini":"10:00","fim":"15:00"},{"ini":"17:00","fim":"22:00"}]},"sabado":{"fechado":false,"periodos":[{"ini":"10:00","fim":"15:00"},{"ini":"17:00","fim":"22:00"}]}},"exceptions":{}}'
)
ON CONFLICT (chave) DO NOTHING;

-- Leitura publica (loja anon precisa calcular aberto/fechado; Admin precisa exibir o form). Default embutido
-- = a mesma semente acima, defesa em profundidade caso a chave nunca tenha sido inserida.
CREATE OR REPLACE FUNCTION public.get_business_hours_schedule()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT COALESCE(
    (SELECT valor::jsonb FROM public.settings WHERE chave = 'business_hours_schedule' LIMIT 1),
    '{"version":1,"timezone":"America/Sao_Paulo","schedule":{"domingo":{"fechado":true,"periodos":[]},"segunda":{"fechado":false,"periodos":[{"ini":"10:00","fim":"15:00"}]},"terca":{"fechado":false,"periodos":[{"ini":"10:00","fim":"15:00"},{"ini":"17:00","fim":"22:00"}]},"quarta":{"fechado":false,"periodos":[{"ini":"10:00","fim":"15:00"},{"ini":"17:00","fim":"22:00"}]},"quinta":{"fechado":false,"periodos":[{"ini":"10:00","fim":"15:00"},{"ini":"17:00","fim":"22:00"}]},"sexta":{"fechado":false,"periodos":[{"ini":"10:00","fim":"15:00"},{"ini":"17:00","fim":"22:00"}]},"sabado":{"fechado":false,"periodos":[{"ini":"10:00","fim":"15:00"},{"ini":"17:00","fim":"22:00"}]}},"exceptions":{}}'::jsonb
  );
$function$;

-- Escrita restrita ao administrador. Substitui o cronograma INTEIRO (validado) e retorna o objeto canonico
-- persistido. is_admin() ja definido em AUTH-01-step1-fundacao.sql.
CREATE OR REPLACE FUNCTION public.set_business_hours_schedule(p_schedule jsonb)
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
  IF NOT public.is_admin() THEN
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

    -- (1) valida CADA periodo: objeto, HH:MM 00:00-23:59, fim > inicio.
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

    -- (2) sem sobreposicao/duplicata: percorre em ordem crescente de inicio, cada periodo so pode comecar
    -- no fim (ou depois) do anterior. Toque exato (10-14 seguido de 14-18) e permitido; sobreposto/igual nao.
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

    -- periodos CANONICOS (ordenados por horario de inicio — HH:MM ordena igual lexicografico e numerico).
    SELECT COALESCE(jsonb_agg(p ORDER BY (p->>'ini')), '[]'::jsonb)
      INTO v_ordenados
      FROM jsonb_array_elements(v_periodos) p;

    v_schedule := v_schedule || jsonb_build_object(v_dia, jsonb_build_object('fechado', v_fechado, 'periodos', v_ordenados));
  END LOOP;

  -- exceptions: aceito se for objeto (gancho futuro de feriados); senao, {} (nunca implementado nesta entrega).
  v_exceptions := p_schedule->'exceptions';
  IF v_exceptions IS NULL OR jsonb_typeof(v_exceptions) <> 'object' THEN
    v_exceptions := '{}'::jsonb;
  END IF;

  -- version/timezone SEMPRE normalizados no servidor (nunca confia no que o cliente mandar aqui).
  v_result := jsonb_build_object(
    'version', 1,
    'timezone', 'America/Sao_Paulo',
    'schedule', v_schedule,
    'exceptions', v_exceptions
  );

  INSERT INTO public.settings (chave, valor)
  VALUES ('business_hours_schedule', v_result::text)
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor;

  RETURN v_result;
END;
$function$;

-- Grants (defense-in-depth, mesmo padrao de get/set_store_mode, get/set_delivery_eta, get/set_company_info).
REVOKE ALL ON FUNCTION public.get_business_hours_schedule()          FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_business_hours_schedule(jsonb)     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_business_hours_schedule(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_business_hours_schedule()      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_business_hours_schedule(jsonb) TO authenticated;

COMMIT;

-- Expoe as novas funcoes na API PostgREST imediatamente.
NOTIFY pgrst, 'reload schema';
