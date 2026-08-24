/* providers/StorefrontProvider.jsx — REF-SAAS-01 · Onda 6.1 (redesenhado na REF-PERF-03).
   Resolve a loja do storefront por DOMINIO (get_store_by_domain(hostname)) e espelha o resultado no
   singleton services/storefrontStore.js (services fora da arvore React leem de la — mesmo padrao do
   AdminStoreProvider/adminStore.js, Onda 5).

   NAO bloqueia o primeiro render da CASCA da pagina (header/layout montam imediatamente, como sempre)
   — mas, desde a REF-PERF-03, os HOOKS DO CATALOGO (useCategories/useProducts/useAdicionais) esperam
   o sinal de storefrontResolvedBus antes do 1o fetch, em vez de buscar sem filtro e refazer depois.
   Motivo da mudanca (achado da auditoria REF-PERF-03): o fetch duplo (sem filtro -> com filtro) fazia
   ate 6 requests de catalogo por carga (3 dominios x 2 ondas) e a 2a troca nunca passava por
   loading=true — substituia o catalogo em tela sem nenhuma protecao de layout (CLS). Resolver o
   tenant ANTES do 1o fetch elimina a onda sem filtro inteira: 1 fetch por dominio, sempre correto,
   sempre coberto pelo skeleton existente.

   get_store_by_domain() SEMPRE devolve exatamente 1 linha em condicoes normais (nunca "nao
   encontrado" — cai no default no proprio banco via COALESCE). `store.status !== 'ativo'` e quem
   decide, no consumidor (StoreApp.jsx), se mostra o catalogo ou uma tela de "loja indisponivel" —
   nunca o catalogo errado sob o dominio errado.

   Timeout/fallback (decisao explicita da REF-PERF-03, nao um valor novo inventado): usa RPC_TIMEOUT
   (lib/supabase.js — mesma constante ja usada com Promise.race em DataService.savePedido/
   addressRepository/gazetteerCorrector), nao um timeout arbitrario desta REF. Em QUALQUER cenario de
   falha (offline, erro da RPC, linha vazia/inesperada, ou timeout) o sinal emitido e' `false` — os
   hooks do catalogo NUNCA fazem fetch ao vivo sem filtro nesse caso (isso exporia o catalogo de
   outras lojas ativas, achado real desta auditoria: a RLS publica permite qualquer loja ativa desde a
   REF-SAAS-01 · Onda 6.1, entao "sem filtro" deixou de ser seguro). Em vez disso caem no MOCK local
   (mesmo fallback ja usado hoje quando `db` esta totalmente offline) — determinístico e seguro, sem
   qualquer janela de dado cross-tenant. Dispara no maximo 1x por sessao. */
import { useEffect, useMemo, useState } from 'react';
import { StorefrontContext } from '../contexts/StorefrontContext.js';
import { db, RPC_TIMEOUT } from '../lib/supabase.js';
import { DS } from '../services/DataService.js';
import { setResolvedStore } from '../services/storefrontStore.js';
import { emitStorefrontResolved } from '../services/storefrontResolvedBus.js';

export function StorefrontProvider({ children }) {
  const [store, setStore] = useState(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      if (!db) { emitStorefrontResolved(false); return; }
      try {
        const { data, error } = await Promise.race([
          db.rpc('get_store_by_domain', { p_hostname: window.location.hostname }),
          new Promise((res) => setTimeout(() => res({ data: null, error: { message: 'timeout' } }), RPC_TIMEOUT)),
        ]);
        if (cancelado) return;
        const linha = !error && (Array.isArray(data) ? data[0] : data);
        if (!linha) { emitStorefrontResolved(false); return; }
        setResolvedStore(linha);
        setStore(linha);
        DS._invalidateProductsCache();
        emitStorefrontResolved(true);
      } catch { if (!cancelado) emitStorefrontResolved(false); }
    })();
    return () => { cancelado = true; };
  }, []);

  const value = useMemo(() => ({ store }), [store]);
  return <StorefrontContext.Provider value={value}>{children}</StorefrontContext.Provider>;
}
