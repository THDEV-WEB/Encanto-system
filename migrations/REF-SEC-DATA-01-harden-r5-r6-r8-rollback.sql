-- ROLLBACK — REF-SEC-DATA-01-harden-r5-r6-r8.sql
-- Restaura exatamente o estado anterior (R5/R6/R8). Nao usar em producao sem motivo forte — o estado
-- original e o proprio achado da auditoria.

BEGIN;

-- Reverte R8 — restaura EXECUTE a anon/PUBLIC nas 5 RPCs.
GRANT EXECUTE ON FUNCTION public.admin_find_loyalty(text, uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_order_endereco(uuid, uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reports_summary(date, date, uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_orders_stats(uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_orders_search(text, text, integer, timestamptz, uuid, uuid) TO PUBLIC, anon;

-- Reverte R6 — trg_customer_audit volta a nao propagar store_id.
CREATE OR REPLACE FUNCTION public.trg_customer_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  insert into public.order_events(order_id,tipo,usuario,payload)
    values(null,'CLIENTE_ATUALIZADO',current_user,
      jsonb_build_object('customer_id',new.id,
        'antes',jsonb_build_object('name',old.name,'phone',old.phone),
        'depois',jsonb_build_object('name',new.name,'phone',new.phone)));
  return null;
end;$function$;

-- Reverte R5 — restaura a policy original (sem filtro de store_id).
DROP POLICY IF EXISTS "application_logs_read_admin" ON public.application_logs;
CREATE POLICY "application_logs_read_auth" ON public.application_logs
  FOR SELECT TO authenticated
  USING (true);

COMMIT;
