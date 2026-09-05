-- ============================================================================
-- REF-MESA-02 · Onda 10 — Junção de mesas
-- ----------------------------------------------------------------------------
-- Adiciona uma mesa fisica LIVRE a uma sessao ja aberta (grupo grande ocupa a
-- mesa 5 e pede pra juntar a mesa 6 vazia) -- as duas mesas passam a apontar
-- pra MESMA sessao/conta, ambas "ocupadas" simultaneamente. E' exatamente o
-- caso de uso pra que mesa_session_mesas foi desenhada como N:1 desde a Onda
-- 2 ("suporta juncao de mesas desde a fundacao").
--
-- ESCOPO DELIBERADAMENTE LIMITADO (decisao registrada, nao e' lacuna
-- esquecida): so e' permitido juntar uma mesa que esteja LIVRE (catalogo
-- disponivel, sem sessao aberta propria) -- NAO e' escopo desta onda fundir
-- DUAS sessoes que ja tem pedidos independentes cada uma. Motivo:
-- orders.mesa_session_id e' imutavel desde a Onda 3 ("nunca reatribuida/
-- limpa") -- mover pedidos ja existentes de uma sessao pra outra violaria
-- essa invariante. Um "merge de duas contas ja ativas" e' uma decisao de
-- produto nova que exigiria reconsiderar essa invariante -- fora do escopo
-- aqui.
--
-- Implementacao quase identica a admin_trocar_mesa_sessao (Onda 9), SEM o
-- passo de fechar a linha antiga -- e' exatamente essa ausencia que faz as
-- mesas antiga e nova ficarem "ocupadas" ao mesmo tempo pela mesma sessao,
-- em vez de uma substituir a outra.
--
-- admin_juntar_mesa_sessao(p_mesa_session_id, p_identificador_adicional,
-- p_store_id) -- SECURITY DEFINER, is_admin_of(p_store_id) + WHERE store_id
-- explicito. Lock da sessao via SELECT...FOR UPDATE (mesmo padrao das Ondas
-- 6/9). Reaproveita o indice unico parcial da Onda 2 pra arbitrar
-- concorrencia via unique_violation (mesa ja ocupada) -- nenhum mecanismo
-- novo. Mesma regra de negocio da Onda 4/9 ("mesa indisponivel nao recebe
-- sessao"). Juntar uma mesa que ja esta juntada a esta MESMA sessao e' um
-- no-op amigavel (mesmo padrao do "trocar pra mesma mesa" da Onda 9).
--
-- Testes: scripts/mesa-02-onda10-juntar-mesas-test.mjs (E2E).
-- Rollback: REF-MESA-02-onda10-juntar-mesas-rollback.sql (DROP FUNCTION,
-- aditiva pura -- nenhuma funcao existente alterada).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_juntar_mesa_sessao(p_mesa_session_id uuid, p_identificador_adicional text, p_store_id uuid DEFAULT default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_novo text := nullif(btrim(p_identificador_adicional), '');
  v_status text;
  v_status_mesa text;
  v_mesas jsonb;
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sem permissao');
  END IF;
  IF v_novo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mesa nao encontrada');
  END IF;

  -- Lock da sessao -- serializa contra fechamento concorrente (mesmo padrao das Ondas 6/9).
  SELECT status INTO v_status FROM public.mesa_sessions
  WHERE id = p_mesa_session_id AND store_id = p_store_id
  FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sessao nao encontrada');
  END IF;
  IF v_status <> 'aberta' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sessao ja fechada');
  END IF;

  -- ja juntada a esta mesma sessao -> no-op amigavel (nao tenta duplicar a linha).
  IF EXISTS (
    SELECT 1 FROM public.mesa_session_mesas
    WHERE mesa_session_id = p_mesa_session_id AND store_id = p_store_id
      AND mesa_identificador = v_novo AND status_sessao = 'aberta'
  ) THEN
    SELECT coalesce(jsonb_agg(DISTINCT mesa_identificador), '[]'::jsonb) INTO v_mesas
    FROM public.mesa_session_mesas
    WHERE mesa_session_id = p_mesa_session_id AND store_id = p_store_id AND status_sessao = 'aberta';
    RETURN jsonb_build_object('ok', true, 'mesa_session_id', p_mesa_session_id, 'mesas', v_mesas);
  END IF;

  SELECT status INTO v_status_mesa FROM public.mesas
  WHERE store_id = p_store_id AND identificador = v_novo;
  IF v_status_mesa IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mesa nao encontrada');
  END IF;
  IF v_status_mesa <> 'disponivel' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mesa indisponivel');
  END IF;

  BEGIN
    INSERT INTO public.mesa_session_mesas (mesa_session_id, store_id, mesa_identificador)
    VALUES (p_mesa_session_id, p_store_id, v_novo);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mesa ja ocupada');
  END;

  SELECT coalesce(jsonb_agg(DISTINCT mesa_identificador), '[]'::jsonb) INTO v_mesas
  FROM public.mesa_session_mesas
  WHERE mesa_session_id = p_mesa_session_id AND store_id = p_store_id AND status_sessao = 'aberta';

  RETURN jsonb_build_object('ok', true, 'mesa_session_id', p_mesa_session_id, 'mesas', v_mesas);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_juntar_mesa_sessao(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_juntar_mesa_sessao(uuid, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
