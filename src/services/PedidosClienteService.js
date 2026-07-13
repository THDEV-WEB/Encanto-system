/* services/PedidosClienteService.js — REF-CLIENTE-02. Leitura dos pedidos do PROPRIO cliente.
   Usa dbCliente (sessao do cliente): a RLS aplica auth.uid(). ALEM disso filtra SEMPRE por customer_id
   do proprio cliente — nunca confia so na RLS (is_admin enxerga todos os pedidos). SOMENTE LEITURA:
   nao cria/edita pedido; checkout/create_order/DataService de pedidos ficam intocados.
   Camada service: importa so o dbCliente (sem React, sem dominio pricing/addons/format). */
import { dbCliente } from '../lib/dbCliente.js';

const SEL_ITENS = 'id, nome_produto, quantity, preco_unitario, price, adicionais, observacoes, product_id';

export const PedidosClienteService = {
  disponivel: () => !!dbCliente,

  /* Lista os pedidos do proprio cliente (mais recente primeiro) com os itens embutidos. */
  async listar(customerId) {
    if (!dbCliente || !customerId) return [];
    const { data, error } = await dbCliente
      .from('orders')
      .select(`id, total, status, created_at, payment_method, observacoes, order_items(${SEL_ITENS})`)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });
    if (error) { console.warn('[PedidosCliente] listar:', error.message); return []; }
    return data ?? [];
  },

  /* Eventos (timeline) de UM pedido do proprio cliente. */
  async eventos(orderId) {
    if (!dbCliente || !orderId) return [];
    const { data, error } = await dbCliente
      .from('order_events')
      .select('id, tipo, status_anterior, status_novo, created_at')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });
    if (error) { console.warn('[PedidosCliente] eventos:', error.message); return []; }
    return data ?? [];
  },
};
