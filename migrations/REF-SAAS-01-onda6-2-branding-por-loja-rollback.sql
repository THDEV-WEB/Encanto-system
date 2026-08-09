-- REF-SAAS-01 · Onda 6.2 — ROLLBACK. Restaura company_info em settings (global), restaura
-- get_company_info()/set_company_info(jsonb) com is_admin() (sem p_store_id), restaura
-- enc_enqueue_notification pre-6.2, remove a chave de store_settings.

BEGIN;

-- 1. Restaura o dado em settings a partir da loja padrao (encanto) em store_settings.
INSERT INTO public.settings (chave, valor)
SELECT 'company_info', valor
FROM public.store_settings
WHERE store_id = public.default_store_id() AND chave = 'company_info'
ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor;

DELETE FROM public.store_settings WHERE chave = 'company_info';

-- 2. Restaura as assinaturas antigas.
DROP FUNCTION IF EXISTS public.get_company_info(uuid);
DROP FUNCTION IF EXISTS public.set_company_info(jsonb, uuid);

CREATE OR REPLACE FUNCTION public.get_company_info()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT
    '{"nomeCurto":"Encanto","nomeCompleto":"Encanto — Açaí & Marmitas","telefone":"5547992722920","whatsapp":"5547992722920","email":"contato@encantoacai.com.br","whatsappFloatEnabled":true}'::jsonb
    || COALESCE((SELECT valor::jsonb FROM public.settings WHERE chave = 'company_info' LIMIT 1), '{}'::jsonb);
$function$;

REVOKE ALL ON FUNCTION public.get_company_info() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_info() TO anon, authenticated;

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

REVOKE ALL ON FUNCTION public.set_company_info(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_company_info(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_company_info(jsonb) TO authenticated;

-- 3. Restaura enc_enqueue_notification para a versao pre-6.2 (get_company_info() sem store_id).
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

COMMIT;

NOTIFY pgrst, 'reload schema';
