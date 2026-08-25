-- REF-AUTH-PLATFORM-ISOLATION-01 · Onda 3 — expoe is_super_admin por administrador no detalhe do tenant.
-- ADR de referencia: docs/ref/REF-AUTH-PLATFORM-ISOLATION-01-progress.md (Ondas 0-2).
--
-- Objetivo: defesa de INTERFACE (a protecao real ja esta no backend, Ondas 1/2) -- o Platform Console
-- precisa saber, por linha de administrador, se aquele user_id tambem e' Super Admin, pra exibir o selo
-- "Super Admin da plataforma" e nao oferecer os botoes "Definir senha"/"Desvincular" nessa linha.
--
-- Informacao ja existe (public.super_admins) -- esta migration so' expoe, nao cria autorizacao nova.
-- Aditivo: platform_tenant_detail() continua RETURNS jsonb (sem mudanca de assinatura, sem DROP
-- FUNCTION necessario) -- so' 1 campo novo (is_super_admin) dentro de cada objeto do array 'admins'.

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

COMMIT;

NOTIFY pgrst, 'reload schema';
