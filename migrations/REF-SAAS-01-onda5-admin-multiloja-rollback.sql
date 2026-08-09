-- REF-SAAS-01 · Onda 5 — Rollback backend: restaura admin_orders_search/admin_orders_stats/
-- admin_order_endereco as assinaturas/corpos originais (sem p_store_id), remove list_my_stores().

BEGIN;

DROP FUNCTION IF EXISTS public.admin_order_endereco(uuid, uuid);

CREATE OR REPLACE FUNCTION public.admin_order_endereco(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  SELECT jsonb_build_object(
    'rua', a.rua, 'numero', a.numero, 'complemento', a.complemento, 'bairro', a.bairro,
    'cidade', a.cidade, 'estado', a.estado, 'cep', a.cep, 'referencia', a.referencia
  )
  FROM public.orders o
  JOIN public.addresses a ON a.id = o.endereco_id
  WHERE o.id = p_order_id;
$function$;

DROP FUNCTION IF EXISTS public.admin_orders_stats(uuid);

CREATE OR REPLACE FUNCTION public.admin_orders_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
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
$function$;

DROP FUNCTION IF EXISTS public.admin_orders_search(text, text, integer, timestamp with time zone, uuid, uuid);

CREATE OR REPLACE FUNCTION public.admin_orders_search(p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, customer_id uuid, total numeric, status text, payment_method text, address text, created_at timestamp with time zone, observacoes text, request_id uuid, delivery_fee numeric, maquininha_fee numeric, customers jsonb, order_items jsonb)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    o.id, o.customer_id, o.total, o.status, o.payment_method, o.address, o.created_at,
    o.observacoes, o.request_id, o.delivery_fee, o.maquininha_fee,
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
$function$;

DROP FUNCTION IF EXISTS public.list_my_stores();

COMMIT;
