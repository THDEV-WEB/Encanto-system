/* providers/StorefrontProvider.jsx — REF-SAAS-01 · Onda 6.1.
   Resolve a loja do storefront por DOMINIO (get_store_by_domain(hostname)) e espelha o resultado no
   singleton services/storefrontStore.js (services fora da arvore React leem de la — mesmo padrao do
   AdminStoreProvider/adminStore.js, Onda 5).

   NAO bloqueia o primeiro render (ao contrario do AdminStoreProvider): os filhos montam imediatamente
   com o comportamento de sempre (singleton vazio -> RPCs caem no proprio DEFAULT default_store_id()),
   e so re-renderizam quando get_store_by_domain resolver. Decisao deliberada — REF-PERF-01 investiu
   tempo real em performance de boot, e pra Encanto (unico dominio real hoje) a resolucao assincrona
   SEMPRE confirma o mesmo valor que o fallback ja assumia, entao nao ha flash visivel na pratica.

   get_store_by_domain() SEMPRE devolve exatamente 1 linha (nunca "nao encontrado" — cai no default no
   proprio banco). `store.status !== 'ativo'` e quem decide, no consumidor (StoreApp.jsx), se mostra o
   catalogo ou uma tela de "loja indisponivel" — nunca o catalogo errado sob o dominio errado. */
import { useEffect, useMemo, useState } from 'react';
import { StorefrontContext } from '../contexts/StorefrontContext.js';
import { db } from '../lib/supabase.js';
import { setResolvedStore } from '../services/storefrontStore.js';

export function StorefrontProvider({ children }) {
  const [store, setStore] = useState(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      if (!db) return;
      try {
        const { data, error } = await db.rpc('get_store_by_domain', { p_hostname: window.location.hostname });
        if (cancelado || error) return;
        const linha = Array.isArray(data) ? data[0] : data;
        if (!linha) return;
        setResolvedStore(linha);
        setStore(linha);
      } catch { /* mantem o fallback (singleton vazio -> DEFAULT no servidor) */ }
    })();
    return () => { cancelado = true; };
  }, []);

  const value = useMemo(() => ({ store }), [store]);
  return <StorefrontContext.Provider value={value}>{children}</StorefrontContext.Provider>;
}
