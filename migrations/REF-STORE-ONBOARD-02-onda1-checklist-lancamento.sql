-- REF-STORE-ONBOARD-02 · Onda 1 -- checklist de lancamento para lojas novas no Platform Console.
-- ADR de referencia: docs/adr/REF-STORE-ONBOARD-01-dominio-lojas.md (o "onboarding guiado" ja citado la
-- como frente futura separada). Doc desta REF: docs/ref/REF-STORE-ONBOARD-02-progress.md.
--
-- Objetivo: platform_tenant_detail() ja informa tem_horario_config/tem_delivery_config/delivery_eta_min
-- (REF-SAAS-02 · Onda 1). Faltam os indicadores que fecham o quadro real do que uma loja recem-criada
-- ainda precisa configurar antes de ir ao ar:
--   - catalogo vazio (so' platform_clone_catalog resolve, e so' funciona com destino vazio);
--   - coordenadas da loja ausentes -- causa real de TODO pedido de entrega sair com taxa R$ 0,00, hoje
--     sem NENHUM aviso no Platform Console (so' existe aviso disso dentro do Admin da propria loja,
--     StatusLocalizacaoLoja em AdminTaxaEntrega.jsx);
--   - ETA de entrega e modo da loja (AUTO/OPEN/CLOSED) herdando o fallback generico em silencio -- sem
--     nenhum aviso em lugar nenhum hoje (ao contrario de horario/entrega, que ja tem banner na Onda 1 de
--     REF-STORE-ONBOARD-01).
--
-- So' EXPOE informacao ja existente (contagem de produtos, get_company_info, store_settings) -- nao cria
-- autorizacao nova, nao cria tabela nova, nao altera nenhuma regra de negocio.
--
-- Escopo: SOMENTE platform_tenant_detail (aditivo -- RETURNS jsonb sem mudanca de assinatura, so' campos
-- novos dentro de 'config'). Nao toca provision_store, invite-store-admin, platform_clone_catalog, nem
-- nenhuma RPC/RLS da REF-AUTH-PLATFORM-ISOLATION-01.

BEGIN;

CREATE OR REPLACE FUNCTION public.platform_tenant_detail(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_store   jsonb;
  v_admins  jsonb;
  v_company jsonb;
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
    'user_id', a.user_id, 'email', u.email, 'created_at', a.created_at,
    'is_super_admin', EXISTS (SELECT 1 FROM public.super_admins sa WHERE sa.user_id = a.user_id)
  ) ORDER BY a.created_at), '[]'::jsonb)
  INTO v_admins
  FROM public.admins a JOIN auth.users u ON u.id = a.user_id
  WHERE a.store_id = p_store_id;

  v_company := public.get_company_info(p_store_id);

  RETURN jsonb_build_object(
    'store', v_store,
    'admins', v_admins,
    'company_info', v_company,
    'counts', jsonb_build_object(
      'produtos',  (SELECT count(*) FROM public.products  WHERE store_id = p_store_id),
      'categorias',(SELECT count(*) FROM public.categories WHERE store_id = p_store_id),
      'pedidos',   (SELECT count(*) FROM public.orders     WHERE store_id = p_store_id)
    ),
    'config', jsonb_build_object(
      'tem_horario_config',   EXISTS (SELECT 1 FROM public.store_settings WHERE store_id = p_store_id AND chave = 'business_hours_schedule'),
      'tem_delivery_config',  EXISTS (SELECT 1 FROM public.store_settings WHERE store_id = p_store_id AND chave = 'delivery_fee_config'),
      'delivery_eta_min',     COALESCE((SELECT valor FROM public.store_settings WHERE store_id = p_store_id AND chave = 'delivery_eta_min' LIMIT 1), '45'),
      -- REF-STORE-ONBOARD-02 (Onda 1): indicadores novos do checklist de lancamento.
      'tem_catalogo',         (SELECT count(*) FROM public.products WHERE store_id = p_store_id) > 0,
      'tem_coordenadas',      COALESCE(jsonb_typeof(v_company->'lojaLat') = 'number' AND jsonb_typeof(v_company->'lojaLng') = 'number', false),
      'tem_eta_customizado',  EXISTS (SELECT 1 FROM public.store_settings WHERE store_id = p_store_id AND chave = 'delivery_eta_min'),
      'tem_modo_customizado', EXISTS (SELECT 1 FROM public.store_settings WHERE store_id = p_store_id AND chave = 'store_mode')
    )
  );
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
