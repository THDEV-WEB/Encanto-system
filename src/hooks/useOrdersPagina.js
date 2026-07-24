/* hooks/useOrdersPagina.js — REF-ADMIN-03 · Onda 3.
   Quadro operacional de Pedidos (AdminPedidos.jsx): busca/filtro/paginação totalmente SERVER-SIDE via
   DS.getPedidosPagina (RPC admin_orders_search) — substitui o antigo useOrders() + filtro client-side
   (REF-ADMIN-02 · Onda 3), que só enxergava os 100 pedidos mais recentes já carregados. Agora a busca
   alcança o histórico INTEIRO, não só a 1ª página.
   Paginação por CURSOR (created_at,id do último pedido da página), não OFFSET — estável mesmo com
   pedidos novos chegando entre "Carregar mais" cliques. Busca debounced (evita 1 request por tecla).

   GUARDA CONTRA RESPOSTA FORA DE ORDEM (achado ao rodar a suíte inteira, não só a pasta admin: mudar
   o filtro de status logo após o mount dispara 2 requests — o inicial sem filtro + o novo filtrado —
   e não há garantia de que a rede resolva na mesma ordem em que foram disparados; se a 1ª (sem filtro)
   responder DEPOIS da 2ª, ela sobrescrevia o resultado filtrado com a lista inteira). `requestIdRef`
   descarta qualquer resposta que não seja mais a da chamada MAIS RECENTE. */
import { useState, useEffect, useCallback, useRef } from 'react';
import { DS } from '../services/DataService.js';

const DEBOUNCE_BUSCA_MS = 300;

export function useOrdersPagina({ busca = '', status = 'todos', limit = 20 } = {}) {
  const [buscaDebounced, setBuscaDebounced] = useState(busca);
  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(busca), DEBOUNCE_BUSCA_MS);
    return () => clearTimeout(t);
  }, [busca]);

  const [orders,  setOrders]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [temMais, setTemMais] = useState(false);
  const cursorRef = useRef(null);
  const requestIdRef = useRef(0);

  const carregar = useCallback(async (reset) => {
    const meuId = ++requestIdRef.current;
    setLoading(true);
    const cursor = reset ? null : cursorRef.current;
    const pagina = await DS.getPedidosPagina({ busca: buscaDebounced, status, limit, cursor });
    if (meuId !== requestIdRef.current) return; // resposta obsoleta — uma chamada mais nova já assumiu
    setOrders((atual) => (reset ? pagina.orders : [...atual, ...pagina.orders]));
    cursorRef.current = pagina.cursor;
    setTemMais(!!pagina.cursor);
    setLoading(false);
  }, [buscaDebounced, status, limit]);

  useEffect(() => { carregar(true); }, [carregar]);

  const carregarMais = useCallback(() => carregar(false), [carregar]);
  const refresh = useCallback(() => carregar(true), [carregar]);

  return { orders, loading, temMais, carregarMais, refresh };
}
