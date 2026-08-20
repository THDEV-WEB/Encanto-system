-- REF-STORE-ONBOARD-01 · Onda 2 (cont.) -- Opcao C: wildcard restrito a subzona lojas.valionsistemas.com.br.
-- Especificacao completa aprovada pelo dono antes desta migration (comparacao A/B/C com fontes oficiais
-- da Vercel, achado de que wildcard direto na raiz exige migrar TODOS os nameservers do dominio -- alto
-- blast radius, rejeitado). Padrao definitivo, NAO transitorio:
--   NOVO (a partir de agora):    {slug}.lojas.valionsistemas.com.br        (storefront)
--                                admin-{slug}.lojas.valionsistemas.com.br (admin/convite)
--   LEGADO (Encanto, congelado): {slug}.valionsistemas.com.br
--                                admin.{slug}.valionsistemas.com.br
-- Todo ramo abaixo e ADITIVO -- nenhum comportamento legado muda, Encanto fica byte-identica.
--
-- Admin usa HIFEN (admin-{slug}), nao ponto (admin.{slug}): um wildcard DNS estatico so cobre 1 nivel
-- de profundidade -- *.lojas.valionsistemas.com.br cobre {slug}.lojas... (1 label) mas NAO cobriria
-- admin.{slug}.lojas... (2 labels). admin-{slug} e 1 label so, coberto pelo MESMO wildcard, sem precisar
-- de uma segunda subzona/delegacao NS.

BEGIN;

