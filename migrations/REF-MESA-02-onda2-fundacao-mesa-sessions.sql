-- ============================================================================
-- REF-MESA-02 · Onda 2 — Fundação de schema: mesa_sessions + mesa_session_mesas
-- ----------------------------------------------------------------------------
-- Cria a entidade server-side de sessão/conta de mesa (nenhuma RPC, nenhum fluxo
-- de abertura/fechamento, nenhum QR, nenhuma UI de Admin nesta onda -- só schema,
-- constraints, RLS e triggers de integridade).
--
-- DESVIO DELIBERADO do modelo original da auditoria (docs/ref/REF-MESA-02-
-- auditoria.md §3), por instrução explícita do dono do produto nesta onda: a
-- auditoria propunha `mesa_sessions.mesa_identificador text` como coluna
-- ESCALAR, com um índice único parcial diretamente nela. Isso foi identificado
-- pela própria auditoria (risco R8, veredito adversarial "skeptic-evolution")
-- como o único ponto do modelo que bloqueia de fato "juntar mesas" -- o
-- requisito explícito de JOIN DE MESAS desta REF. Por isso, aqui a sessão NUNCA
-- é identificada por um texto livre escalar: `mesa_sessions` não tem nenhuma
-- coluna de identificador de mesa. Em vez disso, `mesa_session_mesas` é uma
-- tabela de associação N:1 (várias linhas, um identificador de mesa cada, todas
-- apontando para a MESMA mesa_session) -- suporta junção de mesas desde a
-- fundação, sem retrofit futuro do mecanismo central de concorrência (que é
-- exatamente o custo que a auditoria alertou subir muito depois da Onda 8 do
-- plano de ondas).
--
-- mesa_sessions (estado da conta): id, store_id, status (aberta/fechada),
-- origem_abertura (qr_mesa/admin_garcom), opened_at/opened_by_admin_user_id,
-- closed_at/closed_by_admin_user_id, payment_method, valor_cobrado_snapshot
-- (renomeado de "valor_pago" da proposta original -- ver COMMENT ON COLUMN --
-- é auditoria do fechamento, NUNCA uma segunda fonte de receita agregável),
-- request_id (idempotência de abertura, mesmo padrão de orders.request_id).
--
-- mesa_session_mesas (associação): id, mesa_session_id (FK), store_id
-- (redundante com o pai por design -- mesmo padrão de order_items.store_id/
-- notification_outbox.store_id neste domínio -- mas VALIDADO por trigger contra
-- o pai, nunca confiado isoladamente), mesa_identificador (texto livre, mesmos
-- limites de orders.mesa_identificador -- catálogo formal de mesas físicas
-- fica para quando essa estrutura existir, onda futura de "Mesas
-- Físicas/Capability"), status_sessao (espelho do status do pai, mantido por
-- trigger -- nunca escrito diretamente por nenhuma RPC), attached_at.
--
-- CONCORRÊNCIA/INTEGRIDADE (schema puro, sem RPC ainda):
--   - UNIQUE PARCIAL (store_id, mesa_identificador) WHERE status_sessao='aberta'
--     em mesa_session_mesas: no máximo 1 sessão aberta por identificador de mesa
--     a qualquer momento, por loja. É o Postgres, não a aplicação, quem garante
--     isso -- mesmo mecanismo estrutural de orders_request_id_uniq.
--   - Trigger AFTER UPDATE OF status ON mesa_sessions sincroniza status_sessao
--     em TODAS as linhas-filhas daquela sessão -- garante que o índice acima
--     sempre reflita o estado real do pai, mesmo sem nenhuma RPC de fechamento
--     existir ainda (a trigger já fica pronta para quando a Onda de fechamento
--     for construída).
--   - Trigger BEFORE INSERT ON mesa_session_mesas valida que store_id bate com
--     o da sessão pai -- defesa em profundidade cross-tenant (mesma classe de
--     proteção sugerida pela auditoria para orders.store_id/mesa_session_id,
--     aqui aplicada um passo antes, já nesta onda).
--   - Trigger BEFORE UPDATE ON mesa_session_mesas impede alterar qualquer coisa
--     além de status_sessao -- a associação mesa-física↔sessão é imutável uma
--     vez criada (histórico permanente, igual a um pedido).
--   - Trigger BEFORE UPDATE ON mesa_sessions impede qualquer alteração numa
--     sessão já 'fechada' -- nunca reabre, nunca edita depois de fechada
--     (decisão definitiva do dono do produto).
--
-- SEGURANÇA: as 2 tabelas seguem o padrão "tabela de config" já estabelecido
-- neste domínio para store_settings/active_tenant/admins/super_admins -- RLS
-- habilitada, ZERO CREATE POLICY (deny-all estrutural, nem precisa de policy
-- pra negar authenticated/anon -- ausência de policy já nega tudo), MAIS
-- REVOKE ALL explícito de anon/authenticated (defesa em profundidade, mesmo
-- padrão redundante já usado nessas tabelas). Nenhuma RPC nesta onda -- só o
-- owner (postgres/service_role) toca essas tabelas por enquanto. As 4 funções
-- de trigger são internas (prefixo "_"), sem GRANT a ninguém, SET search_path
-- fixo (hardening padrão contra search_path hijacking).
--
-- Testes: scripts/mesa-02-onda2-fundacao-test.mjs (E2E, projeto dedicado).
-- Rollback: REF-MESA-02-onda2-fundacao-mesa-sessions-rollback.sql (DROP TABLE,
-- greenfield -- nenhuma RPC grava nestas tabelas ainda, sem dado real a perder).
-- ============================================================================

