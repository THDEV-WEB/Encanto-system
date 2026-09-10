-- ============================================================================
-- REF-LOYALTY-02 · Onda 5 — restaura recompensa RESGATADA quando o pedido que a consumiu é
-- cancelado (achado real, encontrado ao revisar a interação entre a Onda 2 desta REF e o
-- HIGH-01 da REF-PAYMENT-SEC-02, sessão paralela).
-- ----------------------------------------------------------------------------
-- ACHADO: a Onda 2 fez o resgate (`_redeem_loyalty_for_order`, chamado dentro de create_order)
-- debitar `stamps` NA HORA, sem nenhuma checagem de `orders.status`/`payment_status` -- diferente
-- do HIGH-01 (REF-PAYMENT-SEC-02), que deferiu a CONCESSÃO de selo pra pedido online até o
-- pagamento confirmar. `loyalty_void_on_cancel` (o único lugar que reverte fidelidade quando um
-- pedido é cancelado) já soma `sum(delta) WHERE origem IN ('create_order','cancel_trigger')` pra
-- decidir quanto reverter -- mas só reverte quando essa soma é POSITIVA (`if v_contrib > 0`).
-- Um evento `tipo='redeemed'` tem delta NEGATIVO (-required) -- o guard `> 0` o ignora
-- silenciosamente. Resultado confirmado por leitura de código (não hipótese): QUALQUER pedido
-- (online OU físico, qualquer motivo de cancelamento -- cron de expiração de 15min, admin
-- cancelando manualmente) que tenha consumido uma recompensa e for cancelado NUNCA devolve a
-- recompensa ao cliente. Ele perde 100% do valor (os `required` selos gastos) sem receber nada --
-- pior no caso de pagamento online recusado/expirado, mas não exclusivo dele.
--
-- FIX (aditivo puro -- ZERO linha da lógica existente de reversão/reabertura de selo GANHO é
-- alterada; nova consulta INDEPENDENTE, filtrando por `tipo='redeemed'` em vez de `origem`, já
-- que um pedido nunca tem ao mesmo tempo evento 'earned' e 'redeemed', mutuamente exclusivos
-- desde a Onda 2 -- as duas buscas nunca competem pelo mesmo evento):
--   Ao ENTRAR em 'cancelado': se existir um evento 'redeemed' para este order_id, restaura
--   `stamps += required-daquele-resgate` (abs(delta) do próprio evento -- nunca um número
--   assumido) e `rewards_redeemed -= 1` (como se o resgate nunca tivesse acontecido). Idempotente
--   por marcador dedicado (`origem='cancel_trigger_resgate'`, nunca usado por nenhum outro código)
--   -- nunca restaura duas vezes o mesmo pedido.
--
-- NÃO TOCA (fora do escopo, propositalmente, para não conflitar com a REF-PAYMENT-SEC-02 em
-- andamento em paralelo): create_order(), _processar_webhook_payment_intent(),
-- _registrar_criacao_pagamento(), redeem_reward(), _redeem_loyalty_for_order(), loyalty_grant().
--
-- DECISÃO PENDENTE, não resolvida silenciosamente aqui: se o pedido REABRIR depois de restaurada
-- a recompensa (old.status='cancelado' -> novo status), a recompensa restaurada NÃO é re-debitada
-- automaticamente -- o cliente fica com o valor de volta. Fica registrado para decisão explícita
-- do dono se esse comportamento algum dia precisar mudar (cenário raro: pedido com resgate,
-- cancelado, reaberto).
--
-- RESIDUAL CONHECIDO, não fechado por esta migration: pagamento 'recusado' que o cliente NUNCA
-- reenvia fica com `payment_intent.status='recusado'` (estado TERMINAL na máquina de estados --
-- não pode virar 'expirado') e `orders.status` PRESO em 'aguardando_pagamento' para sempre --
-- este trigger só reage a uma mudança real de `orders.status`, que nunca acontece nesse caso
-- específico. Fora do escopo desta correção (exigiria tocar o webhook/cron de pagamento,
-- propriedade da REF-PAYMENT-SEC-02).
--
-- Idempotente (CREATE OR REPLACE, mesma assinatura -- é uma função de trigger, sem parâmetros,
-- nenhum risco de overload). Testado no projeto E2E (bgzcrovskjbktdxkhemd) antes de qualquer
-- cogitação de produção -- ver scripts/loyalty-02-onda5-test.mjs. Compat produção
-- (Supabase/Postgres 15).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.loyalty_void_on_cancel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_stamps   int;
  v_required int;
  v_contrib  int;
  v_earned   boolean;
  -- REF-LOYALTY-02 · Onda 5:
  v_redeem_delta  int;
  v_ja_restaurado boolean;
