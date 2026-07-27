-- Rollback REF-COMPANY-02 (1/9) — desfaz o split nomeCurto/nomeCompleto, restaurando o campo unico
-- 'nome' e os corpos anteriores (REF-COMPANY-01) de get_company_info/set_company_info.
--
-- DIFERENTE das rollbacks anteriores deste projeto (que so faziam DROP FUNCTION, porque as funcoes
-- eram novas): get_company_info/set_company_info sao RPCs vivas, consumidas pela loja inteira — nao
-- podem ser derrubadas sem quebrar producao. Este rollback restaura os corpos EXATOS de antes desta
-- ref (copiados de migrations/REF-COMPANY-01-institutional-info.sql) via CREATE OR REPLACE.

BEGIN;

-- Reverte o dado: nomeCompleto volta a se chamar 'nome'; nomeCurto e descartado (nao existia antes).
UPDATE public.settings
SET valor = (
  (valor::jsonb - 'nomeCompleto' - 'nomeCurto')
  || jsonb_build_object('nome', COALESCE(valor::jsonb->'nomeCompleto', to_jsonb('Encanto — Açaí & Marmitas'::text)))
)::text
WHERE chave = 'company_info'
  AND valor::jsonb ? 'nomeCompleto';

CREATE OR REPLACE FUNCTION public.get_company_info()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT
    '{"nome":"Encanto — Açaí & Marmitas","telefone":"5547992722920","whatsapp":"5547992722920","email":"contato@encantoacai.com.br","whatsappFloatEnabled":true}'::jsonb
    || COALESCE((SELECT valor::jsonb FROM public.settings WHERE chave = 'company_info' LIMIT 1), '{}'::jsonb);
$function$;

CREATE OR REPLACE FUNCTION public.set_company_info(p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_atual  jsonb;
  v_merged jsonb;
  v_nome   text;
  v_tel    text;
  v_wa     text;
  v_email  text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'apenas administradores podem alterar os dados da empresa'
      USING ERRCODE = '42501';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'payload invalido: esperado um objeto JSON'
      USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'nome' THEN
    v_nome := trim(both from (p_patch->>'nome'));
    IF v_nome IS NULL OR length(v_nome) < 2 THEN
      RAISE EXCEPTION 'nome invalido: informe ao menos 2 caracteres'
        USING ERRCODE = '22023';
    END IF;
    p_patch := jsonb_set(p_patch, '{nome}', to_jsonb(v_nome));
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

  SELECT valor::jsonb INTO v_atual FROM public.settings WHERE chave = 'company_info' LIMIT 1;
  v_merged := COALESCE(v_atual, '{}'::jsonb) || p_patch;

  INSERT INTO public.settings (chave, valor)
  VALUES ('company_info', v_merged::text)
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor;

  RETURN v_merged;
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
