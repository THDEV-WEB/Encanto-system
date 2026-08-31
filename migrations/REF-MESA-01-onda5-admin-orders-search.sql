-- ============================================================================
-- REF-MESA-01 · Onda 5 · Parte 1 — admin_orders_search devolve tipo_pedido/
-- origem_pedido/mesa_identificador
-- ----------------------------------------------------------------------------
-- Pré-requisito pra eliminar a inferência por regex no Admin (comandaModel.js::
-- tipoDoPedido, badge de AdminPedidos.jsx): admin_orders_search() (RPC usada por
-- useOrdersPagina/AdminPedidos.jsx) ainda não devolvia as 3 colunas estruturadas
-- que existem em orders desde a Onda 1. Nem useOrdersPagina.js nem
-- DS.getPedidosPagina fazem qualquer whitelist/transformação do resultado —
-- adicionar as colunas aqui já é suficiente para elas chegarem em `order.*` no
-- frontend, sem nenhuma mudança de código JS de leitura.
--
-- Só ADICIONA colunas ao retorno — nenhuma mudança de lógica de busca/filtro/
-- paginação/autorização. Idempotente (CREATE OR REPLACE).
-- ============================================================================

BEGIN;

-- Adicionar colunas ao RETURNS TABLE muda o tipo de retorno -- CREATE OR REPLACE sozinho falha
-- ("cannot change return type of existing function"). Precisa dropar antes.
DROP FUNCTION IF EXISTS public.admin_orders_search(text, text, integer, timestamp with time zone, uuid, uuid);

CREATE OR REPLACE FUNCTION public.admin_orders_search(p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_store_id uuid DEFAULT default_store_id())
 RETURNS TABLE(id uuid, customer_id uuid, total numeric, status text, payment_method text, address text, created_at timestamp with time zone, observacoes text, request_id uuid, delivery_fee numeric, maquininha_fee numeric, tipo_pedido text, origem_pedido text, mesa_identificador text, customers jsonb, order_items jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RAISE EXCEPTION 'apenas administradores desta loja podem buscar pedidos' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    o.id, o.customer_id, o.total, o.status, o.payment_method, o.address, o.created_at,
    o.observacoes, o.request_id, o.delivery_fee, o.maquininha_fee,
    o.tipo_pedido, o.origem_pedido, o.mesa_identificador,
    CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('name', c.name, 'phone', c.phone) END AS customers,
    coalesce(
      (SELECT jsonb_agg(to_jsonb(oi.*)) FROM public.order_items oi WHERE oi.order_id = o.id),
      '[]'::jsonb
    ) AS order_items
  FROM public.orders o
  LEFT JOIN public.customers c ON c.id = o.customer_id
  WHERE o.store_id = p_store_id
    AND (p_status IS NULL OR o.status = p_status)
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
END;
$function$;

-- DROP FUNCTION apaga grants -- restaura exatamente o que existia antes (PUBLIC, que ja cobre
-- anon/authenticated/service_role; a autorizacao de verdade e' o is_admin_of() dentro do corpo).
GRANT EXECUTE ON FUNCTION public.admin_orders_search(text, text, integer, timestamp with time zone, uuid, uuid) TO PUBLIC;

NOTIFY pgrst, 'reload schema';

COMMIT;
