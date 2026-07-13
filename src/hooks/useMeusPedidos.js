/* hooks/useMeusPedidos.js — REF-CLIENTE-02. Carrega os pedidos do PROPRIO cliente autenticado.
   Vinculo SEGURO: usa customer.id do AuthProvider (derivado de auth_user_id) — nunca nome/telefone.
   So busca quando logado E com cadastro (customer) vinculado. */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth.js';
import { PedidosClienteService } from '../services/PedidosClienteService.js';

export function useMeusPedidos() {
  const { isLogged, customer } = useAuth();
  const customerId = customer?.id ?? null;
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    if (!isLogged || !customerId) { setPedidos([]); return; }
    setLoading(true); setErro('');
    try {
      setPedidos(await PedidosClienteService.listar(customerId));
    } catch {
      setErro('Não foi possível carregar seus pedidos.');
    } finally {
      setLoading(false);
    }
  }, [isLogged, customerId]);

  useEffect(() => { carregar(); }, [carregar]);

  return { pedidos, loading, erro, refresh: carregar, temCadastro: !!customerId };
}
