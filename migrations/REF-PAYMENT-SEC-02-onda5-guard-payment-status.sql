-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- REF-PAYMENT-SEC-02 · Onda 5 — trigger que impede alterar orders.payment_status fora do fluxo de
-- pagamento (achado MEDIUM-03 da REF-PAYMENT-SEC-01, seção 10/20).
--
-- ACHADO: a policy `Admin all orders` (RLS, cmd=ALL, is_admin_of(store_id)) permite qualquer UPDATE
-- em orders por um admin daquela loja, incluindo `payment_status='aprovado'` -- direto via REST,
-- sem nenhum payment_intent aprovado por trás. Não é escalação de privilégio (o admin já é admin
-- legítimo daquela loja), mas é uma lacuna de integridade: nenhuma checagem garante que
-- payment_status só reflete um pagamento REAL processado pela máquina de estados.
--
-- FIX (menor alteração possível, sem tocar a policy de RLS nem tirar do admin a capacidade de
-- operar pedidos normalmente -- status operacional, observações, etc. continuam 100% editáveis):
-- trigger BEFORE UPDATE que só entra em ação quando payment_status realmente MUDA de valor, e nesse
-- caso exige que quem está executando a escrita seja `postgres` ou `service_role` -- os únicos
-- roles com os quais as escritas legítimas de payment_status acontecem hoje:
--   - _processar_webhook_payment_intent / _registrar_criacao_pagamento (chamadas pelas Edge
--     Functions via service_role) -- current_user = service_role.
--   - _expirar_payment_intents_pendentes (pg_cron, agendado como usuário postgres) -- current_user
--     = postgres.
--   - create_order() é SECURITY DEFINER (dono postgres) mas só faz INSERT, nunca UPDATE, em
--     orders.payment_status -- não é afetado por este trigger (BEFORE UPDATE, não BEFORE INSERT).
-- Uma UPDATE feita por `authenticated` (admin via PostgREST/REST direto) ou `anon` nunca passa por
-- nenhuma dessas funções -- current_user seria o próprio role da sessão -- e é bloqueada.
--
-- payment_status permanece NULL-mutável/editável nos outros campos de orders (status operacional,
-- observações, etc.) -- só a COLUNA payment_status fica protegida. Nenhuma policy de RLS mudou.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public._orders_payment_status_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    IF current_user NOT IN ('postgres', 'service_role') THEN
      RAISE EXCEPTION 'payment_status so pode ser alterado pelo fluxo de pagamento (webhook/RPC), nunca diretamente'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_orders_payment_status_guard ON public.orders;
CREATE TRIGGER trg_orders_payment_status_guard
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public._orders_payment_status_guard();

REVOKE ALL ON FUNCTION public._orders_payment_status_guard() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
