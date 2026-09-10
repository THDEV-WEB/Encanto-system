-- ============================================================================
-- REF-PAGAMENTO-01 · Onda 7 — Admin self-service: liga/desliga + Chave Pública por loja
-- ----------------------------------------------------------------------------
-- get_pagamento_config (Onda 5) já existia para LEITURA. Esta onda fecha o lado de
-- ESCRITA que faltava — set_pagamento_config, mesmo padrão de set_company_info
-- (REF-SAAS-01 · Onda 6.2): is_admin_of(p_store_id), upsert em store_settings,
-- RAISE EXCEPTION com ERRCODE para o cliente distinguir erro de validação.
--
-- Escopo desta onda (decisão explícita do dono): só o que já é SEGURO hoje —
-- toggle pagamento_online_habilitada + mp_public_key (pública por design do
-- Mercado Pago, sem problema em circular por aqui). O Access Token continua
-- FORA desta RPC — segue sendo segredo de Edge Function, configurado fora do
-- Admin (única conta MP recebe todas as lojas com pagamento online ligado,
-- limitação documentada, resolvida só numa REF futura de Split/OAuth).
--
-- Validação do formato da chave pública: Mercado Pago usa TEST-<uuid> (sandbox)
-- ou APP_USR-<uuid> (produção) — mesmo formato observado na chave real usada
-- nos testes desta REF (Onda 5/6). Regex intencionalmente estrito o bastante
-- para pegar o erro real mais provável: alguém colar o ACCESS TOKEN aqui por
-- engano (formato bem mais longo, não é um UUID) em vez da Public Key.
--
-- Não habilita sem chave: manter pagamento_online_habilitada=true sem
-- mp_public_key configurada quebraria o Payment Brick no checkout (a Onda 5
-- já trata public_key ausente como "sem SDK pra montar" no frontend, mas o
-- servidor nunca deveria permitir esse estado de origem).
--
-- Testes: scripts/pagamento-01-onda7-admin-config-test.mjs (E2E, SAVEPOINT).
-- Rollback: REF-PAGAMENTO-01-onda7-admin-config-rollback.sql.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.set_pagamento_config(p_habilitada boolean, p_public_key text, p_store_id uuid DEFAULT public.default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_key text := nullif(btrim(p_public_key), '');
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RAISE EXCEPTION 'apenas administradores podem alterar a configuracao de pagamento'
      USING ERRCODE = '42501';
  END IF;

  IF p_habilitada IS NULL THEN
    RAISE EXCEPTION 'habilitada e obrigatorio (true ou false)' USING ERRCODE = '22023';
  END IF;

  IF v_key IS NOT NULL AND v_key !~* '^(TEST|APP_USR)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'chave publica em formato invalido: use a Public Key do Mercado Pago (TEST-... ou APP_USR-...), nao o Access Token'
      USING ERRCODE = '22023';
  END IF;

  IF p_habilitada AND v_key IS NULL THEN
    RAISE EXCEPTION 'informe a chave publica antes de habilitar o pagamento online' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.store_settings (store_id, chave, valor) VALUES (p_store_id, 'pagamento_online_habilitada', p_habilitada::text)
    ON CONFLICT (store_id, chave) DO UPDATE SET valor = excluded.valor;

  IF v_key IS NULL THEN
    DELETE FROM public.store_settings WHERE store_id = p_store_id AND chave = 'mp_public_key';
  ELSE
    INSERT INTO public.store_settings (store_id, chave, valor) VALUES (p_store_id, 'mp_public_key', v_key)
      ON CONFLICT (store_id, chave) DO UPDATE SET valor = excluded.valor;
  END IF;

  RETURN jsonb_build_object('habilitada', p_habilitada, 'public_key', v_key);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_pagamento_config(boolean, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_pagamento_config(boolean, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_pagamento_config(boolean, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
