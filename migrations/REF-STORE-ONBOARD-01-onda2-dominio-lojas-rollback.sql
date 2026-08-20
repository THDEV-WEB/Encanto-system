-- Rollback de REF-STORE-ONBOARD-01-onda2-dominio-lojas.sql -- restaura get_store_by_domain,
-- resolve_store_from_origin e provision_store ao estado imediatamente anterior (sem o ramo
-- .lojas.valionsistemas.com.br, sem a guarda "admin-", sem dominio automatico no provisionamento).
--
-- RISCO: se alguma loja ja foi provisionada sob o padrao novo (dominio = {slug}.lojas...) antes deste
-- rollback, ela deixa de resolver por get_store_by_domain/resolve_store_from_origin (nenhum ramo bate
-- mais com o dominio dela) ate alguem setar `dominio` manualmente pro padrao legado como salvaguarda.
-- Nenhum dado e perdido (a linha em stores continua intacta), so o roteamento por hostname para de
-- reconhecer aquele host.

BEGIN;

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
    public.default_store_id()
  );
$function$;

GRANT EXECUTE ON FUNCTION public.get_store_by_domain(text) TO anon, authenticated;

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

  IF EXISTS (SELECT 1 FROM public.stores WHERE slug = v_slug) THEN
    RAISE EXCEPTION 'slug ja esta em uso: %', v_slug USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.stores (slug, nome, dominio, status)
  VALUES (v_slug, v_nome, NULL, 'ativo')
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
    'status', 'ativo',
    'admin', v_admin
  );
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
