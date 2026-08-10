-- REF-SAAS-02 · Onda 1 — Platform Console VALION SISTEMAS (evolucao da Onda 8/8.2/8.3 da REF-SAAS-01).
-- Baseline: commit 75ce7b3 (Onda 8.2/8.3, ja em producao). NAO recria provision_store/link_store_admin/
-- list_my_stores/is_admin_anywhere/is_admin_of/is_super_admin -- todas continuam exatamente como estao.
--
-- Objetivo desta migration: dar ao Platform Console (frontend, camada visual separada do Admin da loja)
-- as RPCs que faltam para uma gestao PROFISSIONAL de tenants, sem duplicar o Admin da loja:
--   1. platform_list_tenants()            -- lista rica (1 round-trip) p/ a tela "Lojas".
--   2. platform_tenant_detail(p_store_id) -- detalhe de 1 tenant (Resumo/Administradores/Operacao).
--   3. platform_set_store_status(...)     -- suspender/reativar (nunca DELETE destrutivo).
--   4. platform_unlink_store_admin(...)   -- desvincular um admin de uma loja.
--   5. get_store_by_domain(...)           -- ganha deriva ção automatica de slug p/ o padrao
--      {slug}.valionsistemas.com.br, sem precisar de SQL manual por loja nova (Fase 17/18 da REF).
--
-- Autorizacao: todas as 4 novas RPCs sao SECURITY DEFINER com is_super_admin() como 1a linha de logica
-- (banco decide, nunca o frontend) -- mesmo padrao de provision_store/link_store_admin.

BEGIN;

