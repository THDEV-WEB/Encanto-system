/* hooks/useOrdersStats.js — REF-ADMIN-03 · Onda 3.
   Substitui o antigo useOrders() para o Dashboard (AdminDashboard.jsx). Antes, o Dashboard computava
   "Total geral"/breakdown por status reduzindo um array de no máximo 100 pedidos (useOrders ->
   DS.getPedidos, limit(100) fixo) — correto só enquanto o histórico total coubesse nesses 100 linhas.
   Agora consome 2 fontes independentes: agregados via SQL (DS.getPedidosStats — nunca truncados) +
   os N mais recentes para a tabela "Últimos pedidos" (DS.getPedidosRecentes — não precisa de mais que
   isso, a tabela só mostra N linhas mesmo). Auto-refresh a cada 60s preservado (mesmo intervalo de
   antes, só a fonte dos dados mudou). */
import { useState, useEffect, useCallback } from 'react';
import { DS } from '../services/DataService.js';

export function useOrdersStats(recentes = 10) {
  const [stats,   setStats]   = useState(null);
  const [recentesLista, setRecentesLista] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, r] = await Promise.all([
      DS.getPedidosStats(),
      recentes > 0 ? DS.getPedidosRecentes(recentes) : Promise.resolve([]),
    ]);
    setStats(s);
    setRecentesLista(r);
    setLoading(false);
  }, [recentes]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => load(), 60000);
    return () => clearInterval(t);
  }, [load]);

  return { stats, recentes: recentesLista, loading, refresh: load };
}
