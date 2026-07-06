/* hooks/useOrders.js — REF-APP-01 · Onda 3 (move puro do App.jsx).
   Hook de pedidos do painel admin: carrega via DS.getPedidos; expõe { orders, loading, refresh }. */
import { useState, useEffect, useCallback } from 'react';
import { DS } from '../services/DataService.js';

export function useOrders() {
  const [orders,  setOrders]  = useState([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async()=>{
    setLoading(true);
    const data = await DS.getPedidos();
    setOrders(data);
    setLoading(false);
  },[]);
  useEffect(()=>{ load(); },[load]);
  return { orders, loading, refresh:load };
}
