-- REF-AUTH-TENANT-01 — Onda 2: activate_tenant(p_store_id)
--
-- p_store_id é só o tenant SOLICITADO — nunca autorização. A função prova, server-side, que a
-- sessão atual (auth.uid() + session_id do próprio JWT em uso, nunca de um parâmetro) tem vínculo
-- real com aquela loja antes de gravar em active_tenant (Onda 1). Mesmo padrão EXISTS(customers JOIN
-- stores) já validado em is_admin_of/admin_order_endereco/save_structured_address — aplicado aqui à
-- pergunta equivalente do storefront: "esta pessoa é cliente desta loja?".
--
-- Sem parâmetro de session_id nem de auth_user_id de propósito — não existe forma de o caller
-- escolher a sessão ou a identidade que está sendo gravada; ambas vêm só de auth.uid()/auth.jwt(),
-- que são assinados e não manipuláveis pelo client.
--
-- Mensagem de erro única para "loja não existe" / "loja inativa" / "sem vínculo" — não dá pista de
-- enumeração pra quem testa store_ids por tentativa e erro (mesmo raciocínio já usado no gate final
-- da auditoria).

BEGIN;

CREATE OR REPLACE FUNCTION public.activate_tenant(p_store_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_session_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'sessao invalida';
  END IF;

  v_session_id := NULLIF(auth.jwt()->>'session_id', '')::uuid;
  IF v_session_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.sessions WHERE id = v_session_id
  ) THEN
    RAISE EXCEPTION 'sessao invalida';
  END IF;

  IF p_store_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.customers c
    JOIN public.stores s ON s.id = c.store_id
    WHERE c.auth_user_id = auth.uid()
      AND c.store_id = p_store_id
      AND s.status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'tenant indisponivel';
  END IF;

  INSERT INTO public.active_tenant (session_id, auth_user_id, store_id, updated_at)
  VALUES (v_session_id, auth.uid(), p_store_id, now())
  ON CONFLICT (session_id) DO UPDATE
    SET store_id = EXCLUDED.store_id,
        updated_at = now();
END;
$function$;

COMMENT ON FUNCTION public.activate_tenant(uuid) IS
  'REF-AUTH-TENANT-01: ativa a loja p_store_id para a SESSAO atual (session_id do proprio JWT, nunca de parametro). Autoriza via EXISTS(customers do auth.uid() nessa loja, loja ativa) - p_store_id e so o seletor solicitado, nunca a autorizacao em si.';

REVOKE ALL ON FUNCTION public.activate_tenant(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.activate_tenant(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.activate_tenant(uuid) TO authenticated;

COMMIT;
