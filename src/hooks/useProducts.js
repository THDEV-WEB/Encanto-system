/* hooks/useProducts.js — REF-APP-01 · Onda 3 (move puro do App.jsx). Redesenhado na REF-PERF-03.
   Hook de catálogo por categoria/busca: cache de sessão (_prodCache) + DS.getProds,
   fallback filterMock offline, telemetria DS.logEvent. Expõe { prods, loading, src }. */
import { useState, useEffect } from 'react';
import { DS } from '../services/DataService.js';
import { filterMock } from '../data/mockCatalog.js';
import { onProductsChanged } from '../services/productCacheBus.js';
import { onStorefrontResolved, hasStorefrontSettled, storefrontResolutionSucceeded } from '../services/storefrontResolvedBus.js';

/* Cache em memória — persiste durante a sessão (singleton do módulo, como no App.jsx original) */
const _prodCache = new Map();

/* PRICE-DOMAIN-01: toda escrita de produto no Admin (DataService.upsert/toggle/delProd) limpa
   este cache de sessão, garantindo que a próxima leitura da loja busque dados frescos do
   Supabase — sem depender de F5 nem de nova aba. Inscrição única no load do módulo (singleton). */
onProductsChanged(() => _prodCache.clear());

/* REF-PERF-03: o cache não é mais populado antes da resolução do tenant (o hook agora espera o
   sinal de storefrontResolvedBus antes do 1º fetch — ver useEffect abaixo), então não existe mais
   dado "sem filtro" para purgar quando a loja resolve. O clear-on-resolve que existia aqui
   (REF-PROD-GOLIVE-01) foi removido por ficar sem propósito: nunca mais há uma leitura pré-resolução
   para invalidar. */

export function useProducts(catId, search) {
  const cacheKey = `${catId||'*'}::${search||''}`;

  /* Iniciar com dados do cache (Supabase) ou mock enquanto busca */
  const [prods,   setProds]   = useState(()=> _prodCache.get(cacheKey) || []);
  const [loading, setLoading] = useState(!_prodCache.has(cacheKey));
  const [src,     setSrc]     = useState(_prodCache.has(cacheKey) ? 'cache' : 'mock');

  useEffect(()=>{
    const key = `${catId||'*'}::${search||''}`;

    /* Cache hit: usar imediatamente (já veio de um fetch corretamente filtrado nesta sessão) */
    if (_prodCache.has(key)) {
      setProds(_prodCache.get(key));
      setSrc('cache');
      setLoading(false);
      return;
    }

    let live = true;

    const buscar = () => {
      setLoading(true);
      DS.getProds(catId, search).then(data => {
        if (!live) return;
        if (data !== null) {
          /* data = [] ou [...] — banco respondeu com sucesso */
          _prodCache.set(key, data);
          setProds(data);
          setSrc('supabase');
          if (!catId && !search) {
            console.log(`[Encanto] ✅ ${data.length} products carregados do Supabase`);
            if (data[0]) console.log('[Encanto] Amostra:', data[0].nome, '| imagem_url:', data[0].imagem_url || '(sem imagem)');
          }
        } else {
          /* null = offline/erro — usar fallback local (mock) */
          setProds(filterMock(catId, search));
          setSrc('mock');
          console.warn('[Encanto] ⚠️ Supabase offline — products usando fallback local');
          DS.logEvent('catalog','getProds','warn','Supabase offline — fallback local de products', { catId: catId||null, has_search: !!search });
        }
        setLoading(false);
      });
    };

    /* REF-PERF-03: sem resolução de tenant bem-sucedida, NUNCA busca ao vivo sem filtro (exporia
       catálogo de outras lojas ativas — achado real da auditoria, RLS pública permite qualquer loja
       ativa desde a REF-SAAS-01 · Onda 6.1). Cai direto no MOCK, mesmo fallback do offline real. */
    const usarMock = () => {
      setProds(filterMock(catId, search));
      setSrc('mock');
      setLoading(false);
    };

    /* REF-PERF-03 (fecha o achado da REF-PERF-02/CI-HARDENING-01): antes buscava no mount SEM
       store_id e refazia via resolvedTick quando a loja resolvia (2 fetches sempre, e a 2ª troca
       nunca passava por loading=true — substituía o grid em tela sem nenhuma proteção de CLS). Agora
       espera o tenant resolver (ou falhar/expirar) ANTES do 1º fetch: 1 fetch por sessão, sempre
       corretamente filtrado, sempre coberto pelo CatalogSkeleton (loading=true do início ao fim). */
    if (hasStorefrontSettled()) {
      if (storefrontResolutionSucceeded()) buscar(); else usarMock();
      return () => { live = false; };
    }
    const unsubscribe = onStorefrontResolved((ok) => { if (ok) buscar(); else usarMock(); });
    return () => { live = false; unsubscribe(); };
  }, [catId, search]);

  return { prods, loading, src };
}
