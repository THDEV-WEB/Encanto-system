-- ============================================================================
-- REF-LOYALTY-02 · Onda 5 — ROLLBACK
-- ----------------------------------------------------------------------------
-- Restaura loyalty_void_on_cancel exatamente como estava desde REF-LOYALTY-AUDIT-01 · Onda 1
-- (byte-a-byte, confirmado por leitura direta do E2E antes desta migration). Mesma assinatura
-- (função de trigger, sem parâmetros) -- CREATE OR REPLACE simples, sem DROP.
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
begin
  v_required := coalesce((select valor from public.store_settings where store_id = new.store_id and chave = 'loyalty_required'), '10')::int;

  if new.status = 'cancelado' and coalesce(old.status,'') <> 'cancelado' then
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
  elsif coalesce(old.status,'') = 'cancelado' and new.status <> 'cancelado' then
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
