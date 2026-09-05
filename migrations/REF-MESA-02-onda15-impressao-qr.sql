-- ============================================================================
-- REF-MESA-02 · Onda 15 — Impressão do QR da mesa
-- ----------------------------------------------------------------------------
-- Fecha o gap já registrado desde a Onda 4/5: `mesas.qr_token` existe e
-- `admin_listar_mesas` já devolve ele desde a Onda 5 ("Admin usa pra gerar/
-- imprimir o QR, onda futura"), mas nenhuma tela nunca mostrou/imprimiu o QR.
--
-- O único pedaço que faltava no SERVIDOR: o Admin (bundle isolado, domínio
-- diferente do storefront) não tinha como saber a URL PÚBLICA da própria loja
-- pra montar o link que vai dentro do QR (`https://<host>/?mesa_token=<uuid>`,
-- mesmo parâmetro que `useMesaFromQuery.js` já lê desde a Onda 5). Nenhuma RPC
-- existente expõe `stores.slug`/`stores.dominio` a uma sessão de Admin comum
-- (só o Platform Console, que é escopo de super admin).
--
-- DECISÃO DE DESIGN: `admin_obter_url_storefront()` resolve a URL INTEIRA no
-- servidor (nunca no client) -- usa `stores.dominio` quando setado (é o campo
-- que `provision_store()`/onboarding já tratam como "o domínio real desta
-- loja", confirmado ao vivo pro tenant seed "encanto" ->
-- encanto.valionsistemas.com.br), senão cai no padrão novo
-- (`<slug>.lojas.valionsistemas.com.br`, o mesmo que `provision_store()` grava
-- por padrão em loja nova desde REF-STORE-ONBOARD-01) -- nunca o padrão legado
-- (`<slug>.valionsistemas.com.br`, "congelado, só Encanto usa", conforme
-- PlatformTenants.jsx). Mantém TODA a lógica de resolução de domínio num único
-- lugar (servidor) em vez de duplicar no bundle Admin.
--
-- admin_obter_url_storefront(p_store_id) -- SECURITY DEFINER,
-- is_admin_of(p_store_id) (loja já é a própria do admin, sem necessidade de
-- WHERE id extra além do lookup direto por p_store_id).
--
-- Testes: scripts/mesa-02-onda15-impressao-qr-test.mjs (E2E).
-- Rollback: REF-MESA-02-onda15-impressao-qr-rollback.sql (DROP FUNCTION,
-- aditiva pura).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_obter_url_storefront(p_store_id uuid DEFAULT default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_slug text; v_dominio text;
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sem permissao');
  END IF;

  SELECT slug, dominio INTO v_slug, v_dominio FROM public.stores WHERE id = p_store_id;
  IF v_slug IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'loja nao encontrada');
  END IF;

  RETURN jsonb_build_object('ok', true, 'url', 'https://' || coalesce(v_dominio, v_slug || '.lojas.valionsistemas.com.br'));
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_obter_url_storefront(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_obter_url_storefront(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
