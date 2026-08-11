-- REF-SAAS-02 · Onda 2 — Auditoria + configuracao visual + infraestrutura de tenants.
-- Baseline: commits 42ab1d9/76360da (Onda 1, Platform Console). NAO recria provision_store/
-- link_store_admin/is_admin_anywhere/is_admin_of/is_super_admin/get_store_by_domain -- intocados.
--
-- Escopo desta migration:
--   1. set_company_info ganha 2 campos novos: bannerUrl (imagem de fundo do cabecalho da loja, ate hoje
--      um ARQUIVO ESTATICO compartilhado por todo o bundle, header-bg.webp -- nao existia NENHUM campo
--      por loja pra isto) e logoPreset (como a logo e apresentada -- ate hoje 100% fixo em CSS, sem
--      nenhuma opcao). Mesmo padrao de logoUrl/faviconUrl: null valido (remove/usa padrao), presente
--      precisa ser URL http(s) (bannerUrl) ou um dos 2 valores aceitos (logoPreset).
--   2. Storage: as policies de escrita (INSERT/UPDATE/DELETE) do bucket "products" hoje sao
--      "qualquer authenticated, path livre" -- SEM checar is_admin_of, SEM checar store_id no path.
--      ACHADO REAL da auditoria (Fase 10 da REF): qualquer conta logada (nem precisa ser admin de
--      loja nenhuma) podia sobrescrever/apagar QUALQUER imagem do bucket, inclusive da Encanto, so
--      adivinhando/reusando um nome de arquivo. Fix: novas policies exigem is_admin_of(store_id) do
--      PROPRIO STORE_ID EMBUTIDO NO PATH (padrao novo: stores/{store_id}/...). Caminhos SEM esse
--      prefixo (100% dos arquivos hoje existentes -- produtos/branding da Encanto, todos com o path
--      antigo) continuam protegidos, mas exigem especificamente is_admin_of(default_store_id()) --
--      ou seja, so' quem administra a Encanto (ou super admin) continua podendo escrever nos caminhos
--      antigos. NENHUM arquivo e movido/renomeado -- Encanto continua acessando os MESMOS arquivos,
--      nos MESMOS paths, sem nenhuma migracao de dado. Leitura publica (bucket "products" e' public)
--      NAO muda -- o storefront precisa continuar servindo imagem sem autenticacao.

BEGIN;

-- ===== 1. set_company_info: +bannerUrl, +logoPreset (mesma validacao de logoUrl/faviconUrl/paleta). =====
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

  -- REF-SAAS-02 · Onda 2 (bug real achado em teste E2E, pre-existente a esta onda): telefone/whatsapp
  -- vazio e' um estado VALIDO ("ainda nao configurado" -- a propria UI ja mostra um aviso amarelo pra
  -- esse caso), mas a validacao rejeitava SEMPRE que o patch incluia o campo vazio -- e paraPatch()
  -- do AdminEmpresa.jsx inclui telefone/whatsapp em TODO save, mesmo quando o admin so mudou outro
  -- campo. Resultado pratico: uma loja nova (telefone/whatsapp vazios por padrao, ver provision_store)
  -- nunca conseguia salvar NADA na tela Empresa, nem o proprio nome, antes de configurar o telefone
  -- primeiro. Fix: vazio passa a ser valido (mesma regra de logoUrl/faviconUrl/bannerUrl/redes sociais);
  -- so' um valor NAO-VAZIO com tamanho errado e' rejeitado.
  IF p_patch ? 'telefone' THEN
    v_tel := public.enc_normalize_phone_br(p_patch->>'telefone');
    IF v_tel <> '' AND length(v_tel) NOT BETWEEN 12 AND 13 THEN
      RAISE EXCEPTION 'telefone invalido: % (informe DDD + numero, ou deixe em branco)', p_patch->>'telefone'
        USING ERRCODE = '22023';
    END IF;
    p_patch := jsonb_set(p_patch, '{telefone}', to_jsonb(v_tel));
  END IF;

  IF p_patch ? 'whatsapp' THEN
    v_wa := public.enc_normalize_phone_br(p_patch->>'whatsapp');
    IF v_wa <> '' AND length(v_wa) NOT BETWEEN 12 AND 13 THEN
      RAISE EXCEPTION 'whatsapp invalido: % (informe DDD + numero, ou deixe em branco)', p_patch->>'whatsapp'
        USING ERRCODE = '22023';
    END IF;
    p_patch := jsonb_set(p_patch, '{whatsapp}', to_jsonb(v_wa));
  END IF;

  -- REF-SAAS-02 · Onda 2 (mesma classe de bug do telefone/whatsapp acima): email vazio tambem e' um
  -- estado valido ("ainda nao configurado"), e paraPatch() do AdminEmpresa.jsx sempre inclui email.
  IF p_patch ? 'email' THEN
    v_email := lower(trim(both from (p_patch->>'email')));
    IF v_email <> '' AND v_email !~ '^.+@.+\..+$' THEN
      RAISE EXCEPTION 'email invalido: % (ou deixe em branco)', p_patch->>'email'
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

  IF p_patch ? 'logoUrl' THEN
    IF jsonb_typeof(p_patch->'logoUrl') = 'null' THEN
      NULL;
    ELSIF jsonb_typeof(p_patch->'logoUrl') <> 'string' OR (p_patch->>'logoUrl') !~ '^https?://' THEN
      RAISE EXCEPTION 'logoUrl invalido: informe uma URL http(s) (ou null para remover)'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_patch ? 'faviconUrl' THEN
    IF jsonb_typeof(p_patch->'faviconUrl') = 'null' THEN
      NULL;
    ELSIF jsonb_typeof(p_patch->'faviconUrl') <> 'string' OR (p_patch->>'faviconUrl') !~ '^https?://' THEN
      RAISE EXCEPTION 'faviconUrl invalido: informe uma URL http(s) (ou null para remover)'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- ===== REF-SAAS-02 · Onda 2: bannerUrl -- imagem de fundo do cabecalho, por loja. Mesma regra de
  -- logoUrl/faviconUrl (null limpa/usa fallback neutro; presente precisa ser URL http(s)). =====
  IF p_patch ? 'bannerUrl' THEN
    IF jsonb_typeof(p_patch->'bannerUrl') = 'null' THEN
      NULL;
    ELSIF jsonb_typeof(p_patch->'bannerUrl') <> 'string' OR (p_patch->>'bannerUrl') !~ '^https?://' THEN
      RAISE EXCEPTION 'bannerUrl invalido: informe uma URL http(s) (ou null para remover)'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- ===== REF-SAAS-02 · Onda 2: logoPreset -- como a logo e apresentada no cabecalho. 'organico' e' o
  -- unico formato que existe hoje (moldura organica/blob, pensada pra logo da Encanto); 'retangular'
  -- (sem recorte, so' contain) e' pra logos horizontais/quadradas de novos tenants. Nunca null como
  -- "erro" -- ausente = 'organico' no consumo (default do frontend), nao precisa gravar explicito. =====
  IF p_patch ? 'logoPreset' AND (p_patch->>'logoPreset') NOT IN ('organico', 'retangular') THEN
    RAISE EXCEPTION 'logoPreset invalido: use organico ou retangular' USING ERRCODE = '22023';
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
    IF jsonb_typeof(p_patch->'termosSecoes') <> 'array' THEN
      RAISE EXCEPTION 'termosSecoes invalido: esperado um array de secoes' USING ERRCODE = '22023';
    END IF;
    FOR v_el IN SELECT * FROM jsonb_array_elements(p_patch->'termosSecoes') LOOP
      IF jsonb_typeof(v_el) <> 'object' OR NOT (v_el ? 'titulo') OR NOT (v_el ? 'corpo')
         OR jsonb_typeof(v_el->'titulo') <> 'string' OR jsonb_typeof(v_el->'corpo') <> 'string' THEN
        RAISE EXCEPTION 'termosSecoes invalido: cada secao precisa de {titulo, corpo} em texto' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  IF p_patch ? 'fidelidadeTexto' THEN
    IF jsonb_typeof(p_patch->'fidelidadeTexto') <> 'array' THEN
      RAISE EXCEPTION 'fidelidadeTexto invalido: esperado um array de paragrafos' USING ERRCODE = '22023';
    END IF;
    FOR v_el IN SELECT * FROM jsonb_array_elements(p_patch->'fidelidadeTexto') LOOP
      IF jsonb_typeof(v_el) <> 'string' THEN
        RAISE EXCEPTION 'fidelidadeTexto invalido: cada paragrafo precisa ser texto' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  SELECT valor::jsonb INTO v_atual FROM public.store_settings WHERE store_id = p_store_id AND chave = 'company_info' LIMIT 1;
  v_merged := COALESCE(v_atual, '{}'::jsonb) || p_patch;

  INSERT INTO public.store_settings (store_id, chave, valor)
  VALUES (p_store_id, 'company_info', v_merged::text)
  ON CONFLICT (store_id, chave) DO UPDATE SET valor = EXCLUDED.valor;

  RETURN v_merged;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_company_info(jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_company_info(jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_company_info(jsonb, uuid) TO authenticated;

-- ===== 2. storage_path_store_id: extrai o store_id de um path "stores/{uuid}/..." de forma segura
-- (nunca lanca excecao pra path malformado -- devolve NULL, que cai no ramo "legado" da policy abaixo).
CREATE OR REPLACE FUNCTION public.storage_path_store_id(p_name text)
 RETURNS uuid
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE
    WHEN (storage.foldername(p_name))[1] = 'stores'
     AND (storage.foldername(p_name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN ((storage.foldername(p_name))[2])::uuid
    ELSE NULL
  END;
$function$;

GRANT EXECUTE ON FUNCTION public.storage_path_store_id(text) TO anon, authenticated;

-- ===== 3. Storage (bucket "products"): escrita passa a exigir is_admin_of(store_id do path). Path SEM
-- prefixo "stores/{uuid}/" (100% dos arquivos hoje existentes) cai no ramo legado: exige
-- is_admin_of(default_store_id()) -- so' quem administra a Encanto continua escrevendo nesses paths.
-- Leitura publica INTOCADA (storefront precisa continuar servindo imagem sem autenticacao). =====
-- IF EXISTS nos 2 conjuntos de nomes (legado E o novo desta propria migration) -- torna este arquivo
-- seguro de rodar mais de uma vez (ex.: reaplicar apos um ajuste na MESMA sessao de trabalho).
DROP POLICY IF EXISTS "Authenticated Upload Products" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Update Products" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Delete Products" ON storage.objects;
DROP POLICY IF EXISTS "Scoped Insert Products" ON storage.objects;
DROP POLICY IF EXISTS "Scoped Update Products" ON storage.objects;
DROP POLICY IF EXISTS "Scoped Delete Products" ON storage.objects;

CREATE POLICY "Scoped Insert Products" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'products'
    AND public.is_admin_of(COALESCE(public.storage_path_store_id(name), public.default_store_id()))
  );

CREATE POLICY "Scoped Update Products" ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'products'
    AND public.is_admin_of(COALESCE(public.storage_path_store_id(name), public.default_store_id()))
  )
  WITH CHECK (
    bucket_id = 'products'
    AND public.is_admin_of(COALESCE(public.storage_path_store_id(name), public.default_store_id()))
  );

CREATE POLICY "Scoped Delete Products" ON storage.objects FOR DELETE
  USING (
    bucket_id = 'products'
    AND public.is_admin_of(COALESCE(public.storage_path_store_id(name), public.default_store_id()))
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
