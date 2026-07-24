-- ============================================================================
-- REF-ADMIN-03 · Onda 3 — Escalabilidade do modulo de Pedidos (camada de banco).
-- ATOMICO (BEGIN/COMMIT). Idempotente (CREATE OR REPLACE / IF NOT EXISTS).
--
-- CAUSA RAIZ (auditoria real do schema de producao, 2026-07-24): `DS.getPedidos()` faz
-- `select('*, customers(name,phone), order_items(*)').order('created_at desc').limit(100)` — SEM
-- paginacao, SEM filtro server-side. Isso ja tem 2 bugs latentes hoje (mascarados so pelo volume
-- atual, 71 pedidos):
--   1) AdminDashboard.jsx computa "Total geral" (orders.length) e o breakdown por status a partir
--      desse MESMO array de no maximo 100 linhas — assim que a loja passar de 100 pedidos HISTORICOS
--      (nao so hoje), esses numeros ficam SILENCIOSAMENTE errados (capados em 100).
--   2) A busca/filtro de Pedidos (REF-ADMIN-02 · Onda 3) roda client-side sobre esse MESMO array de
--      100 — um pedido antigo fora dessa janela nunca aparece na busca, mesmo com telefone exato.
-- Nenhum indice em orders.status (so created_at DESC e customer_id) — um filtro por status hoje
-- exigiria sequential scan.
--
-- SOLUCAO: 2 RPCs SECURITY INVOKER (respeitam a RLS existente automaticamente — "Admin all orders/
-- customers" ja libera tudo para is_admin(), sem precisar reimplementar o check aqui; um chamador
-- nao-admin so veria os proprios pedidos, via a policy "Cliente le proprios orders" — nunca vaza dado
-- alheio mesmo que este RPC seja chamado fora do contexto pretendido):
--   - admin_orders_stats(): agregados do Dashboard (total geral, hoje/faturamento hoje, breakdown por
--     status) calculados em SQL sobre a tabela INTEIRA — nunca capados por um limit() do lado do app.
--   - admin_orders_search(): pagina de Pedidos com busca (cliente/telefone/id/ref) + filtro de status
--     + paginacao por CURSOR (created_at,id) — keyset, nao OFFSET (estavel mesmo com pedidos novos
--     chegando entre paginas; O(log n) via indice, ao contrario de OFFSET que degrada linearmente).
--
-- NAO CRIADO (registro honesto): indice trigram (pg_trgm) em customers.name/phone para o ILIKE da
-- busca — customers cresce por PESSOA unica, nao por PEDIDO; mesmo em "dezenas de milhares" de
-- pedidos, a base de clientes de um unico comercio tende a ficar ordens de grandeza menor, onde um
-- sequential scan em ILIKE continua na casa de poucos ms. Reavaliar se a base de clientes um dia
-- crescer de forma independente (ex.: SaaS multi-loja somando bases).
--
-- Rollback: migrations/REF-ADMIN-03-orders-scale-rollback.sql
BEGIN;

-- Suporta "WHERE status=X ORDER BY created_at DESC" (filtro por status em admin_orders_search) sem
-- sequential scan + sort. orders_created_at_idx (ja existente) continua servindo o caso sem filtro.
CREATE INDEX IF NOT EXISTS orders_status_created_at_idx
  ON public.orders (status, created_at DESC);

-- ── Agregados do Dashboard (Onda 3) — SEM limit, SEM depender do array capado do app. ──
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

-- ── Página de Pedidos com busca+filtro+paginação server-side (Onda 3). ──
-- customers/order_items embutidos no MESMO formato que `.select('*, customers(name,phone),
-- order_items(*))` já produzia (PostgREST embed) — compatibilidade total com comandaModel.js/
-- PedidoNotificacoes.jsx/AdminPedidos.jsx, que leem order.customers?.name/phone e order.order_items,
-- sem precisar mudar nenhum consumidor.
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

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── VERIFICACAO ──────────────────────────────────────────────────────────────────────────────────
-- SELECT indexname FROM pg_indexes WHERE tablename='orders' AND indexname='orders_status_created_at_idx';
-- SELECT admin_orders_stats(); -- como is_admin(): {"total_geral":N,"hoje_count":N,"hoje_total":N,"breakdown":{...}}
-- SELECT * FROM admin_orders_search(null,null,5,null,null); -- 5 mais recentes
-- SELECT * FROM admin_orders_search('11999',null,20,null,null); -- busca por telefone parcial
