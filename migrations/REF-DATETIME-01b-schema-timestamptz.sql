-- ============================================================================
-- REF-DATETIME-01 · Fase 2a — Causa raiz: schema misto naive/timestamptz.
-- ATOMICO (BEGIN/COMMIT).
--
-- AUDITORIA (2026-07-27, introspeccao ao vivo de producao): metade das tabelas usava
-- `timestamp without time zone` (naive) e metade `timestamptz` (aware) — divisao historica, nao
-- intencional (tabelas criadas antes da disciplina de migrations versionadas deste projeto
-- ficaram naive; migrations recentes ja nasceram timestamptz). Sessao do banco = UTC (confirmado
-- via current_setting('TIMEZONE')). Toda coluna naive grava o relogio de parede UTC via now(),
-- SEM marcador — cada consumidor (JS, SQL, scripts Node) tinha que adivinhar que era UTC e
-- converter por conta propria. Isso gerou 4 implementacoes independentes da mesma regra de
-- conversao, 2 corretas e 2 quebradas (ver Fase 1 / auditoria completa em
-- docs/adr, memoria do projeto REF-DATETIME-01).
--
-- FIX NA ORIGEM: converte as 9 colunas naive para timestamptz. `col AT TIME ZONE 'UTC'` numa
-- coluna naive reinterpreta o valor como estando em UTC e produz o instante absoluto correto —
-- conversao exata (sem perda), porque a sessao sempre foi UTC. A partir daqui, todo valor sai do
-- Postgres/PostgREST com offset ('Z') e "so funciona" em qualquer camada (JS, SQL, Node) sem
-- gambiarra de deteccao de string.
--
-- Varredura completa das 81 funcoes public (pg_get_functiondef, via posicao de string —
-- ver auditoria): SOMENTE admin_orders_search declara o tipo naive explicitamente (parametro de
-- cursor + coluna de retorno). As views order_status_durations e order_logs nao tem cast
-- explicito — se ajustam sozinhas.
--
-- admin_orders_search muda de ASSINATURA (tipo de parametro + coluna de retorno), entao exige
-- DROP+CREATE (CREATE OR REPLACE nao permite mudar tipo de retorno). DROP+CREATE PERDE grants
-- explicitos — por isso este arquivo reemite exatamente os grants capturados na auditoria
-- (PUBLIC/anon/authenticated; postgres/service_role continuam via ownership/superuser).
--
-- dia_loja(timestamptz): fonte UNICA da regra "que dia e esse instante, no fuso da loja" — usada
-- por admin_orders_stats/orders_health agora, e por qualquer RPC futura que precisar de bucket
-- diario. Substitui o hop duplo (AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo') que a Fase 1
-- usou pra corrigir orders_health() ainda em cima da coluna naive — agora que created_at e um
-- instante de verdade, o hop 'UTC' inicial nao e mais necessario.
--
-- create_order (INSERT em orders) nao precisa mudar: grava via DEFAULT now()/coluna implicita, e
-- now() ja retorna timestamptz — compativel sem cast.
--
-- Rollback: migrations/REF-DATETIME-01b-schema-timestamptz-rollback.sql (lossless: sessao e UTC,
-- entao `col::timestamp` desfaz exatamente `col AT TIME ZONE 'UTC'`).
BEGIN;

-- ── 1) Schema: naive -> timestamptz (9 colunas-base; order_logs e VIEW, se ajusta sozinha) ──────
ALTER TABLE public.orders           ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
ALTER TABLE public.order_events     ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
ALTER TABLE public.customers        ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
ALTER TABLE public.products         ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
ALTER TABLE public.categories       ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
ALTER TABLE public.addresses        ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
ALTER TABLE public.adicionais       ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
ALTER TABLE public.settings         ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
ALTER TABLE public.application_logs ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';

-- ── 2) Fonte unica da regra "dia da loja" ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dia_loja(ts timestamptz)
 RETURNS date
 LANGUAGE sql
 STABLE
AS $function$
  SELECT (ts AT TIME ZONE 'America/Sao_Paulo')::date
$function$;

-- ── 3) admin_orders_search: assinatura muda de tipo -> DROP+CREATE, corpo IDENTICO ──────────────
DROP FUNCTION IF EXISTS public.admin_orders_search(text, text, int, timestamp without time zone, uuid);

CREATE FUNCTION public.admin_orders_search(
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit int DEFAULT 20,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid, customer_id uuid, total numeric, status text, payment_method text,
  address text, created_at timestamptz, observacoes text, request_id uuid,
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

-- Grants perdidos pelo DROP -- reemitidos EXATAMENTE como capturados na auditoria (2026-07-27).
GRANT EXECUTE ON FUNCTION public.admin_orders_search(text, text, int, timestamptz, uuid) TO PUBLIC, anon, authenticated, service_role;

-- ── 4) admin_orders_stats / orders_health: simplifica para dia_loja() (sem hop 'UTC') ───────────
CREATE OR REPLACE FUNCTION public.admin_orders_stats()
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT jsonb_build_object(
    'total_geral', (SELECT count(*) FROM public.orders),
    'hoje_count', (SELECT count(*) FROM public.orders WHERE public.dia_loja(created_at) = public.dia_loja(now())),
    'hoje_total', (SELECT coalesce(sum(total), 0) FROM public.orders WHERE public.dia_loja(created_at) = public.dia_loja(now())),
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

CREATE OR REPLACE FUNCTION public.orders_health()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'pedidos_hoje',      (select count(*) from public.orders where public.dia_loja(created_at) = public.dia_loja(now())),
    'faturamento_hoje',  (select coalesce(sum(total),0) from public.orders where public.dia_loja(created_at) = public.dia_loja(now())),
    'ticket_medio_hoje', (select coalesce(avg(total),0) from public.orders where public.dia_loja(created_at) = public.dia_loja(now())),
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
                            'n',(select count(*) from public.orders o where public.dia_loja(o.created_at) = d::date)) order by d)
                          from generate_series(public.dia_loja(now()) - 6, public.dia_loja(now()), interval '1 day') d),
    'serie_30d',         (select jsonb_agg(jsonb_build_object('dia',to_char(d,'DD/MM'),
                            'n',(select count(*) from public.orders o where public.dia_loja(o.created_at) = d::date)) order by d)
                          from generate_series(public.dia_loja(now()) - 29, public.dia_loja(now()), interval '1 day') d),
    'gerado_em',         now()
  );
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── VERIFICACAO ──────────────────────────────────────────────────────────────────────────────────
-- SELECT table_name, column_name, data_type FROM information_schema.columns
--   WHERE table_schema='public' AND column_name='created_at'
--     AND table_name IN ('orders','order_events','customers','products','categories','addresses','adicionais','settings','application_logs');
--   -- esperado: 'timestamp with time zone' em todas as 9 linhas.
-- SELECT dia_loja('2026-01-15 02:00:00+00'::timestamptz); -- esperado 2026-01-14 (America/Sao_Paulo)
-- SELECT orders_health()->'pedidos_hoje', admin_orders_stats()->'hoje_count'; -- devem bater
-- SELECT grantee, privilege_type FROM information_schema.routine_privileges
--   WHERE routine_schema='public' AND routine_name='admin_orders_search' ORDER BY 1,2;
--   -- esperado: mesmas linhas de antes da migration (PUBLIC/anon/authenticated/service_role/postgres).
-- SELECT * FROM admin_orders_search(null,null,5,null,null); -- pagina normalmente, cursor timestamptz
