-- REF-AUTH-TENANT-01 — Onda 3: Custom Access Token Hook
--
-- Le active_tenant (Onda 1) pela session_id que a PROPRIA requisicao de emissao de token traz em
-- event->claims->session_id (nunca de Origin/Referer/hostname/body — o Hook estruturalmente nao
-- recebe nada disso, so {user_id, claims, authentication_method}, confirmado via documentacao oficial
-- na fase de desenho). Reconfirma stores.status='ativo' a CADA emissao (nao so na ativacao) — se a
-- loja for desativada depois de activate_tenant() ter rodado, o claim some sozinho no proximo refresh.
--
-- Fail-closed em 2 niveis distintos, de proposito:
--   1) Sem active_tenant valido para a sessao -> tenant_id simplesmente NAO entra nas claims (login
--      continua normal, so sem contexto de tenant — e o caso de Admin/Super Admin, que nunca tem
--      linha em active_tenant, e do primeiro login antes de qualquer activate_tenant()).
--   2) Qualquer erro INESPERADO dentro do Hook (EXCEPTION WHEN OTHERS) -> devolve o event ORIGINAL,
--      sem tenant_id, SEM propagar a excecao. Isso e critico: se um Hook de emissao de token lanca
--      excecao, o LOGIN INTEIRO falha pra TODO MUNDO (nao so quem usa tenant) — response oficial do
--      Supabase trata excecao do hook como falha de autenticacao. Preferimos "faltou tenant_id" a
--      "ninguem consegue logar".
--
-- Nao adiciona nada alem de tenant_id — sem customer_id/telefone/email/PII, exatamente como pedido.

BEGIN;

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_session_id uuid;
  v_store_id   uuid;
  v_claims     jsonb;
BEGIN
  v_claims := coalesce(event->'claims', '{}'::jsonb);
  v_session_id := NULLIF(v_claims->>'session_id', '')::uuid;

  IF v_session_id IS NOT NULL THEN
    SELECT at.store_id INTO v_store_id
    FROM public.active_tenant at
    JOIN public.stores s ON s.id = at.store_id
    WHERE at.session_id = v_session_id
      AND s.status = 'ativo';
  END IF;

  IF v_store_id IS NOT NULL THEN
    v_claims := jsonb_set(v_claims, '{tenant_id}', to_jsonb(v_store_id::text));
  END IF;

  RETURN jsonb_set(event, '{claims}', v_claims);
EXCEPTION WHEN OTHERS THEN
  RETURN event;
END;
$function$;

COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS
  'REF-AUTH-TENANT-01: Custom Access Token Hook. Le session_id das proprias claims em emissao, busca active_tenant, reconfirma loja ativa, adiciona tenant_id. Fail-closed: sem contexto valido -> tenant_id ausente (nunca fabricado); erro inesperado -> event original, sem excecao (excecao aqui derrubaria login de todo mundo). So EXECUTAVEL por supabase_auth_admin.';

REVOKE ALL ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

COMMIT;
