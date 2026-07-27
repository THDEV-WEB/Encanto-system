-- ============================================================================
-- REF-DATETIME-01 · Fase 2a — Causa raiz: schema misto naive/timestamptz.
-- ATOMICO (BEGIN/COMMIT) e IDEMPOTENTE (seguro rodar 2x, ou retomar apos falha parcial).
--
-- AUDITORIA (2026-07-27, introspeccao ao vivo de producao): metade das tabelas usava
-- `timestamp without time zone` (naive) e metade `timestamptz` (aware) — divisao historica, nao
-- intencional (tabelas criadas antes da disciplina de migrations versionadas deste projeto
-- ficaram naive; migrations recentes ja nasceram timestamptz). Sessao do banco = UTC (confirmado
-- via current_setting('TIMEZONE')). Toda coluna naive grava o relogio de parede UTC via now(),
-- SEM marcador — cada consumidor (JS, SQL, scripts Node) tinha que adivinhar que era UTC e
-- converter por conta propria. Isso gerou 4 implementacoes independentes da mesma regra de
-- conversao, 2 corretas e 2 quebradas (ver Fase 1 / auditoria completa na memoria do projeto
-- REF-DATETIME-01).
--
-- FIX NA ORIGEM: converte as 9 colunas naive para timestamptz. `col AT TIME ZONE 'UTC'` numa
-- coluna naive reinterpreta o valor como estando em UTC e produz o instante absoluto correto —
-- conversao exata (sem perda), porque a sessao sempre foi UTC. A partir daqui, todo valor sai do
-- Postgres/PostgREST com offset ('Z') e "so funciona" em qualquer camada (JS, SQL, Node) sem
-- gambiarra de deteccao de string.
--
-- ── TENTATIVA ANTERIOR FALHOU (2026-07-27) ──────────────────────────────────────────────────────
-- ERROR 0A000: cannot alter type of a column used by a view or rule
-- DETAIL: rule _RETURN on view order_status_durations depends on column "created_at"
-- A transacao (BEGIN/COMMIT explicito) foi revertida INTEIRA pelo Postgres — nenhuma coluna
-- chegou a mudar, nenhuma limpeza manual foi necessaria (verificado ao vivo apos o erro).
--
-- ── VARREDURA COMPLETA DE DEPENDENCIAS (nova, via pg_depend/pg_rewrite/pg_rules/pg_indexes/
--    pg_policies — nao so a view que apareceu no erro) ────────────────────────────────────────
-- Views/rules que dependem de alguma das 9 colunas (pg_depend + pg_rewrite; pg_rules nao lista a
-- rule _RETURN interna de view, por isso o join direto):
--   - public.order_logs             depende de application_logs.created_at
--   - public.order_status_durations depende de order_events.created_at
--   (v_order_reconciliation existe mas NAO referencia created_at — confirmado, sem tratamento)
--   Nenhuma OUTRA view/materialized view/rule custom depende de nenhuma das 9 colunas.
--   Nada depende de order_logs/order_status_durations por sua vez (folhas, seguro dropar).
-- Ambas as views tem reloption security_invoker=true — CRITICO: e o que faz a view respeitar a
--   RLS da tabela-base com o papel de quem CONSULTA (nao do dono postgres). Perder isso na
--   recriacao seria uma regressao de seguranca (vazaria order_events/application_logs de outros
--   clientes). Reproduzido explicitamente no CREATE abaixo.
-- Grants (information_schema.table_privileges) em ambas: ALL para anon/authenticated/postgres/
--   service_role (padrao de default privileges do projeto) — reemitidos explicitamente apos
--   recriar (DROP+CREATE perde ACL previo, igual a funcoes).
-- Indices (pg_indexes) tocando created_at: orders_created_at_idx, orders_status_created_at_idx,
--   application_logs_created_at_idx, application_logs_module_created_idx — todos indices normais
--   de coluna (sem expressao/cast). NAO bloqueiam ALTER COLUMN TYPE; o Postgres os reconstroi
--   sozinho como parte da propria ALTER (nenhuma acao manual necessaria).
-- Policies (pg_policies) com created_at em USING/WITH CHECK: nenhuma.
-- Funcoes com o tipo naive explicito na assinatura/corpo (varredura das 81 funcoes public via
--   pg_get_functiondef): SOMENTE admin_orders_search (ja tratada no Passo 4).
--
-- Rollback: migrations/REF-DATETIME-01b-schema-timestamptz-rollback.sql (mesma logica: dropa as
-- 2 views antes de reverter o tipo, recria depois — lossless, sessao e UTC).
BEGIN;