BEGIN;

CREATE TABLE public.mesa_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL DEFAULT default_store_id() REFERENCES public.stores(id),
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'fechada')),
  origem_abertura text NOT NULL CHECK (origem_abertura IN ('qr_mesa', 'admin_garcom')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opened_by_admin_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at timestamptz NULL,
  closed_by_admin_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  payment_method text NULL,
  valor_cobrado_snapshot numeric(10,2) NULL,
  request_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mesa_sessions_valor_cobrado_snapshot_check
    CHECK (valor_cobrado_snapshot IS NULL OR valor_cobrado_snapshot >= 0),
  -- admin_garcom exige saber QUEM abriu; qr_mesa nunca tem admin associado (canal do cliente final).
  CONSTRAINT mesa_sessions_origem_opened_by_coerente
    CHECK ((origem_abertura = 'admin_garcom') = (opened_by_admin_user_id IS NOT NULL)),
  -- aberta: nada de fechamento preenchido. fechada: fechamento completo, e (gratuita OU com forma de
  -- pagamento). Mesmo estilo de orders_mesa_identificador_coerente (CHECK cross-coluna por estado).
  CONSTRAINT mesa_sessions_coerencia_estado CHECK (
    (status = 'aberta' AND closed_at IS NULL AND closed_by_admin_user_id IS NULL
       AND payment_method IS NULL AND valor_cobrado_snapshot IS NULL)
    OR
    (status = 'fechada' AND closed_at IS NOT NULL AND closed_by_admin_user_id IS NOT NULL
       AND valor_cobrado_snapshot IS NOT NULL
       AND (valor_cobrado_snapshot = 0 OR payment_method IS NOT NULL))
  )
);

COMMENT ON TABLE public.mesa_sessions IS
  'Sessao/conta de atendimento de mesa (REF-MESA-02). NAO relacionada a auth.sessions/active_tenant.session_id (sessao de AUTENTICACAO) -- coincidencia de palavra apenas. Mesas fisicas associadas vivem em mesa_session_mesas, nunca uma coluna escalar aqui (suporta juncao de mesas desde a fundacao).';
COMMENT ON COLUMN public.mesa_sessions.valor_cobrado_snapshot IS
  'Snapshot de auditoria do valor cobrado no FECHAMENTO -- NUNCA somar em relatorios agregados (nao e uma segunda fonte de receita). A fonte de verdade de faturamento continua sendo SUM(orders.total). Ver docs/ref/REF-MESA-02-auditoria.md secao 3/risco R7.';

CREATE INDEX mesa_sessions_store_id_idx ON public.mesa_sessions (store_id);
CREATE UNIQUE INDEX mesa_sessions_request_id_uniq ON public.mesa_sessions (request_id) WHERE request_id IS NOT NULL;