begin
  v_required := coalesce((select valor from public.store_settings where store_id = new.store_id and chave = 'loyalty_required'), '10')::int;

  if new.status = 'cancelado' and coalesce(old.status,'') <> 'cancelado' then
    -- Reversão de selo GANHO -- 100% INTOCADA (mesma consulta/lógica desde a origem).
    begin
      select coalesce(sum(delta),0) into v_contrib from public.loyalty_events
        where order_id = new.id and origem in ('create_order','cancel_trigger');
      if v_contrib > 0 then
        update public.loyalty_accounts
           set stamps = greatest(0, stamps - v_contrib), earned_total = greatest(0, earned_total - v_contrib), updated_at = now()
         where customer_id = new.customer_id
         returning stamps into v_stamps;
        insert into public.loyalty_events (customer_id, order_id, tipo, delta, stamps_after, origem, note, store_id)
          values (new.customer_id, new.id, 'revoked', -v_contrib, v_stamps, 'cancel_trigger', 'pedido cancelado', new.store_id);
      end if;
    exception when others then
      null;
    end;

    -- REF-LOYALTY-02 · Onda 5 (NOVO): restaura recompensa RESGATADA por este pedido, se ele for
    -- cancelado antes de concluir. Busca INDEPENDENTE por tipo='redeemed' -- nunca compete com a
    -- busca de selo ganho acima (mutuamente exclusivos por pedido desde a Onda 2).
    begin
      select delta into v_redeem_delta from public.loyalty_events
        where order_id = new.id and tipo = 'redeemed' order by created_at limit 1;
      if v_redeem_delta is not null then
        select exists(select 1 from public.loyalty_events where order_id = new.id and origem = 'cancel_trigger_resgate') into v_ja_restaurado;
        if not v_ja_restaurado then
          update public.loyalty_accounts
             set stamps = stamps + abs(v_redeem_delta), rewards_redeemed = greatest(0, rewards_redeemed - 1), updated_at = now()
           where customer_id = new.customer_id
           returning stamps into v_stamps;
          insert into public.loyalty_events (customer_id, order_id, tipo, delta, stamps_after, origem, note, store_id)
            values (new.customer_id, new.id, 'adjustment', abs(v_redeem_delta), v_stamps, 'cancel_trigger_resgate', 'recompensa restaurada (pedido cancelado antes de concluir)', new.store_id);
        end if;
      end if;
    exception when others then
      null;
    end;

  elsif coalesce(old.status,'') = 'cancelado' and new.status <> 'cancelado' then
    -- Reabertura de selo GANHO -- 100% INTOCADA. Reabertura de um pedido que teve recompensa
    -- restaurada NÃO re-debita automaticamente (decisão pendente, ver cabeçalho desta migration).
    begin
      select exists (select 1 from public.loyalty_events where order_id = new.id and tipo = 'earned') into v_earned;
      select coalesce(sum(delta),0) into v_contrib from public.loyalty_events
        where order_id = new.id and origem in ('create_order','cancel_trigger');
      if v_earned and v_contrib <= 0 then
        select stamps into v_stamps from public.loyalty_accounts where customer_id = new.customer_id for update;
        if coalesce(v_stamps,0) < v_required then
          update public.loyalty_accounts
             set stamps = stamps + 1, earned_total = earned_total + 1, updated_at = now()
           where customer_id = new.customer_id
           returning stamps into v_stamps;
          insert into public.loyalty_events (customer_id, order_id, tipo, delta, stamps_after, origem, note, store_id)
            values (new.customer_id, new.id, 'adjustment', 1, v_stamps, 'cancel_trigger', 'pedido reativado', new.store_id);
        end if;
      end if;
    exception when others then
      null;
    end;
  end if;
  return new;
end;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
