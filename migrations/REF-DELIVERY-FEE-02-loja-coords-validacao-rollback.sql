-- Rollback REF-DELIVERY-FEE-02 — remove a validacao server-side de lojaLat/lojaLng, restaurando o
-- corpo EXATO de set_company_info de antes desta ref (copiado de migrations/REF-COMPANY-02-nome-split.sql).
-- Nenhuma transformacao de dado: esta ref so apertou validacao, nao mudou o formato salvo em
-- settings.company_info. Mesmo padrao das rollbacks anteriores de set_company_info (RPC viva, nao pode
-- ser derrubada com DROP FUNCTION — so CREATE OR REPLACE).

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