ALTER TABLE public.mesa_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mesa_sessions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public._mesa_sessions_no_reopen()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF OLD.status = 'fechada' THEN
    RAISE EXCEPTION 'sessao de mesa fechada e imutavel -- nao pode ser reaberta nem alterada';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._mesa_sessions_no_reopen() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_mesa_sessions_no_reopen
  BEFORE UPDATE ON public.mesa_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public._mesa_sessions_no_reopen();

-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.mesa_session_mesas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mesa_session_id uuid NOT NULL REFERENCES public.mesa_sessions(id) ON DELETE RESTRICT,
  store_id uuid NOT NULL DEFAULT default_store_id() REFERENCES public.stores(id),
  mesa_identificador text NOT NULL,
  status_sessao text NOT NULL DEFAULT 'aberta' CHECK (status_sessao IN ('aberta', 'fechada')),
  attached_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mesa_session_mesas_identificador_len
    CHECK (length(btrim(mesa_identificador)) BETWEEN 1 AND 40)
);

COMMENT ON TABLE public.mesa_session_mesas IS
  'Associacao N:1 entre identificadores de mesa fisica e uma mesa_session (REF-MESA-02) -- varias linhas podem apontar pra mesma sessao (JUNCAO DE MESAS). status_sessao e espelho de mesa_sessions.status, mantido por trigger, nunca escrito diretamente. Imutavel apos criada (so status_sessao muda, via sincronizacao automatica). Catalogo formal de mesas fisicas (com id proprio, capacidade, disponibilidade) e evolucao futura -- mesa_identificador continua texto livre por ora, mesmo padrao de orders.mesa_identificador.';

CREATE INDEX mesa_session_mesas_session_id_idx ON public.mesa_session_mesas (mesa_session_id);
CREATE INDEX mesa_session_mesas_store_id_idx ON public.mesa_session_mesas (store_id);
-- Mecanismo central de concorrencia: no maximo 1 sessao ABERTA por identificador de mesa, por loja.
CREATE UNIQUE INDEX mesa_session_mesas_uma_aberta_por_mesa_uniq
  ON public.mesa_session_mesas (store_id, mesa_identificador) WHERE status_sessao = 'aberta';

ALTER TABLE public.mesa_session_mesas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mesa_session_mesas FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public._mesa_session_mesas_check_store()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_parent_store uuid;
BEGIN
  SELECT store_id INTO v_parent_store FROM public.mesa_sessions WHERE id = NEW.mesa_session_id;
  IF v_parent_store IS NULL THEN
    RAISE EXCEPTION 'mesa_session_id invalido';
  END IF;
  IF NEW.store_id <> v_parent_store THEN
    RAISE EXCEPTION 'store_id da associacao nao corresponde a loja da sessao';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._mesa_session_mesas_check_store() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_mesa_session_mesas_check_store
  BEFORE INSERT ON public.mesa_session_mesas
  FOR EACH ROW
  EXECUTE FUNCTION public._mesa_session_mesas_check_store();

CREATE OR REPLACE FUNCTION public._mesa_session_mesas_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.mesa_session_id <> OLD.mesa_session_id
     OR NEW.store_id <> OLD.store_id
     OR NEW.mesa_identificador <> OLD.mesa_identificador
     OR NEW.attached_at <> OLD.attached_at
  THEN
    RAISE EXCEPTION 'associacao mesa-sessao e imutavel -- apenas status_sessao pode mudar (sincronizacao automatica)';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._mesa_session_mesas_immutable() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_mesa_session_mesas_immutable
  BEFORE UPDATE ON public.mesa_session_mesas
  FOR EACH ROW
  EXECUTE FUNCTION public._mesa_session_mesas_immutable();

CREATE OR REPLACE FUNCTION public._mesa_session_mesas_sync_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.status <> OLD.status THEN
    UPDATE public.mesa_session_mesas SET status_sessao = NEW.status WHERE mesa_session_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._mesa_session_mesas_sync_status() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_mesa_sessions_sync_child_status
  AFTER UPDATE OF status ON public.mesa_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public._mesa_session_mesas_sync_status();

NOTIFY pgrst, 'reload schema';

COMMIT;
