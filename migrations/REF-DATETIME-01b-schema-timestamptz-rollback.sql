-- Rollback de REF-DATETIME-01b-schema-timestamptz.sql — devolve as 9 colunas para
-- `timestamp without time zone`, restaura admin_orders_search/admin_orders_stats/orders_health
-- para as versoes anteriores (naive-safe, capturadas ao vivo em 2026-07-27) e remove dia_loja().
-- Lossless: sessao e UTC, entao `col::timestamp` desfaz exatamente `col AT TIME ZONE 'UTC'`.
--
-- Mesma restricao do Postgres na direcao inversa (ALTER COLUMN TYPE recusa rodar enquanto
-- order_logs/order_status_durations dependerem da coluna) — dropa as 2 views antes, recria depois,
-- com a MESMA definicao/security_invoker/grants (ver REF-DATETIME-01b-schema-timestamptz.sql para
-- a analise completa de dependencias). Idempotente.
BEGIN;

-- ── 1) Dropa as 2 views (idempotente) ────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.order_status_durations;
DROP VIEW IF EXISTS public.order_logs;

-- ── 2) orders_health() volta ao estado da Fase 1 (hop duplo, naive-safe) ────────────────────────
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

-- ── 3) admin_orders_stats() volta a original (REF-ADMIN-03) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_orders_stats()
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT jsonb_build_object(
    'total_geral', (SELECT count(*) FROM public.orders),
    'hoje_count', (
      SELECT count(*) FROM public.orders
      WHERE (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date
          = (now() AT TIME ZONE 'America/Sao_Paulo')::date
    ),
    'hoje_total', (
      SELECT coalesce(sum(total), 0) FROM public.orders
      WHERE (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date
          = (now() AT TIME ZONE 'America/Sao_Paulo')::date
    ),
    'breakdown', (
      SELECT coalesce(jsonb_object_agg(s.status, s.cnt), '{}'::jsonb)
      FROM (
        SELECT coalesce(status, 'recebido') AS status, count(*) AS cnt
        FROM public.orders
        GROUP BY coalesce(status, 'recebido')
      ) s
    )
  );
$$;

-- ── 4) admin_orders_search volta a assinatura naive (DROP+CREATE, regrant) ──────────────────────
DROP FUNCTION IF EXISTS public.admin_orders_search(text, text, int, timestamptz, uuid);

CREATE OR REPLACE FUNCTION public.admin_orders_search(
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit int DEFAULT 20,
  p_cursor_created_at timestamp without time zone DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid, customer_id uuid, total numeric, status text, payment_method text,
  address text, created_at timestamp without time zone, observacoes text, request_id uuid,
  customers jsonb, order_items jsonb
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT
    o.id, o.customer_id, o.total, o.status, o.payment_method, o.address, o.created_at,
    o.observacoes, o.request_id,
    CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('name', c.name, 'phone', c.phone) END AS customers,
    coalesce(
      (SELECT jsonb_agg(to_jsonb(oi.*)) FROM public.order_items oi WHERE oi.order_id = o.id),
      '[]'::jsonb
    ) AS order_items
  FROM public.orders o
  LEFT JOIN public.customers c ON c.id = o.customer_id
  WHERE (p_status IS NULL OR o.status = p_status)
    AND (
      p_search IS NULL OR btrim(p_search) = ''
      OR c.name ILIKE '%' || p_search || '%'
      OR c.phone ILIKE '%' || p_search || '%'
      OR replace(o.id::text, '-', '') ILIKE '%' || replace(p_search, '-', '') || '%'
    )
    AND (
      p_cursor_created_at IS NULL
      OR (o.created_at, o.id) < (p_cursor_created_at, p_cursor_id)
    )
  ORDER BY o.created_at DESC, o.id DESC
  LIMIT greatest(1, least(coalesce(p_limit, 20), 100));
$$;

GRANT EXECUTE ON FUNCTION public.admin_orders_search(text, text, int, timestamp without time zone, uuid) TO PUBLIC, anon, authenticated, service_role;

-- ── 5) Remove o helper novo ───────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.dia_loja(timestamptz);

-- ── 6) Schema: timestamptz -> naive (lossless, sessao=UTC), idempotente ─────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'orders', 'order_events', 'customers', 'products', 'categories',
    'addresses', 'adicionais', 'settings', 'application_logs'
  ]
  LOOP
    IF (
      SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'created_at'
    ) IS DISTINCT FROM 'timestamp without time zone' THEN
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN created_at TYPE timestamp without time zone USING created_at::timestamp',
        t
      );
    END IF;
  END LOOP;
END $$;

-- ── 7) Recria as 2 views (definicao identica; security_invoker=true; grants) ────────────────────
CREATE OR REPLACE VIEW public.order_logs
WITH (security_invoker = true)
AS
SELECT id,
    request_id,
    NULLIF(entity_id, ''::text)::uuid AS order_id,
    payload,
    message,
    sqlstate,
    context,
    NULL::text AS detalhe,
    rpc,
    version AS versao,
    origin AS origem,
    duration_ms AS duracao_ms,
    created_at
FROM application_logs
WHERE module = 'orders'::text;

GRANT ALL ON public.order_logs TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.order_status_durations
WITH (security_invoker = true)
AS
SELECT order_id,
    status_novo AS status,
    created_at AS entrou_em,
    lead(created_at) OVER (PARTITION BY order_id ORDER BY created_at) AS saiu_em,
    lead(created_at) OVER (PARTITION BY order_id ORDER BY created_at) - created_at AS duracao
FROM order_events e
WHERE status_novo IS NOT NULL;

GRANT ALL ON public.order_status_durations TO anon, authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
