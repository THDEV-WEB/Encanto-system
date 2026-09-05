-- ============================================================================
-- REF-MESA-02 · Onda 3 — Relação orders ↔ mesa_session (schema apenas, ainda
-- não usada por create_order())
-- ----------------------------------------------------------------------------
-- Adiciona o vínculo N:1 do pedido para a sessão -- nullable, sem default, sem
-- nenhuma RPC gravando nele ainda. Separa "mudança de schema" de "mudança de
-- comportamento" em commits distintos (create_order() só passa a resolver e
-- gravar mesa_session_id numa onda futura, quando abrir_sessao_mesa() e as
-- funções internas de concorrência já existirem).
--
-- COMPATIBILIDADE COM PEDIDOS EXISTENTES: coluna NULLABLE sem DEFAULT volátil
-- -- ADD COLUMN é instantâneo (não reescreve a tabela), todo pedido histórico
-- e todo pedido novo continuam com mesa_session_id NULL até uma onda futura
-- popular isso. Nenhum comportamento de Delivery/Retirada/Mesa-sem-sessão muda.
--
-- INTEGRIDADE:
--   - CHECK orders_mesa_session_id_coerente: mesa_session_id só pode ser
--     preenchido quando tipo_pedido='mesa' (mesmo estilo de
--     orders_mesa_identificador_coerente já existente).
--   - ON DELETE RESTRICT: nunca é possível apagar uma mesa_session que ainda
--     tenha pedido referenciando -- sessão fechada é histórico permanente,
--     igual a um pedido.
--   - Trigger BEFORE UPDATE ON orders (_orders_mesa_session_check_store):
--     quando mesa_session_id é preenchido/alterado, valida que orders.store_id
--     bate com o store_id real da mesa_session -- defesa em profundidade
--     cross-tenant (risco R9 da auditoria), mesma técnica já usada em
--     mesa_session_mesas na Onda 2. Roda tanto em INSERT quanto em UPDATE.
--   - Trigger BEFORE UPDATE ON orders (_orders_mesa_session_immutable):
--     depois de gravado, mesa_session_id nunca pode ser trocado nem limpo --
--     impede o pedido ser "movido" para outra sessão e contado em dois
--     fechamentos diferentes (risco R6 da auditoria). Não bloqueia nenhuma
--     outra coluna de orders (status, observações, etc. continuam livres).
--
-- Nenhuma RPC, nenhum fluxo, nenhuma alteração em create_order()/
-- admin_orders_search() nesta onda -- só schema.
--
-- Testes: scripts/mesa-02-onda3-orders-fk-test.mjs (E2E) + regressão completa
-- de todas as suítes de create_order já existentes (nenhuma mudança de
-- resultado esperada, já que o corpo da função não foi tocado).
-- Rollback: REF-MESA-02-onda3-orders-mesa-session-fk-rollback.sql (DROP
-- CONSTRAINT + DROP COLUMN -- seguro enquanto nenhuma linha real tiver o
-- campo preenchido, garantido até uma onda futura popular isso de verdade).
-- ============================================================================

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN mesa_session_id uuid NULL REFERENCES public.mesa_sessions(id) ON DELETE RESTRICT;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_mesa_session_id_coerente
    CHECK (mesa_session_id IS NULL OR tipo_pedido = 'mesa');

CREATE INDEX orders_mesa_session_id_idx ON public.orders (mesa_session_id) WHERE mesa_session_id IS NOT NULL;

COMMENT ON COLUMN public.orders.mesa_session_id IS
  'FK opcional para mesa_sessions (REF-MESA-02) -- so preenchido quando tipo_pedido=mesa E a loja tiver mesa_sessao_habilitada. NULL para todo pedido de Entrega/Retirada e para Mesa sem sessao habilitada (100% do trafego historico e atual). Imutavel uma vez gravado -- ver trigger _orders_mesa_session_immutable.';

CREATE OR REPLACE FUNCTION public._orders_mesa_session_check_store()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_session_store uuid;
BEGIN
  IF NEW.mesa_session_id IS NOT NULL THEN
    SELECT store_id INTO v_session_store FROM public.mesa_sessions WHERE id = NEW.mesa_session_id;
    IF v_session_store IS NULL THEN
      RAISE EXCEPTION 'mesa_session_id invalido';
    END IF;
    IF NEW.store_id <> v_session_store THEN
      RAISE EXCEPTION 'store_id do pedido nao corresponde a loja da sessao de mesa';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._orders_mesa_session_check_store() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_orders_mesa_session_check_store
  BEFORE INSERT OR UPDATE OF mesa_session_id ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public._orders_mesa_session_check_store();

CREATE OR REPLACE FUNCTION public._orders_mesa_session_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF OLD.mesa_session_id IS NOT NULL AND NEW.mesa_session_id IS DISTINCT FROM OLD.mesa_session_id THEN
    RAISE EXCEPTION 'mesa_session_id do pedido e imutavel uma vez gravado -- nao pode ser reatribuido nem limpo';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._orders_mesa_session_immutable() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_orders_mesa_session_immutable
  BEFORE UPDATE OF mesa_session_id ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public._orders_mesa_session_immutable();

NOTIFY pgrst, 'reload schema';

COMMIT;
