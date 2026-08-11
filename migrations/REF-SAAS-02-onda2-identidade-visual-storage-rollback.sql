-- Rollback de REF-SAAS-02-onda2-identidade-visual-storage.sql

BEGIN;

DROP POLICY IF EXISTS "Scoped Insert Products" ON storage.objects;
DROP POLICY IF EXISTS "Scoped Update Products" ON storage.objects;
DROP POLICY IF EXISTS "Scoped Delete Products" ON storage.objects;

CREATE POLICY "Authenticated Upload Products" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'products');
CREATE POLICY "Authenticated Update Products" ON storage.objects FOR UPDATE
  USING (bucket_id = 'products') WITH CHECK (bucket_id = 'products');
CREATE POLICY "Authenticated Delete Products" ON storage.objects FOR DELETE
  USING (bucket_id = 'products');

DROP FUNCTION IF EXISTS public.storage_path_store_id(text);

-- Restaura set_company_info para a versao da Onda 6.2 (sem bannerUrl/logoPreset).
DROP FUNCTION IF EXISTS public.set_company_info(jsonb, uuid);

CREATE OR REPLACE FUNCTION public.set_company_info(p_patch jsonb, p_store_id uuid DEFAULT public.default_store_id())
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
  v_el      jsonb;
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RAISE EXCEPTION 'apenas administradores podem alterar os dados da empresa' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'payload invalido: esperado um objeto JSON' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'nomeCurto' THEN
    v_nomec := trim(both from (p_patch->>'nomeCurto'));
    IF v_nomec IS NULL OR length(v_nomec) < 2 THEN RAISE EXCEPTION 'nome curto invalido: informe ao menos 2 caracteres' USING ERRCODE = '22023'; END IF;
    p_patch := jsonb_set(p_patch, '{nomeCurto}', to_jsonb(v_nomec));
  END IF;
  IF p_patch ? 'nomeCompleto' THEN
    v_nomef := trim(both from (p_patch->>'nomeCompleto'));
    IF v_nomef IS NULL OR length(v_nomef) < 2 THEN RAISE EXCEPTION 'nome completo invalido: informe ao menos 2 caracteres' USING ERRCODE = '22023'; END IF;
    p_patch := jsonb_set(p_patch, '{nomeCompleto}', to_jsonb(v_nomef));
  END IF;
  IF p_patch ? 'telefone' THEN
    v_tel := public.enc_normalize_phone_br(p_patch->>'telefone');
    IF length(v_tel) NOT BETWEEN 12 AND 13 THEN RAISE EXCEPTION 'telefone invalido: % (informe DDD + numero)', p_patch->>'telefone' USING ERRCODE = '22023'; END IF;
    p_patch := jsonb_set(p_patch, '{telefone}', to_jsonb(v_tel));
  END IF;
  IF p_patch ? 'whatsapp' THEN
    v_wa := public.enc_normalize_phone_br(p_patch->>'whatsapp');
    IF length(v_wa) NOT BETWEEN 12 AND 13 THEN RAISE EXCEPTION 'whatsapp invalido: % (informe DDD + numero)', p_patch->>'whatsapp' USING ERRCODE = '22023'; END IF;
    p_patch := jsonb_set(p_patch, '{whatsapp}', to_jsonb(v_wa));
  END IF;
  IF p_patch ? 'email' THEN
    v_email := lower(trim(both from (p_patch->>'email')));
    IF v_email !~ '^.+@.+\..+$' THEN RAISE EXCEPTION 'email invalido: %', p_patch->>'email' USING ERRCODE = '22023'; END IF;
    p_patch := jsonb_set(p_patch, '{email}', to_jsonb(v_email));
  END IF;
  IF p_patch ? 'whatsappFloatEnabled' AND jsonb_typeof(p_patch->'whatsappFloatEnabled') <> 'boolean' THEN
    RAISE EXCEPTION 'whatsappFloatEnabled invalido: use true ou false' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'lojaLat' THEN
    IF jsonb_typeof(p_patch->'lojaLat') = 'null' THEN NULL;
    ELSIF jsonb_typeof(p_patch->'lojaLat') <> 'number' THEN RAISE EXCEPTION 'lojaLat invalido: informe um numero (ou null para limpar)' USING ERRCODE = '22023';
    ELSE
      v_lat := (p_patch->>'lojaLat')::double precision;
      IF v_lat < -90 OR v_lat > 90 THEN RAISE EXCEPTION 'lojaLat invalido: % (fora do intervalo -90..90)', v_lat USING ERRCODE = '22023'; END IF;
    END IF;
  END IF;
  IF p_patch ? 'lojaLng' THEN
    IF jsonb_typeof(p_patch->'lojaLng') = 'null' THEN NULL;
    ELSIF jsonb_typeof(p_patch->'lojaLng') <> 'number' THEN RAISE EXCEPTION 'lojaLng invalido: informe um numero (ou null para limpar)' USING ERRCODE = '22023';
    ELSE
      v_lng := (p_patch->>'lojaLng')::double precision;
      IF v_lng < -180 OR v_lng > 180 THEN RAISE EXCEPTION 'lojaLng invalido: % (fora do intervalo -180..180)', v_lng USING ERRCODE = '22023'; END IF;
    END IF;
  END IF;
  IF p_patch ? 'logoUrl' THEN
    IF jsonb_typeof(p_patch->'logoUrl') = 'null' THEN NULL;
    ELSIF jsonb_typeof(p_patch->'logoUrl') <> 'string' OR (p_patch->>'logoUrl') !~ '^https?://' THEN
      RAISE EXCEPTION 'logoUrl invalido: informe uma URL http(s) (ou null para remover)' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_patch ? 'faviconUrl' THEN
    IF jsonb_typeof(p_patch->'faviconUrl') = 'null' THEN NULL;
    ELSIF jsonb_typeof(p_patch->'faviconUrl') <> 'string' OR (p_patch->>'faviconUrl') !~ '^https?://' THEN
      RAISE EXCEPTION 'faviconUrl invalido: informe uma URL http(s) (ou null para remover)' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_patch ? 'corPrimaria' AND (jsonb_typeof(p_patch->'corPrimaria') <> 'string' OR (p_patch->>'corPrimaria') !~ '^#[0-9A-Fa-f]{6}$') THEN
    RAISE EXCEPTION 'corPrimaria invalida: use o formato #RRGGBB' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'corSecundaria' AND (jsonb_typeof(p_patch->'corSecundaria') <> 'string' OR (p_patch->>'corSecundaria') !~ '^#[0-9A-Fa-f]{6}$') THEN
    RAISE EXCEPTION 'corSecundaria invalida: use o formato #RRGGBB' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'corDestaque' AND (jsonb_typeof(p_patch->'corDestaque') <> 'string' OR (p_patch->>'corDestaque') !~ '^#[0-9A-Fa-f]{6}$') THEN
    RAISE EXCEPTION 'corDestaque invalida: use o formato #RRGGBB' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'termosSecoes' THEN
    IF jsonb_typeof(p_patch->'termosSecoes') <> 'array' THEN RAISE EXCEPTION 'termosSecoes invalido: esperado um array de secoes' USING ERRCODE = '22023'; END IF;
    FOR v_el IN SELECT * FROM jsonb_array_elements(p_patch->'termosSecoes') LOOP
      IF jsonb_typeof(v_el) <> 'object' OR NOT (v_el ? 'titulo') OR NOT (v_el ? 'corpo')
         OR jsonb_typeof(v_el->'titulo') <> 'string' OR jsonb_typeof(v_el->'corpo') <> 'string' THEN
        RAISE EXCEPTION 'termosSecoes invalido: cada secao precisa de {titulo, corpo} em texto' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;
  IF p_patch ? 'fidelidadeTexto' THEN
    IF jsonb_typeof(p_patch->'fidelidadeTexto') <> 'array' THEN RAISE EXCEPTION 'fidelidadeTexto invalido: esperado um array de paragrafos' USING ERRCODE = '22023'; END IF;
    FOR v_el IN SELECT * FROM jsonb_array_elements(p_patch->'fidelidadeTexto') LOOP
      IF jsonb_typeof(v_el) <> 'string' THEN RAISE EXCEPTION 'fidelidadeTexto invalido: cada paragrafo precisa ser texto' USING ERRCODE = '22023'; END IF;
    END LOOP;
  END IF;
  SELECT valor::jsonb INTO v_atual FROM public.store_settings WHERE store_id = p_store_id AND chave = 'company_info' LIMIT 1;
  v_merged := COALESCE(v_atual, '{}'::jsonb) || p_patch;
  INSERT INTO public.store_settings (store_id, chave, valor) VALUES (p_store_id, 'company_info', v_merged::text)
  ON CONFLICT (store_id, chave) DO UPDATE SET valor = EXCLUDED.valor;
  RETURN v_merged;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_company_info(jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_company_info(jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_company_info(jsonb, uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
