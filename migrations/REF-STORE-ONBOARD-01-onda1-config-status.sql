-- REF-STORE-ONBOARD-01 · Onda 1 — Blindagem operacional de loja nova.
--
-- CONTEXTO (auditoria REF-STORE-ONBOARD-01, 2026-08-18, caso real "Bar da Sogra"): get_business_hours_
-- schedule/get_delivery_fee_config (REF-SAAS-01-onda4-3-config-operacional.sql) usam COALESCE contra um
-- fallback hardcoded que e' literalmente o horario/tabela de precos REAIS da Encanto (semeados por
-- backfill na propria migracao original, nao um dado neutro). Uma loja nova sem linha propria em
-- store_settings herda esses valores em silencio -- o Admin da loja nova nao tem hoje NENHUMA forma de
-- saber que esta vendo dado de outro negocio, so' o Super Admin ve isso (platform_tenant_detail/
-- platform_list_tenants, REF-SAAS-02-onda1-platform-console.sql, ja calculam tem_horario_config/
-- tem_delivery_config, mas so' pra quem e' is_super_admin()).
--
-- Esta migration NAO mexe em nenhum COALESCE, NAO cria tabela nova, NAO cria RPC de escrita nova. E'
-- aditiva e 100% leitura: reaproveita EXATAMENTE a mesma query EXISTS ja usada por platform_tenant_detail
-- (linhas 106-107 daquela migration), so troca o gate de autorizacao de is_super_admin() para
-- is_admin_of(p_store_id) -- assim o proprio administrador da loja (nao so' o Super Admin da VALION)
-- consegue consultar o status de configuracao da SUA loja, pra alimentar um banner no Admin (AdminBusiness
-- Hours/AdminTaxaEntrega).
--
-- Auditado contra o estado real de producao em 2026-08-18 (script read-only, sem escrita):
--   encanto      -> tem linha propria em business_hours_schedule E delivery_fee_config (backfill original
--                   da Onda 4.3) -> nenhuma mudanca de comportamento, continua "configurada".
--   bar-da-sogra -> NAO tem nenhuma das duas linhas -> e' o caso real que motivou esta ref; passa a ser
--                   sinalizada corretamente como "usando padrao" no proprio Admin dela, nao so no Platform
--                   Console.
--
-- Onda 2 (provisionamento de identidade Auth via Edge Function) e Onda 3 (clonagem de catalogo, dominio
-- proprio, PWA manifest por tenant) permanecem FORA de escopo desta migration.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_store_config_status(p_store_id uuid DEFAULT public.default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RAISE EXCEPTION 'apenas administradores desta loja podem ver o status de configuracao'
      USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'tem_horario_config',  EXISTS (SELECT 1 FROM public.store_settings WHERE store_id = p_store_id AND chave = 'business_hours_schedule'),
    'tem_delivery_config', EXISTS (SELECT 1 FROM public.store_settings WHERE store_id = p_store_id AND chave = 'delivery_fee_config')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_store_config_status(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_store_config_status(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_store_config_status(uuid) TO authenticated;

COMMIT;

-- Expoe a funcao na API PostgREST imediatamente.
NOTIFY pgrst, 'reload schema';

-- VERIFICACAO (rodar manualmente apos aplicar, como admin autenticado da propria loja):
--   SELECT get_store_config_status();                      -- loja ativa do chamador (default_store_id())
--   SELECT get_store_config_status('<uuid-de-outra-loja>'); -- deve falhar com 42501 se o chamador nao for
--                                                            -- admin dela nem super admin
