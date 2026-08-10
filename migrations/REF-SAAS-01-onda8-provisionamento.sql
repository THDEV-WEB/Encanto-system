-- REF-SAAS-01 · Onda 8 — Provisionamento assistido de loja nova.
-- ADR de referencia: docs/adr/REF-SAAS-01-fundacao-multitenant.md (§7 Fluxo futuro de onboarding,
-- §8 Estrategia de provisionamento -- v1 e MANUAL/ASSISTIDA pelo Super Admin, nao self-service).
--
-- Escopo desta migration:
--   1. link_store_admin(p_store_id, p_admin_email) -- vincula um auth.users EXISTENTE (por email) como
--      admin de uma loja. Definida ANTES de provision_store porque esta e' chamada por ela.
--   2. provision_store(p_nome, p_slug, p_admin_email) -- cria a loja (status 'ativo', sem dominio ainda
--      -- DNS/Vercel permanecem manuais, Onda 8 nao toca infra) + semente de company_info (ver abaixo)
--      + tenta vincular o admin se um e-mail foi informado.
--
-- ACHADO CRITICO desta auditoria (motivo da semente de company_info): get_company_info(p_store_id)
-- (Onda 6.2) tem um fallback HARDCODED com nome/telefone/whatsapp/email/paleta REAIS da Encanto. Uma
-- loja nova sem nenhuma linha em store_settings.chave='company_info' herdaria esse fallback -- a "Loja
-- B" mostraria o WhatsApp e o e-mail da Encanto como se fossem seus, ate o admin abrir "Empresa" e
-- sobrescrever manualmente. provision_store semeia um placeholder NEUTRO (paleta cinza/ambar, contatos
-- vazios, whatsappFloatEnabled=false -- sem numero configurado, o botao flutuante nao aparece com link
-- quebrado) para a loja nunca herdar a marca da Encanto, nem por 1 segundo.
--
-- SEPARACAO DE RESPONSABILIDADES (regra explicita do dono para esta onda -- nao inventar solucao
-- insegura de criacao de identidade Auth): (1) criacao da loja e (2) vinculo do admin sao 100% deste
-- arquivo; (3) criacao da IDENTIDADE Auth (o auth.users em si) permanece manual (Supabase Dashboard),
-- fora de qualquer RPC -- nunca se cria/altera senha aqui, nunca se expoe service_role ao frontend.
-- link_store_admin so ENXERGA auth.users (leitura por e-mail, SECURITY DEFINER) para descobrir se a
-- pessoa ja existe -- se nao existir, devolve motivo explicito em vez de erro (estado esperado do fluxo
-- assistido, nao uma falha), e provision_store NAO desfaz a loja criada por causa disso.
--
-- Autorizacao: is_super_admin() em ambas -- reaproveita 100% o mecanismo da Onda 1 (super_admins),
-- nenhuma fonte de verdade nova. Admin de loja (mesmo admin real hoje) e anon seguem sem acesso.
--
-- Atomicidade: cada funcao e' 1 transacao implicita do Postgres -- qualquer RAISE EXCEPTION desfaz
-- 100% dos efeitos daquela chamada (nunca fica loja/admin parcialmente criado). A UNICA saida "parcial"
-- e um RESULTADO, nao um erro: loja criada + admin nao encontrado ainda (jsonb com vinculado=false e
-- motivo), porque essa e' uma etapa manual explicitamente fora do escopo desta RPC (ver ADR §8).

BEGIN;

-- ===== 1. link_store_admin: vincula um auth.users EXISTENTE (por e-mail) como admin de uma loja. =====
CREATE OR REPLACE FUNCTION public.link_store_admin(p_store_id uuid, p_admin_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_email   text;
  v_user_id uuid;
  v_ja      boolean;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'apenas o super admin da plataforma pode vincular administradores de loja'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store_id) THEN
    RAISE EXCEPTION 'loja nao encontrada: %', p_store_id USING ERRCODE = '22023';
  END IF;

  v_email := lower(trim(both from coalesce(p_admin_email, '')));
  IF v_email !~ '^.+@.+\..+$' THEN
    RAISE EXCEPTION 'email invalido: %', p_admin_email USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = v_email LIMIT 1;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'vinculado', false, 'email', v_email,
      'motivo', 'nao existe nenhuma conta com este e-mail ainda -- crie o usuario em Authentication > Users no Supabase e vincule novamente'
    );
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.admins WHERE store_id = p_store_id AND user_id = v_user_id
  ) INTO v_ja;
  IF v_ja THEN
    RETURN jsonb_build_object('vinculado', false, 'email', v_email, 'motivo', 'este usuario ja e administrador desta loja');
  END IF;

  INSERT INTO public.admins (store_id, user_id) VALUES (p_store_id, v_user_id);

  RETURN jsonb_build_object('vinculado', true, 'email', v_email, 'user_id', v_user_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.link_store_admin(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_store_admin(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.link_store_admin(uuid, text) TO authenticated;

-- ===== 2. provision_store: cria a loja + semente de company_info + tenta vincular o admin. =====
CREATE OR REPLACE FUNCTION public.provision_store(p_nome text, p_slug text, p_admin_email text DEFAULT NULL)
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

REVOKE ALL ON FUNCTION public.provision_store(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.provision_store(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.provision_store(text, text, text) TO authenticated;

COMMIT;

-- Expoe as novas funcoes na API PostgREST imediatamente.
NOTIFY pgrst, 'reload schema';