-- ===== 1. platform_list_tenants(): visao de lista para a tela "Lojas" do Platform Console. =====
-- Calcula, num so round-trip, os sinais REAIS que alimentam o checklist de configuracao (Fase 15):
-- admin_count (ja existia via list_my_stores, replicado aqui pra nao depender dela), tem_produtos
-- (>=1 produto cadastrado), tem_horario_config/tem_delivery_config (existe linha propria em
-- store_settings, distinto do fallback default), e os 3 campos de contato do company_info (pra sinalizar
-- "Empresa"/"WhatsApp" configurados sem a UI precisar de outro round-trip por loja).
-- LANGUAGE plpgsql (nao sql puro) DE PROPOSITO: precisa de um RAISE EXCEPTION explicito pra quem nao e'
-- super admin, mesmo padrao de autorizacao das outras 4 RPCs desta migration -- um WHERE
-- is_super_admin() na query devolveria silenciosamente lista VAZIA pra um admin comum (autorizado a
-- CHAMAR a funcao, so' sem ver nada), inconsistente com o resto e mais dificil de auditar/testar.
CREATE OR REPLACE FUNCTION public.platform_list_tenants()
 RETURNS TABLE(
   store_id uuid, slug text, nome text, status text, dominio text, created_at timestamptz,
   admin_count integer, tem_produtos boolean, tem_horario_config boolean, tem_delivery_config boolean,
   company_email text, company_whatsapp text, company_logo_url text
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'apenas o super admin da plataforma pode listar os tenants'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    s.id, s.slug, s.nome, s.status, s.dominio, s.created_at,
    (SELECT count(*)::int FROM public.admins a WHERE a.store_id = s.id),
    EXISTS (SELECT 1 FROM public.products p WHERE p.store_id = s.id),
    EXISTS (SELECT 1 FROM public.store_settings ss WHERE ss.store_id = s.id AND ss.chave = 'business_hours_schedule'),
    EXISTS (SELECT 1 FROM public.store_settings ss WHERE ss.store_id = s.id AND ss.chave = 'delivery_fee_config'),
    NULLIF(public.get_company_info(s.id)->>'email', ''),
    NULLIF(public.get_company_info(s.id)->>'whatsapp', ''),
    NULLIF(public.get_company_info(s.id)->>'logoUrl', '')
  FROM public.stores s
  ORDER BY s.nome;
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_list_tenants() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.platform_list_tenants() FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_list_tenants() TO authenticated;

-- ===== 2. platform_tenant_detail(p_store_id): detalhe de 1 tenant (drawer/tela de detalhe, Fase 9). =====
-- Devolve tudo que a tela de detalhe precisa num round-trip so: dados da loja, administradores (email
-- via auth.users -- so' possivel por SECURITY DEFINER, igual link_store_admin), company_info completo
-- (get_company_info ja existente), contagens reais (produtos/categorias/pedidos) e os mesmos flags de
-- configuracao usados na lista. NAO duplica o Admin da loja -- e' so leitura agregada para supervisao.
CREATE OR REPLACE FUNCTION public.platform_tenant_detail(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_store   jsonb;
  v_admins  jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'apenas o super admin da plataforma pode ver o detalhe de um tenant'
      USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(s.*) INTO v_store FROM public.stores s WHERE s.id = p_store_id;
  IF v_store IS NULL THEN
    RAISE EXCEPTION 'loja nao encontrada: %', p_store_id USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id', a.user_id, 'email', u.email, 'created_at', a.created_at
  ) ORDER BY a.created_at), '[]'::jsonb)
  INTO v_admins
  FROM public.admins a JOIN auth.users u ON u.id = a.user_id
  WHERE a.store_id = p_store_id;

  RETURN jsonb_build_object(
    'store', v_store,
    'admins', v_admins,
    'company_info', public.get_company_info(p_store_id),
    'counts', jsonb_build_object(
      'produtos',  (SELECT count(*) FROM public.products  WHERE store_id = p_store_id),
      'categorias',(SELECT count(*) FROM public.categories WHERE store_id = p_store_id),
      'pedidos',   (SELECT count(*) FROM public.orders     WHERE store_id = p_store_id)
    ),
    'config', jsonb_build_object(
      'tem_horario_config',  EXISTS (SELECT 1 FROM public.store_settings WHERE store_id = p_store_id AND chave = 'business_hours_schedule'),
      'tem_delivery_config', EXISTS (SELECT 1 FROM public.store_settings WHERE store_id = p_store_id AND chave = 'delivery_fee_config'),
      'delivery_eta_min',    COALESCE((SELECT valor FROM public.store_settings WHERE store_id = p_store_id AND chave = 'delivery_eta_min' LIMIT 1), '45')
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_tenant_detail(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.platform_tenant_detail(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_tenant_detail(uuid) TO authenticated;

-- ===== 3. platform_set_store_status: suspender/reativar (Fase 20 -- nunca DELETE destrutivo). =====
CREATE OR REPLACE FUNCTION public.platform_set_store_status(p_store_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_nome text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'apenas o super admin da plataforma pode alterar o status de uma loja'
      USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('ativo','suspenso','cancelado') THEN
    RAISE EXCEPTION 'status invalido: % (use ativo, suspenso ou cancelado)', p_status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.stores SET status = p_status WHERE id = p_store_id
  RETURNING nome INTO v_nome;

  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'loja nao encontrada: %', p_store_id USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object('store_id', p_store_id, 'nome', v_nome, 'status', p_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_set_store_status(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.platform_set_store_status(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_set_store_status(uuid, text) TO authenticated;

-- ===== 4. platform_unlink_store_admin: desvincula 1 admin de 1 loja (Fase 20). =====
-- Idempotente (DELETE de 0 linhas nao e' erro -- "ja nao estava vinculado", mesmo espirito de
-- link_store_admin devolver {vinculado:false,motivo} em vez de excecao pra estados esperados).
CREATE OR REPLACE FUNCTION public.platform_unlink_store_admin(p_store_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_linhas int;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'apenas o super admin da plataforma pode desvincular um administrador'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.admins WHERE store_id = p_store_id AND user_id = p_user_id;
  GET DIAGNOSTICS v_linhas = ROW_COUNT;

  RETURN jsonb_build_object('desvinculado', v_linhas > 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_unlink_store_admin(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.platform_unlink_store_admin(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_unlink_store_admin(uuid, uuid) TO authenticated;

-- ===== 5. get_store_by_domain: ganha deriva ção automatica do padrao {slug}.valionsistemas.com.br. =====
-- Ordem de resolucao, do mais especifico pro mais generico (Fase 17/18 -- storefront de dominio
-- personalizado sempre vence; o padrao VALION default e automatico, sem SQL manual por loja nova; sem
-- match nenhum, cai no default_store_id() de sempre). Encanto ja tem `dominio` explicito desde a Onda 0
-- (match exato, 1o ramo) -- byte-identico ao comportamento de hoje, zero risco de regressao.
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

COMMIT;

-- Expoe as novas funcoes na API PostgREST imediatamente.
NOTIFY pgrst, 'reload schema';
