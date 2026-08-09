-- REF-SAAS-01 · Onda 5 — Admin multi-loja: backend (seletor de loja na sessao do Admin).
-- Escopo desta migration: (1) nova RPC list_my_stores() -- nao existia NENHUMA forma do client
-- descobrir "quais lojas este usuario administra"; (2) admin_orders_search/admin_orders_stats/
-- admin_order_endereco ganham p_store_id explicito -- hoje escopam SO via RLS (union de todas as
-- lojas que o admin administra), o que significa que trocar de loja no seletor do frontend nao
-- mudaria o que aparece em Pedidos/Dashboard sem esta correcao.
-- IMPORTANTE (princípio central desta onda, ADR §5/§10.1): p_store_id e so CONTEXTO -- a autorizacao
-- de verdade continua sendo a RLS ("Admin all orders" USING is_admin_of(store_id)) por baixo de cada
-- consulta. Um admin que passe um p_store_id de uma loja que nao administra nao ve NADA daquela loja
-- (RLS filtra pra zero linhas), nao importa o que a UI mandou -- provado no script de teste.
-- Ver docs/adr/REF-SAAS-01-fundacao-multitenant.md §5/§10.1 e docs/ref/REF-SAAS-01-plano-ondas.md
-- (secao "Onda 5") para a auditoria e o racional completos.
-- Achado de auditoria (nenhuma das 3 RPCs abaixo tem hoje reforco de ACL tipo o de create_order --
-- confirmado por introspeccao antes desta migration, licao permanente desde o fechamento da Onda 4):
-- seguro fazer DROP FUNCTION + CREATE sem precisar restaurar nenhum REVOKE depois.

BEGIN;

-- ===== 1. list_my_stores(): unica forma hoje do client saber quais lojas o usuario logado administra.
-- Super admin ve TODAS as lojas (qualquer status -- suporte/operacao, ADR §1.3); admin de loja ve so
-- as que tem linha em admins. Quem nao e nem uma coisa nem outra recebe zero linhas. =====
CREATE OR REPLACE FUNCTION public.list_my_stores()
 RETURNS TABLE(store_id uuid, slug text, nome text, status text, is_super_admin boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT s.id, s.slug, s.nome, s.status, public.is_super_admin()
  FROM public.stores s
  WHERE public.is_super_admin()
     OR EXISTS (SELECT 1 FROM public.admins a WHERE a.store_id = s.id AND a.user_id = auth.uid())
  ORDER BY s.nome;
$function$;

-- ===== 2. admin_orders_search: ganha p_store_id explicito. ACHADO REAL durante a validacao (nao
-- hipotetico): estas 3 funcoes NUNCA foram SECURITY DEFINER -- rodam sob TODA a RLS do chamador, o que
-- inclui NAO SO "Admin all orders" (is_admin_of) MAS TAMBEM "Cliente le proprios orders" (autoatendimento
-- do cliente, OR'd por design do Postgres). Um admin que TAMBEM seja cliente em alguma loja (pessoa real
-- com duplo papel) veria os PROPRIOS pedidos de cliente vazarem pra dentro da visao de admin,
-- independente do p_store_id pedido -- provado no script de teste com uma persona real que e admin
-- ficticio de uma loja E cliente de verdade da Encanto. Corrigido tornando as 3 funcoes SECURITY
-- DEFINER com checagem EXPLICITA de is_admin_of(p_store_id) logo no topo (mesmo padrao de
-- orders_health, Onda 4.1) -- isso REMOVE a exposicao a qualquer policy de orders, inclusive a de
-- autoatendimento do cliente. A autorizacao passa a ser 100% a checagem explicita da funcao, nao mais
-- "o que a RLS da tabela deixar passar por acidente".
DROP FUNCTION IF EXISTS public.admin_orders_search(text, text, integer, timestamp with time zone, uuid);

CREATE OR REPLACE FUNCTION public.admin_orders_search(p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_store_id uuid DEFAULT public.default_store_id())
 RETURNS TABLE(id uuid, customer_id uuid, total numeric, status text, payment_method text, address text, created_at timestamp with time zone, observacoes text, request_id uuid, delivery_fee numeric, maquininha_fee numeric, customers jsonb, order_items jsonb)
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

-- ===== 3. admin_orders_stats: mesma correcao (SECURITY DEFINER + is_admin_of explicito) =====
DROP FUNCTION IF EXISTS public.admin_orders_stats();

CREATE OR REPLACE FUNCTION public.admin_orders_stats(p_store_id uuid DEFAULT public.default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RAISE EXCEPTION 'apenas administradores desta loja podem ver as estatisticas' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'total_geral', (SELECT count(*) FROM public.orders WHERE store_id = p_store_id),
    'hoje_count', (SELECT count(*) FROM public.orders WHERE store_id = p_store_id AND public.dia_loja(created_at) = public.dia_loja(now())),
    'hoje_total', (SELECT coalesce(sum(total), 0) FROM public.orders WHERE store_id = p_store_id AND public.dia_loja(created_at) = public.dia_loja(now())),
    'breakdown', (
      SELECT coalesce(jsonb_object_agg(s.status, s.cnt), '{}'::jsonb)
      FROM (
        SELECT coalesce(status, 'recebido') AS status, count(*) AS cnt
        FROM public.orders
        WHERE store_id = p_store_id
        GROUP BY coalesce(status, 'recebido')
      ) s
    )
  );
END;
$function$;

-- ===== 4. admin_order_endereco: mesma correcao =====
DROP FUNCTION IF EXISTS public.admin_order_endereco(uuid);

CREATE OR REPLACE FUNCTION public.admin_order_endereco(p_order_id uuid, p_store_id uuid DEFAULT public.default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RAISE EXCEPTION 'apenas administradores desta loja podem ver o endereco do pedido' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'rua', a.rua, 'numero', a.numero, 'complemento', a.complemento, 'bairro', a.bairro,
      'cidade', a.cidade, 'estado', a.estado, 'cep', a.cep, 'referencia', a.referencia
    )
    FROM public.orders o
    JOIN public.addresses a ON a.id = o.endereco_id
    WHERE o.id = p_order_id AND o.store_id = p_store_id
  );
END;
$function$;

COMMIT;
