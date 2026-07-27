-- Rollback de REF-DATETIME-01-orders-health-fix.sql — restaura orders_health() para a definicao
-- anterior (current_date/now() crus, sem conversao de fuso), capturada ao vivo em 2026-07-27
-- via pg_get_functiondef antes desta correcao.

CREATE OR REPLACE FUNCTION public.orders_health()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'pedidos_hoje',      (select count(*) from public.orders where created_at >= current_date and created_at < current_date + 1),
    'faturamento_hoje',  (select coalesce(sum(total),0) from public.orders where created_at >= current_date and created_at < current_date + 1),
    'ticket_medio_hoje', (select coalesce(avg(total),0) from public.orders where created_at >= current_date and created_at < current_date + 1),
    'pedidos_24h',       (select count(*) from public.orders where created_at >= now() - interval '24 hours'),
    'pedidos_7d',        (select count(*) from public.orders where created_at >= now() - interval '7 days'),
    'pedidos_total',     (select count(*) from public.orders),
    'por_status',        (select coalesce(jsonb_object_agg(status, n),'{}'::jsonb) from (select status, count(*) n from public.orders group by status) s),
    'erros_24h',         (select count(*) from public.application_logs where level='error' and created_at >= now() - interval '24 hours'),
    'taxa_erro_pct',     (select case when (p+e)=0 then 0 else round(100.0*e/(p+e),1) end
                          from (select (select count(*) from public.orders where created_at>=now()-interval '24 hours') p,
                                       (select count(*) from public.application_logs where level='error' and created_at>=now()-interval '24 hours') e) x),
    'divergencias',      (select count(*) from public.v_order_reconciliation where abs(diff) > 0.005),
    'logs_total',        (select count(*) from public.application_logs),
    'serie_7d',          (select jsonb_agg(jsonb_build_object('dia',to_char(d,'DD/MM'),
                            'n',(select count(*) from public.orders o where o.created_at>=d and o.created_at<d+interval '1 day')) order by d)
                          from generate_series(current_date - interval '6 days', current_date, interval '1 day') d),
    'serie_30d',         (select jsonb_agg(jsonb_build_object('dia',to_char(d,'DD/MM'),
                            'n',(select count(*) from public.orders o where o.created_at>=d and o.created_at<d+interval '1 day')) order by d)
                          from generate_series(current_date - interval '29 days', current_date, interval '1 day') d),
    'gerado_em',         now()
  );
$function$;