-- ===== 1. get_store_by_domain: ganha 3o ramo pro padrao novo, ordem de especificidade preservada
-- (dominio explicito > legado {slug}.valionsistemas.com.br > novo {slug}.lojas.valionsistemas.com.br >
-- default_store_id()). Os 2 primeiros ramos sao byte-identicos ao que ja roda em producao.
CREATE OR REPLACE FUNCTION public.get_store_by_domain(p_hostname text)
 RETURNS TABLE(store_id uuid, slug text, nome text, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT s.id, s.slug, s.nome, s.status
  FROM public.stores s
  WHERE s.id = COALESCE(
    (SELECT id FROM public.stores WHERE dominio = lower(p_hostname)),
    (SELECT id FROM public.stores
       WHERE slug = regexp_replace(lower(p_hostname), '\.valionsistemas\.com\.br$', '')
         AND lower(p_hostname) ~ '^[a-z0-9-]+\.valionsistemas\.com\.br$'),
    (SELECT id FROM public.stores
       WHERE slug = regexp_replace(lower(p_hostname), '\.lojas\.valionsistemas\.com\.br$', '')
         AND lower(p_hostname) ~ '^[a-z0-9-]+\.lojas\.valionsistemas\.com\.br$'),
    public.default_store_id()
  );
$function$;

GRANT EXECUTE ON FUNCTION public.get_store_by_domain(text) TO anon, authenticated;

-- ===== 2. resolve_store_from_origin: DEPENDENCIA CROSS-REF necessaria pra compatibilidade do novo
-- padrao de dominio da REF-STORE-ONBOARD-01. Funcao original pertence a REF-ORDER-TENANT-01 (guest
-- checkout, create_order) -- essa REF nao foi reaberta como frente; esta e a UNICA mudanca feita nela
-- aqui, e e estritamente aditiva (novo ramo no COALESCE, fail-closed preservado, nenhum ramo existente
-- alterado). Sem isto, checkout guest de qualquer loja nova sob .lojas. falharia com "loja nao
-- identificada" mesmo com storefront/Admin/convite funcionando -- achado da auditoria de codigo desta
-- REF, autorizado explicitamente pelo dono antes desta migration.
CREATE OR REPLACE FUNCTION public.resolve_store_from_origin()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_origin   text;
  v_hostname text;
  v_store_id uuid;
BEGIN
  v_origin := current_setting('request.headers', true)::json->>'origin';
  IF v_origin IS NULL OR btrim(v_origin) = '' THEN
    RETURN NULL;
  END IF;

  v_hostname := regexp_replace(lower(v_origin), '^https?://([^/:]+).*$', '\1');

  SELECT s.id INTO v_store_id
  FROM public.stores s
  WHERE s.id = COALESCE(
    (SELECT id FROM public.stores WHERE dominio = v_hostname),
    (SELECT id FROM public.stores
       WHERE slug = regexp_replace(v_hostname, '\.valionsistemas\.com\.br$', '')
         AND v_hostname ~ '^[a-z0-9-]+\.valionsistemas\.com\.br$'),
    (SELECT id FROM public.stores
       WHERE slug = regexp_replace(v_hostname, '\.lojas\.valionsistemas\.com\.br$', '')
         AND v_hostname ~ '^[a-z0-9-]+\.lojas\.valionsistemas\.com\.br$'),
    -- {slug}.localhost -- reservado IETF/navegador (RFC 6761), so pra permitir testar em dev/E2E
    -- com a MESMA funcao byte a byte de producao (comentario original de REF-ORDER-TENANT-01).
    (SELECT id FROM public.stores
       WHERE slug = regexp_replace(v_hostname, '\.localhost$', '')
         AND v_hostname ~ '^[a-z0-9-]+\.localhost$')
  );

  RETURN v_store_id;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.resolve_store_from_origin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_store_from_origin() TO anon, authenticated;

-- ===== 3. provision_store: guarda contra colisao de slug + dominio automatico sob o padrao novo.
-- Sob o padrao legado, dominio so podia ser confirmado depois que alguem apontasse o DNS manualmente
-- (por isso ficava NULL na criacao). Sob a Opcao C o wildcard garante que o host JA resolve desde a
-- criacao -- dominio pode ser preenchido de forma deterministica, sem esperar confirmacao manual.
CREATE OR REPLACE FUNCTION public.provision_store(p_nome text, p_slug text, p_admin_email text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_nome       text;
  v_slug       text;
  v_nome_curto text;
  v_store_id   uuid;
  v_dominio    text;
  v_admin      jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'apenas o super admin da plataforma pode provisionar uma nova loja'
      USING ERRCODE = '42501';
  END IF;

  v_nome := trim(both from coalesce(p_nome, ''));
  IF length(v_nome) < 2 THEN
    RAISE EXCEPTION 'nome invalido: informe ao menos 2 caracteres' USING ERRCODE = '22023';
  END IF;

  v_slug := lower(trim(both from coalesce(p_slug, '')));
  IF v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(v_slug) < 2 OR length(v_slug) > 40 THEN
    RAISE EXCEPTION 'slug invalido: % (use letras minusculas, numeros e hifen, 2-40 caracteres)', p_slug
      USING ERRCODE = '22023';
  END IF;

  -- REF-STORE-ONBOARD-01 · Onda 2 (Opcao C): "admin-" e prefixo reservado do host de admin
  -- (admin-{slug}.lojas...). Sem esta guarda, uma loja de slug "admin-cafe" colidiria com o host de
  -- admin de uma loja "cafe" -- MESMO hostname final, duas lojas diferentes. Fecha a colisao na origem.
  IF v_slug ~ '^admin-' THEN
    RAISE EXCEPTION 'slug invalido: nao pode comecar com "admin-" (prefixo reservado)' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.stores WHERE slug = v_slug) THEN
    RAISE EXCEPTION 'slug ja esta em uso: %', v_slug USING ERRCODE = '22023';
  END IF;

  v_dominio := v_slug || '.lojas.valionsistemas.com.br';

  INSERT INTO public.stores (slug, nome, dominio, status)
  VALUES (v_slug, v_nome, v_dominio, 'ativo')
  RETURNING id INTO v_store_id;

  v_nome_curto := split_part(v_nome, ' ', 1);

  INSERT INTO public.store_settings (store_id, chave, valor)
  VALUES (v_store_id, 'company_info', jsonb_build_object(
    'nomeCurto', v_nome_curto,
    'nomeCompleto', v_nome,
    'telefone', '',
    'whatsapp', '',
    'email', '',
    'whatsappFloatEnabled', false,
    'corPrimaria', '#6B7280',
    'corSecundaria', '#374151',
    'corDestaque', '#F59E0B'
  )::text);

  v_admin := jsonb_build_object('vinculado', false, 'motivo', 'nenhum e-mail informado');
  IF p_admin_email IS NOT NULL AND length(trim(both from p_admin_email)) > 0 THEN
    v_admin := public.link_store_admin(v_store_id, p_admin_email);
  END IF;

  RETURN jsonb_build_object(
    'store_id', v_store_id,
    'slug', v_slug,
    'nome', v_nome,
    'dominio', v_dominio,
    'status', 'ativo',
    'admin', v_admin
  );
END;
$function$;

COMMIT;

-- Expoe as funcoes atualizadas na API PostgREST imediatamente.
NOTIFY pgrst, 'reload schema';
