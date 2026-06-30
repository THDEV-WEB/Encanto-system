-- HARDEN-ORDERS-RLS · Step 1 — create_order vira SECURITY DEFINER (D-RPC). ATÔMICO.
-- MOTIVO: create_order é a ÚNICA porta de escrita de pedido do anon (DS.savePedido). Hoje é SECURITY INVOKER e
--   só insere porque a policy 'Allow all' deixa o anon. Ao remover essas policies (step2), o anon perde a
--   escrita direta — então a RPC PRECISA rodar como dono (DEFINER) para inserir orders/customers/order_items.
-- Mesmos critérios da F1B-Errata-01: owner=postgres, search_path fixo, sem SQL dinâmico (corpo já 100% qualificado
--   public.*; verificado), privilégio mínimo (revoga PUBLIC; anon/authenticated/service_role mantêm EXECUTE —
--   anon é o chamador legítimo do checkout). Não altera o CORPO da função (só atributos) — usa ALTER FUNCTION.
-- Nuance conhecida (NÃO bloqueante): no log de erro (application_logs.origin), current_user passa a ser 'postgres'
--   (era anon/authenticated) — pequena perda de fidelidade forense (não é vetor de segurança). Capturar o caller
--   antes do corpo (v_caller := current_user) fica para uma errata futura, se desejado.
-- PREMISSA do D-RPC (verificada): orders/customers/order_items têm relforcerowsecurity=FALSE → o owner (postgres)
--   bypassa a RLS, então a RPC DEFINER insere mesmo com o anon sem policy/grant. Um futuro FORCE ROW LEVEL SECURITY
--   sujeitaria o DEFINER às policies e exigiria uma policy explícita para o owner — registrar antes de forçar RLS.
-- Rollback: migrations/HARDEN-ORDERS-RLS-step1-rollback.sql (⚠️ reverter só junto/depois do step2-rollback).
BEGIN;

ALTER FUNCTION public.create_order(jsonb, jsonb, jsonb, uuid) SECURITY DEFINER;
ALTER FUNCTION public.create_order(jsonb, jsonb, jsonb, uuid) SET search_path = pg_catalog, public;

-- privilégio mínimo: anon/authenticated/service_role mantêm EXECUTE explícito; remove só o grant amplo de PUBLIC
REVOKE EXECUTE ON FUNCTION public.create_order(jsonb, jsonb, jsonb, uuid) FROM PUBLIC;

COMMIT;