-- ── Passo 1) Dropa as 2 views que dependem das colunas a migrar ─────────────────────────────────
-- (IF EXISTS = idempotente; nada mais depende delas, DROP simples sem CASCADE)
DROP VIEW IF EXISTS public.order_status_durations;
DROP VIEW IF EXISTS public.order_logs;

-- ── Passo 2) Schema: naive -> timestamptz nas 9 colunas-base (order_logs e VIEW, ja tratada acima) ──
-- Loop idempotente: cada tabela so e alterada se AINDA nao for timestamptz (seguro re-rodar a
-- migration inteira sobre um banco onde parte disto ja tenha sido aplicada).
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
    ) IS DISTINCT FROM 'timestamp with time zone' THEN
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE ''UTC''',
        t
      );
    END IF;
  END LOOP;
END $$;

-- ── Passo 3) Recria as 2 views — definicao IDENTICA (pg_get_viewdef capturado ao vivo antes do
--    drop), + security_invoker=true (preserva RLS), + grants (preserva ACL) ─────────────────────
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

-- ── Passo 4) Fonte unica da regra "dia da loja" ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dia_loja(ts timestamptz)
 RETURNS date
 LANGUAGE sql
 STABLE
AS $function$
  SELECT (ts AT TIME ZONE 'America/Sao_Paulo')::date
$function$;

-- ── Passo 5) admin_orders_search: assinatura muda de tipo -> DROP (idempotente, IF EXISTS na
--    assinatura naive) + CREATE OR REPLACE (idempotente numa 2a execucao, onde a assinatura ja
--    seria a timestamptz) ─────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_orders_search(text, text, int, timestamp without time zone, uuid);

CREATE OR REPLACE FUNCTION public.admin_orders_search(
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

-- Grants: explicitos sempre (1a execucao: DROP acima apagou o ACL antigo, precisa reemitir;
-- 2a execucao: CREATE OR REPLACE preserva ACL, re-grant aqui e so um no-op idempotente).
GRANT EXECUTE ON FUNCTION public.admin_orders_search(text, text, int, timestamptz, uuid) TO PUBLIC, anon, authenticated, service_role;

-- ── Passo 6) admin_orders_stats / orders_health: simplifica para dia_loja() (sem hop 'UTC') ─────
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
-- SELECT relname, reloptions FROM pg_class WHERE relnamespace='public'::regnamespace
--   AND relname IN ('order_logs','order_status_durations');
--   -- esperado: reloptions = {security_invoker=true} nas 2 linhas.
-- SELECT dia_loja('2026-01-15 02:00:00+00'::timestamptz); -- esperado 2026-01-14 (America/Sao_Paulo)
-- SELECT orders_health()->'pedidos_hoje', admin_orders_stats()->'hoje_count'; -- devem bater
-- SELECT grantee, privilege_type FROM information_schema.routine_privileges
--   WHERE routine_schema='public' AND routine_name='admin_orders_search' ORDER BY 1,2;
--   -- esperado: mesmas linhas de antes da migration (PUBLIC/anon/authenticated/service_role/postgres).
-- SELECT * FROM admin_orders_search(null,null,5,null,null); -- pagina normalmente, cursor timestamptz
-- SELECT * FROM order_status_durations LIMIT 5; SELECT * FROM order_logs LIMIT 5; -- views vivas
