-- REF-COMANDA-ENDERECO-01 — Liga a comanda ao endereco estruturado (complemento/referencia)
-- Aditivo, idempotente, reversivel (companion: REF-COMANDA-ENDERECO-01-admin-order-endereco-rollback.sql).
-- SOMENTE LEITURA: nao altera nenhuma tabela, nenhum dado, nenhum caminho de escrita.
--
-- CAUSA RAIZ (auditoria 2026-07-27): desde REF-ADDRESS-02 · Onda 6, orders.endereco_id liga o pedido a
-- um endereco estruturado (addresses: rua/numero/complemento/bairro/cidade/estado/cep/referencia). Mas
-- a RPC que alimenta o painel de Pedidos (admin_orders_search, REF-ADMIN-03) nunca fez esse JOIN — nao
-- expoe endereco_id nem os campos estruturados. A comanda (comandaModel.js) so enxerga o texto livre
-- persistido em orders.address, que NUNCA carrega "referencia" (nenhuma das 3 abas do checkout inclui
-- esse campo no rotulo) e so carrega "complemento" para pedidos entrados pela aba CEP (embutido no
-- proprio texto, de forma inconsistente com as abas de busca/mapa). Resultado: complemento/referencia
-- persistidos, mas nunca chegam a impressao.
--
-- SOLUCAO (minima, isolada): 1 RPC nova, so leitura, SECURITY INVOKER (mesmo padrao de
-- admin_orders_search/admin_orders_stats — respeita a RLS ja existente automaticamente, sem
-- reimplementar nenhum check). Chamada so quando o admin ABRE uma comanda especifica (nao na lista/
-- busca/paginacao inteira) — zero custo extra para quem so navega pedidos sem abrir a comanda.
-- admin_orders_search NAO e tocada nesta migration.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_order_endereco(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT jsonb_build_object(
    'rua', a.rua, 'numero', a.numero, 'complemento', a.complemento, 'bairro', a.bairro,
    'cidade', a.cidade, 'estado', a.estado, 'cep', a.cep, 'referencia', a.referencia
  )
  FROM public.orders o
  JOIN public.addresses a ON a.id = o.endereco_id
  WHERE o.id = p_order_id;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificacao pos-aplicacao (rodar manualmente se aplicar fora do runner administrativo):
-- SELECT proname, prosecdef FROM pg_proc WHERE proname='admin_order_endereco';  -- prosecdef=false (INVOKER)
-- SELECT admin_order_endereco('<uuid de um pedido com endereco_id preenchido>');
