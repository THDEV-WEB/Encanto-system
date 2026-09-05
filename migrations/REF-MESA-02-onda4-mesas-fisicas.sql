-- ============================================================================
-- REF-MESA-02 · Onda 4 — Mesas físicas / capability (catálogo + Admin)
-- ----------------------------------------------------------------------------
-- Tabela nova public.mesas: catálogo de mesas físicas por loja (numero/nome,
-- status operacional). Estados mínimos pedidos: DISPONÍVEL/OCUPADA/
-- INDISPONÍVEL -- decisão de modelagem: só "disponivel"/"indisponivel" são
-- persistidos (flag operacional controlado pelo Admin); "ocupada" é
-- DERIVADO em tempo real (existe sessão aberta em mesa_session_mesas
-- referenciando esse identificador) -- evita denormalização/trigger extra
-- para um estado que já é 100% calculável a partir do que a Onda 2 criou, e
-- evita a mesa ficar "presa" em ocupada por esquecimento caso algo falhe no
-- fechamento da sessão (a fonte de verdade de ocupação é sempre
-- mesa_session_mesas, nunca uma segunda cópia em `mesas`).
--
-- "Mesa indisponível não pode receber nova sessão/pedido" (regra de negócio
-- explícita) -- o ENFORCEMENT disso é responsabilidade da RPC de abertura de
-- sessão (onda futura, _get_or_open_mesa_session/abrir_sessao_mesa), que
-- ainda não existe. Esta onda só cria o catálogo e a capacidade de
-- consultar/alternar o status -- não há ainda nenhum caminho que abra sessão
-- de mesa, então não há regressão possível aqui.
--
-- RPCs (todas SECURITY DEFINER, is_admin_of(p_store_id) + WHERE store_id
-- explícito nas operações por id -- nunca só o papel, mesmo padrão corrigido
-- na Onda 2/3 após o veredito adversarial da auditoria):
--   admin_listar_mesas(p_store_id) -- lista mesas + ocupada calculada
--   admin_criar_mesa(p_identificador, p_store_id) -- cadastra mesa nova
--   admin_set_mesa_status(p_mesa_id, p_status, p_store_id) -- alterna disponivel/indisponivel
--
-- SEGURANÇA: tabela `mesas` segue o padrão "config" (RLS deny-all, zero
-- policy, REVOKE ALL de anon/authenticated) -- acesso só via as 3 RPCs acima.
--
-- Testes: scripts/mesa-02-onda4-mesas-fisicas-test.mjs (E2E).
-- Rollback: REF-MESA-02-onda4-mesas-fisicas-rollback.sql (DROP TABLE +
-- DROP FUNCTION, greenfield).
-- ============================================================================

BEGIN;

CREATE TABLE public.mesas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL DEFAULT default_store_id() REFERENCES public.stores(id),
  identificador text NOT NULL,
  status text NOT NULL DEFAULT 'disponivel' CHECK (status IN ('disponivel', 'indisponivel')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mesas_identificador_len CHECK (length(btrim(identificador)) BETWEEN 1 AND 40),
  CONSTRAINT mesas_store_identificador_uniq UNIQUE (store_id, identificador)
);

COMMENT ON TABLE public.mesas IS
  'Catalogo de mesas fisicas por loja (REF-MESA-02 Onda 4). status persiste so disponivel/indisponivel (flag operacional do Admin) -- "ocupada" e SEMPRE derivado de mesa_session_mesas em tempo real (existe sessao aberta com esse identificador), nunca uma segunda copia. Enforcement de "indisponivel bloqueia nova sessao" fica na RPC de abertura de sessao (onda futura).';

CREATE INDEX mesas_store_id_idx ON public.mesas (store_id);

ALTER TABLE public.mesas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mesas FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_listar_mesas(p_store_id uuid DEFAULT default_store_id())
 RETURNS TABLE(id uuid, identificador text, status text, ocupada boolean, created_at timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RAISE EXCEPTION 'sem permissao' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    m.id, m.identificador, m.status,
    EXISTS (
      SELECT 1 FROM public.mesa_session_mesas msm
      WHERE msm.store_id = p_store_id
        AND msm.mesa_identificador = m.identificador
        AND msm.status_sessao = 'aberta'
    ) AS ocupada,
    m.created_at
  FROM public.mesas m
  WHERE m.store_id = p_store_id
  ORDER BY m.identificador;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_listar_mesas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_listar_mesas(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_criar_mesa(p_identificador text, p_store_id uuid DEFAULT default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_id text := nullif(btrim(p_identificador), ''); v_mesa_id uuid;
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sem permissao');
  END IF;
  IF v_id IS NULL OR length(v_id) > 40 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'identificador invalido');
  END IF;
  BEGIN
    INSERT INTO public.mesas (store_id, identificador) VALUES (p_store_id, v_id) RETURNING id INTO v_mesa_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mesa ja cadastrada');
  END;
  RETURN jsonb_build_object('ok', true, 'id', v_mesa_id, 'identificador', v_id, 'status', 'disponivel');
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_criar_mesa(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_criar_mesa(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_mesa_status(p_mesa_id uuid, p_status text, p_store_id uuid DEFAULT default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_updated uuid;
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sem permissao');
  END IF;
  IF p_status NOT IN ('disponivel', 'indisponivel') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'status invalido');
  END IF;
  -- WHERE store_id explicito (nao so is_admin_of) -- mesmo padrao corrigido na Onda 2/3: nunca
  -- confiar so no papel quando o recurso e buscado por um id que o client controla.
  UPDATE public.mesas SET status = p_status
  WHERE id = p_mesa_id AND store_id = p_store_id
  RETURNING id INTO v_updated;
  IF v_updated IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mesa nao encontrada');
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_updated, 'status', p_status);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_set_mesa_status(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_mesa_status(uuid, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
