-- REF-DELIVERY-FEE-02 — Blindagem servidor das coordenadas da loja (company_info.lojaLat/lojaLng).
--
-- CONTEXTO (auditoria pos-implantacao da REF-DELIVERY-FEE-01): lojaLat/lojaLng entraram em
-- company_info via merge raso (sem migration propria, ver REF-DELIVERY-FEE-01) com a nota explicita
-- "validacao NUMERICA fica so no cliente" (services/company/companyInfoRules.js). Na pratica isso e
-- seguro enquanto a UNICA origem do valor for o arrasto do pino no mapa Leaflet (sempre numero real) —
-- mas set_company_info(jsonb) e uma RPC generica: qualquer chamada autenticada (nao so o AdminTaxaEntrega)
-- pode mandar {"lojaLat": "banana"} ou {"lojaLat": 999} e o servidor aceitava sem reclamar, ao contrario
-- de nome/telefone/whatsapp/email (que ja tem guarda server-side desde REF-COMPANY-01/02). Esta migration
-- fecha essa assimetria SO para lojaLat/lojaLng (risco operacional real: coordenada invalida corrompe o
-- calculo de distancia do checkout) — nao amplia validacao para os demais campos "de preparo" (sobre,
-- redes sociais, endereco institucional, cnpj, timezone/idioma/moeda), que continuam fora de escopo desta
-- ref, exatamente como documentado em REF-COMPANY-03.
--
-- REAPROVEITA company_info (mesma chave, mesma RPC set_company_info) — SEM tabela nova, SEM RPC nova,
-- SEM servico paralelo. CREATE OR REPLACE preserva grants (mesmo precedente de REF-COMPANY-02). Corpo
-- base = a versao vigente hoje (migrations/REF-COMPANY-02-nome-split.sql), com 2 blocos novos acrescidos
-- (lojaLat/lojaLng) espelhando EXATAMENTE a mesma regra ja validada no cliente
-- (validarPatchCompanyInfo, tests/company-info.golden.mjs): null e valido (limpa o pino), presente
-- precisa ser um NUMERO JSON (jsonb_typeof = 'number' — nunca aceita string/bool/array/objeto; "impede
-- NaN" da unica forma possivel em SQL, um valor nao-numerico simplesmente nao passa no typeof), dentro
-- de -90..90 (lat) / -180..180 (lng). get_company_info() NAO muda (leitura ja e permissiva por design,
-- defaults cobrem base nova).
--
-- Requer REF-COMPANY-02-nome-split.sql (ja aplicada). Rollback em arquivo separado.

BEGIN;

CREATE OR REPLACE FUNCTION public.set_company_info(p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_atual   jsonb;
  v_merged  jsonb;
  v_nomec   text;
  v_nomef   text;
  v_tel     text;
  v_wa      text;
  v_email   text;
  v_lat     double precision;
  v_lng     double precision;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'apenas administradores podem alterar os dados da empresa'
      USING ERRCODE = '42501';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'payload invalido: esperado um objeto JSON'
      USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'nomeCurto' THEN
    v_nomec := trim(both from (p_patch->>'nomeCurto'));
    IF v_nomec IS NULL OR length(v_nomec) < 2 THEN
      RAISE EXCEPTION 'nome curto invalido: informe ao menos 2 caracteres'
        USING ERRCODE = '22023';
    END IF;
    p_patch := jsonb_set(p_patch, '{nomeCurto}', to_jsonb(v_nomec));
  END IF;

  IF p_patch ? 'nomeCompleto' THEN
    v_nomef := trim(both from (p_patch->>'nomeCompleto'));
    IF v_nomef IS NULL OR length(v_nomef) < 2 THEN
      RAISE EXCEPTION 'nome completo invalido: informe ao menos 2 caracteres'
        USING ERRCODE = '22023';
    END IF;
    p_patch := jsonb_set(p_patch, '{nomeCompleto}', to_jsonb(v_nomef));
  END IF;

  IF p_patch ? 'telefone' THEN
    v_tel := public.enc_normalize_phone_br(p_patch->>'telefone');
    IF length(v_tel) NOT BETWEEN 12 AND 13 THEN
      RAISE EXCEPTION 'telefone invalido: % (informe DDD + numero)', p_patch->>'telefone'
        USING ERRCODE = '22023';
    END IF;
    p_patch := jsonb_set(p_patch, '{telefone}', to_jsonb(v_tel));
  END IF;

  IF p_patch ? 'whatsapp' THEN
    v_wa := public.enc_normalize_phone_br(p_patch->>'whatsapp');
    IF length(v_wa) NOT BETWEEN 12 AND 13 THEN
      RAISE EXCEPTION 'whatsapp invalido: % (informe DDD + numero)', p_patch->>'whatsapp'
        USING ERRCODE = '22023';
    END IF;
    p_patch := jsonb_set(p_patch, '{whatsapp}', to_jsonb(v_wa));
  END IF;

  IF p_patch ? 'email' THEN
    v_email := lower(trim(both from (p_patch->>'email')));
    IF v_email !~ '^.+@.+\..+$' THEN
      RAISE EXCEPTION 'email invalido: %', p_patch->>'email'
        USING ERRCODE = '22023';
    END IF;
    p_patch := jsonb_set(p_patch, '{email}', to_jsonb(v_email));
  END IF;

  IF p_patch ? 'whatsappFloatEnabled' AND jsonb_typeof(p_patch->'whatsappFloatEnabled') <> 'boolean' THEN
    RAISE EXCEPTION 'whatsappFloatEnabled invalido: use true ou false'
      USING ERRCODE = '22023';
  END IF;

  -- REF-DELIVERY-FEE-02: localizacao operacional da loja — null e valido (limpar o pino); presente
  -- PRECISA ser um numero JSON dentro do intervalo geografico global (mesma regra do cliente).
  IF p_patch ? 'lojaLat' THEN
    IF jsonb_typeof(p_patch->'lojaLat') = 'null' THEN
      NULL;
    ELSIF jsonb_typeof(p_patch->'lojaLat') <> 'number' THEN
      RAISE EXCEPTION 'lojaLat invalido: informe um numero (ou null para limpar)'
        USING ERRCODE = '22023';
    ELSE
      v_lat := (p_patch->>'lojaLat')::double precision;
      IF v_lat < -90 OR v_lat > 90 THEN
        RAISE EXCEPTION 'lojaLat invalido: % (fora do intervalo -90..90)', v_lat
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  IF p_patch ? 'lojaLng' THEN
    IF jsonb_typeof(p_patch->'lojaLng') = 'null' THEN
      NULL;
    ELSIF jsonb_typeof(p_patch->'lojaLng') <> 'number' THEN
      RAISE EXCEPTION 'lojaLng invalido: informe um numero (ou null para limpar)'
        USING ERRCODE = '22023';
    ELSE
      v_lng := (p_patch->>'lojaLng')::double precision;
      IF v_lng < -180 OR v_lng > 180 THEN
        RAISE EXCEPTION 'lojaLng invalido: % (fora do intervalo -180..180)', v_lng
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  SELECT valor::jsonb INTO v_atual FROM public.settings WHERE chave = 'company_info' LIMIT 1;
  v_merged := COALESCE(v_atual, '{}'::jsonb) || p_patch;

  INSERT INTO public.settings (chave, valor)
  VALUES ('company_info', v_merged::text)
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor;

  RETURN v_merged;
END;
$function$;

COMMIT;

-- Expoe a funcao redefinida na API PostgREST imediatamente.
NOTIFY pgrst, 'reload schema';

-- VERIFICACAO (rodar manualmente apos aplicar, como admin autenticado):
--   SELECT set_company_info('{"lojaLat": 999}'::jsonb);            -- deve falhar: fora do intervalo -90..90
--   SELECT set_company_info('{"lojaLat": "abc"}'::jsonb);          -- deve falhar: nao e numero
--   SELECT set_company_info('{"lojaLat": -26.795, "lojaLng": -49.270}'::jsonb);  -- deve gravar normalmente
--   SELECT set_company_info('{"lojaLat": null, "lojaLng": null}'::jsonb);        -- deve limpar o pino (valido)
