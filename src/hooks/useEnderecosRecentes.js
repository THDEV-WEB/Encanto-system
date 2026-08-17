/* hooks/useEnderecosRecentes.js — REF-ADDRESS-UX-01. Carrega os endereços recentes do PRÓPRIO cliente
   autenticado. Mesmo molde de useMeusPedidos.js: vínculo SEGURO via customer.id do AuthProvider
   (derivado de auth_user_id, nunca telefone/nome). Convidado (não logado) nunca busca — recentes fica
   sempre [] (Fase 8 do pedido: convidado não ganha histórico persistente). Carrega 1 vez ao montar
   (abrir o seletor de endereço), nunca por tecla digitada (Fase 11: performance). */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth.js';
import { AddressClienteService } from '../services/AddressClienteService.js';

export function useEnderecosRecentes() {
  const { isLogged, customer } = useAuth();
  const customerId = customer?.id ?? null;
  const [recentes, setRecentes] = useState([]);
  const [loading, setLoading] = useState(false);

  const carregar = useCallback(async () => {
    if (!isLogged || !customerId) { setRecentes([]); return; }
    setLoading(true);
    try {
      setRecentes(await AddressClienteService.recentes(customerId));
    } finally {
      setLoading(false);
    }
  }, [isLogged, customerId]);

  useEffect(() => { carregar(); }, [carregar]);

  return { recentes, loading, temHistorico: recentes.length > 0 };
}
