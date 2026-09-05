-- ============================================================================
-- REF-MESA-02 · Onda 9 — Troca de mesa
-- ----------------------------------------------------------------------------
-- Move uma sessao ABERTA da mesa fisica A para a mesa fisica B (cliente muda
-- de lugar) -- sessao/pedidos/total continuam os mesmos, so a mesa fisica
-- associada muda. Nao fecha nada, nao cria pedido novo.
--
-- DECISAO DE DESIGN (documentada aqui por ser um desvio de invariante
-- registrado na Onda 2): NAO da pra fazer isso com um
-- `UPDATE mesa_session_mesas SET mesa_identificador = ...` -- a trigger
-- `_mesa_session_mesas_immutable` bloqueia explicitamente mudar
-- mesa_identificador numa linha existente (auditoria/historico permanente,
-- por design). A abordagem que preserva o historico completo de por quais
-- mesas a sessao passou:
--   1. INSERT uma linha NOVA em mesa_session_mesas pro identificador novo
--      (o indice unico parcial da Onda 2 arbitra concorrencia via
--      unique_violation se outra sessao ja estiver la -- mesmo mecanismo
--      de _get_or_open_mesa_session, Onda 6, nao inventa um novo).
--   2. UPDATE mesa_session_mesas SET status_sessao = 'fechada' na linha
--      ANTIGA -- a UNICA escrita direta em status_sessao fora da trigger de
--      sincronizacao automatica (trg_mesa_sessions_sync_child_status) desde
--      a Onda 2. Ate aqui, o COMMENT ON TABLE mesa_session_mesas dizia
--      "status_sessao e espelho do pai, mantido por trigger, nunca escrito
--      diretamente" -- essa e' a excecao deliberada: sem ela, a mesa antiga
--      nunca ficaria livre de novo enquanto a sessao seguisse aberta (o
--      trigger so' sincroniza TODAS as linhas quando o STATUS DO PAI muda,
--      e o pai continua 'aberta' o tempo todo numa troca de mesa).
-- Efeito colateral aceito e correto: como a linha antiga agora tem
-- status_sessao='fechada' mas pertence a uma sessao com status='aberta',
-- ela nao volta a ser sincronizada como 'aberta' pela trigger do pai
-- (a trigger so' roda em UPDATE OF status ON mesa_sessions -- nao ha update
-- nenhum na sessao numa troca de mesa, e' exatamente por isso que o valor
-- fica estavel em 'fechada' pra aquela mesa especifica).
--
-- admin_trocar_mesa_sessao(p_mesa_session_id, p_novo_identificador,
-- p_store_id) -- SECURITY DEFINER, is_admin_of(p_store_id) + WHERE store_id
-- explicito (mesmo padrao corrigido nas Ondas 2/3/4). Lock da sessao via
-- SELECT...FOR UPDATE (mesmo padrao de _get_or_open_mesa_session, Onda 6) --
-- serializa contra fechamento concorrente (RPC de fechar_conta_mesa, onda
-- futura, vai adquirir o MESMO lock antes de mudar o status).
-- Regra de negocio ja registrada na Onda 4 ("mesa indisponivel nao recebe
-- nova sessao") tambem se aplica aqui -- trocar PARA uma mesa indisponivel
-- e' rejeitado.
--
-- Testes: scripts/mesa-02-onda9-trocar-mesa-test.mjs (E2E).
-- Rollback: REF-MESA-02-onda9-trocar-mesa-rollback.sql (DROP FUNCTION,
-- aditiva pura -- nenhuma funcao existente alterada, so tabelas ja
-- existentes tocadas por uma RPC nova).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_trocar_mesa_sessao(p_mesa_session_id uuid, p_novo_identificador text, p_store_id uuid DEFAULT default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_novo text := nullif(btrim(p_novo_identificador), '');
  v_status text;
  v_antiga_id uuid;
  v_antigo_identificador text;
  v_novo_status_mesa text;
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sem permissao');
  END IF;
  IF v_novo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mesa nao encontrada');
  END IF;

  -- Lock da sessao -- serializa contra fechamento concorrente (mesmo padrao da Onda 6).
  SELECT status INTO v_status FROM public.mesa_sessions
  WHERE id = p_mesa_session_id AND store_id = p_store_id
  FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sessao nao encontrada');
  END IF;
  IF v_status <> 'aberta' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sessao ja fechada');
  END IF;

  SELECT status INTO v_novo_status_mesa FROM public.mesas
  WHERE store_id = p_store_id AND identificador = v_novo;
  IF v_novo_status_mesa IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mesa nao encontrada');
  END IF;
  IF v_novo_status_mesa <> 'disponivel' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mesa indisponivel');
  END IF;

  -- linha ABERTA atual desta sessao (se ja estiver na mesa destino, no-op amigavel).
  SELECT id, mesa_identificador INTO v_antiga_id, v_antigo_identificador
  FROM public.mesa_session_mesas
  WHERE mesa_session_id = p_mesa_session_id AND store_id = p_store_id AND status_sessao = 'aberta'
  ORDER BY attached_at DESC LIMIT 1;

  IF v_antigo_identificador = v_novo THEN
    RETURN jsonb_build_object('ok', true, 'mesa_session_id', p_mesa_session_id, 'de', v_antigo_identificador, 'para', v_novo);
  END IF;

  BEGIN
    INSERT INTO public.mesa_session_mesas (mesa_session_id, store_id, mesa_identificador)
    VALUES (p_mesa_session_id, p_store_id, v_novo);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mesa ja ocupada');
  END;

  IF v_antiga_id IS NOT NULL THEN
    UPDATE public.mesa_session_mesas SET status_sessao = 'fechada' WHERE id = v_antiga_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'mesa_session_id', p_mesa_session_id, 'de', v_antigo_identificador, 'para', v_novo);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_trocar_mesa_sessao(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_trocar_mesa_sessao(uuid, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
