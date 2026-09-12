-- ============================================================================
-- REF-LOYALTY-02 · Onda 6 — re-debita a recompensa RESGATADA quando um pedido cancelado (que já
-- teve o resgate restaurado pela Onda 5) é REABERTO. Fecha a decisão pendente deixada em aberto
-- no cabeçalho da migration da Onda 5.
-- ----------------------------------------------------------------------------
-- ACHADO: a Onda 5 fez cancelar um pedido com resgate devolver os selos ao cliente
-- (`stamps += required`, `rewards_redeemed -= 1`, marcador `cancel_trigger_resgate`). Mas o
-- branch de REABERTURA (`old.status='cancelado' and new.status<>'cancelado'`) só tratava o lado
-- do selo GANHO -- reabrir um pedido que tinha tido seu resgate restaurado não re-debitava nada.
-- Consequência: o pedido reaberto continua com `desconto_fidelidade`/`total` refletindo o
-- desconto original (nunca são recalculados na reabertura) *e* o cliente fica com os selos de
-- volta na conta, livres para gastar de novo -- desconto concedido duas vezes, prejuízo real para
-- a loja. Reabrir pedido é ação normal do Admin (mesmo fluxo já coberto por
-- admin-pedidos-status.spec.js "cancelar e reabrir devolve o pedido ao início da trilha"), não é
-- caso hipotético.
--
-- FIX (aditivo puro -- ZERO linha das lógicas existentes de GANHO/cancelamento é alterada; espelha
-- EXATAMENTE o padrão já usado pelo bloco de selo GANHO no mesmo branch de reabertura):
--   Ao REABRIR (`old.status='cancelado' -> new.status<>'cancelado'`): se existir um evento
--   'cancel_trigger_resgate' para este order_id (prova de que a Onda 5 restaurou um resgate) e
--   ainda não houver um evento de reversão para ele, re-debita `stamps -= required` (abs(delta) do
--   próprio evento de restauração -- nunca um número assumido) e `rewards_redeemed += 1`,
--   restaurando o estado exatamente como estava antes do cancelamento. Idempotente por marcador
--   dedicado (`origem='cancel_trigger_resgate_revert'`).
--
--   FAIL-CLOSED: se, enquanto o pedido estava cancelado, o cliente já tiver gasto os selos
--   restaurados em outro resgate (saldo atual < valor a re-debitar), a função NÃO debita
--   automaticamente (evitaria saldo negativo / inventar uma regra de estorno arriscada) -- só
--   grava um evento `adjustment` de delta 0 com origem `cancel_trigger_resgate_revert_pendente`,
--   deixando o caso registrado para revisão manual. Cenário raríssimo (cancelar -> restaurar ->
--   cliente resgatar de novo em outro pedido -> reabrir o primeiro), decisão consciente de não
--   resolver sozinho.
--
-- NÃO TOCA (fora do escopo, mesmo motivo da Onda 5): create_order(), _processar_webhook_payment_intent(),
-- redeem_reward(), _redeem_loyalty_for_order(), loyalty_grant(), e o branch de CANCELAMENTO da
-- própria loyalty_void_on_cancel (100% intocado, só o branch de REABERTURA ganha o bloco novo).
--
-- Idempotente (CREATE OR REPLACE, mesma assinatura -- função de trigger, sem parâmetros, nenhum
-- risco de overload). Testado no projeto E2E (bgzcrovskjbktdxkhemd) antes de qualquer cogitação de
-- produção -- ver scripts/loyalty-02-onda6-test.mjs. Compat produção (Supabase/Postgres 15).
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
  -- REF-LOYALTY-02 · Onda 6:
  v_ja_revertido boolean;
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

    -- REF-LOYALTY-02 · Onda 5 -- 100% INTOCADA: restaura recompensa RESGATADA por este pedido, se
    -- ele for cancelado antes de concluir.
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
    -- Reabertura de selo GANHO -- 100% INTOCADA.
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

    -- REF-LOYALTY-02 · Onda 6 (NOVO): espelho do bloco acima, mas para o lado do RESGATE. Se este
    -- pedido teve um resgate restaurado pela Onda 5 (branch de cancelamento acima), re-debita ao
    -- reabrir -- idempotente, fail-closed se o cliente já gastou os selos restaurados em outro
    -- lugar nesse meio-tempo.
    begin
      select delta into v_redeem_delta from public.loyalty_events
        where order_id = new.id and tipo = 'redeemed' order by created_at limit 1;
      if v_redeem_delta is not null then
        select exists(select 1 from public.loyalty_events where order_id = new.id and origem = 'cancel_trigger_resgate') into v_ja_restaurado;
        select exists(select 1 from public.loyalty_events where order_id = new.id and origem in ('cancel_trigger_resgate_revert','cancel_trigger_resgate_revert_pendente')) into v_ja_revertido;
        if v_ja_restaurado and not v_ja_revertido then
          select stamps into v_stamps from public.loyalty_accounts where customer_id = new.customer_id for update;
          if coalesce(v_stamps,0) >= abs(v_redeem_delta) then
            update public.loyalty_accounts
               set stamps = stamps - abs(v_redeem_delta), rewards_redeemed = rewards_redeemed + 1, updated_at = now()
             where customer_id = new.customer_id
             returning stamps into v_stamps;
            insert into public.loyalty_events (customer_id, order_id, tipo, delta, stamps_after, origem, note, store_id)
              values (new.customer_id, new.id, 'adjustment', -abs(v_redeem_delta), v_stamps, 'cancel_trigger_resgate_revert', 'resgate re-debitado (pedido reaberto apos ter sido restaurado no cancelamento)', new.store_id);
          else
            insert into public.loyalty_events (customer_id, order_id, tipo, delta, stamps_after, origem, note, store_id)
              values (new.customer_id, new.id, 'adjustment', 0, coalesce(v_stamps,0), 'cancel_trigger_resgate_revert_pendente', 'pedido reaberto mas cliente ja gastou os selos restaurados em outro resgate -- revisao manual necessaria', new.store_id);
          end if;
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
