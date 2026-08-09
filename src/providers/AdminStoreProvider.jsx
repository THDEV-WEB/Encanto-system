/* providers/AdminStoreProvider.jsx — REF-SAAS-01 · Onda 5: loja ativa da sessao do Admin multi-loja.
   No mount, busca (via list_my_stores(), SECURITY DEFINER) quais lojas o admin logado administra —
   super admin ve todas; admin de loja ve so as suas. Resolve a loja ativa inicial (escolha persistida
   em localStorage, se ainda valida; senao a 1a/unica) e a espelha no singleton services/adminStore.js
   (para os services fora da arvore React lerem). Bloqueia a renderizacao dos filhos ate resolver —
   garante que nenhum componente do Admin monte com getActiveStoreId()===null (o que sobrescreveria o
   DEFAULT default_store_id() das RPCs com um p_store_id nulo explicito, por engano).

   PRINCIPIO CENTRAL DA ONDA 5: isto e so CONTEXTO OPERACIONAL. A troca de loja aqui NUNCA concede
   acesso a nada — cada RPC revalida is_admin_of(store_id) no servidor, sempre. Se list_my_stores()
   devolver 0 lojas (usuario autenticado mas sem nenhum vinculo administrativo), este Provider so
   reflete isso (stores=[]) — o gate real de "isto pode nem entrar no Admin" e o is_admin() de
   AdminLogin.jsx, que ja roda ANTES deste Provider montar. */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { AdminStoreContext } from '../contexts/AdminStoreContext.js';
import { db } from '../lib/supabase.js';
import { getActiveStoreId, setActiveStoreId, lerActiveStoreIdPersistido } from '../services/adminStore.js';

export function AdminStoreProvider({ children }) {
  const [stores, setStores] = useState([]);
  const [activeStoreId, setActiveStoreIdState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data, error } = await db.rpc('list_my_stores');
      if (!vivo) return;
      if (error) { setErro(error.message); setStores([]); setLoading(false); return; }
      const lista = data || [];
      setStores(lista);
      const persistida = lerActiveStoreIdPersistido();
      const inicial = lista.find(s => s.store_id === persistida)?.store_id ?? lista[0]?.store_id ?? null;
      setActiveStoreId(inicial); // singleton (services fora da arvore React)
      setActiveStoreIdState(inicial); // estado React (re-renderiza a UI)
      setLoading(false);
    })();
    return () => { vivo = false; };
  }, []);

  const switchStore = useCallback((novoId) => {
    setStores((atual) => {
      if (!atual.some(s => s.store_id === novoId)) return atual; // ignora id que nao esta na lista
      setActiveStoreId(novoId);
      setActiveStoreIdState(novoId);
      return atual;
    });
  }, []);

  const isSuperAdmin = stores.some(s => s.is_super_admin);

  const value = useMemo(() => ({
    stores, activeStoreId, isSuperAdmin, switchStore, loading, erro,
  }), [stores, activeStoreId, isSuperAdmin, switchStore, loading, erro]);

  if (loading) return null; // AdminApp ja mostra o shell/spinner de login; evita flash de conteudo sem loja resolvida

  return <AdminStoreContext.Provider value={value}>{children}</AdminStoreContext.Provider>;
}
