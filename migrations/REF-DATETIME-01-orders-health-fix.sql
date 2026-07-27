-- REF-DATETIME-01 · Fase 1 — fix isolado de orders_health() (painel "Saude do Sistema").
--
-- BUG: pedidos_hoje/faturamento_hoje/ticket_medio_hoje/serie_7d/serie_30d comparavam
-- orders.created_at (hoje `timestamp without time zone`, gravado por now() sob sessao UTC —
-- guarda hora UTC sem marcador) contra `current_date`/`now()` CRUS, que tambem avaliam na
-- sessao (UTC). Isso corta o dia na fronteira UTC (21h America/Sao_Paulo), nao a meia-noite
-- da loja: todo pedido feito entre 21h-22h (fechamento) era contado no dia seguinte.
-- admin_orders_stats() (Dashboard) ja faz a conversao certa desde REF-ADMIN-03; aqui aplicamos
-- o MESMO padrao em orders_health() (paridade entre os dois paineis).
--
-- pedidos_24h/pedidos_7d/erros_24h/taxa_erro_pct NAO mudam: sao janelas rolantes (now() -
-- interval), sem fronteira de dia-calendario — ja corretas hoje, independente de fuso.
--
-- Fase 2 (REF-DATETIME-01b) vai suceder esta funcao de novo, simplificando a comparacao
-- (dia_loja()) depois que created_at virar timestamptz de verdade.

CREATE OR REPLACE FUNCTION public.orders_health()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'pedidos_hoje',      (select count(*) from public.orders
                          where (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date
                              = (now() AT TIME ZONE 'America/Sao_Paulo')::date),
    'faturamento_hoje',  (select coalesce(sum(total),0) from public.orders
                          where (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date
                              = (now() AT TIME ZONE 'America/Sao_Paulo')::date),
    'ticket_medio_hoje', (select coalesce(avg(total),0) from public.orders
                          where (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date
                              = (now() AT TIME ZONE 'America/Sao_Paulo')::date),
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
                            'n',(select count(*) from public.orders o
                                 where (o.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date = d)) order by d)
                          from generate_series(
                                 (now() AT TIME ZONE 'America/Sao_Paulo')::date - interval '6 days',
                                 (now() AT TIME ZONE 'America/Sao_Paulo')::date,
                                 interval '1 day') d),
    'serie_30d',         (select jsonb_agg(jsonb_build_object('dia',to_char(d,'DD/MM'),
                            'n',(select count(*) from public.orders o
                                 where (o.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date = d)) order by d)
                          from generate_series(
                                 (now() AT TIME ZONE 'America/Sao_Paulo')::date - interval '29 days',
                                 (now() AT TIME ZONE 'America/Sao_Paulo')::date,
                                 interval '1 day') d),
    'gerado_em',         now()
  );
$function$;

-- Verificacao pos-apply (SELECT puro, sem gravar nada):
--   SELECT orders_health()->'pedidos_hoje', admin_orders_stats()->'hoje_count';  -- devem bater
