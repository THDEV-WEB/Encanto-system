/* hooks/useProducts.js — REF-APP-01 · Onda 3 (move puro do App.jsx).
   Hook de catálogo por categoria/busca: cache de sessão (_prodCache) + DS.getProds,
   fallback filterMock offline, telemetria DS.logEvent. Expõe { prods, loading, src }. */
import { useState, useEffect } from 'react';
import { DS } from '../services/DataService.js';
import { filterMock } from '../data/mockCatalog.js';
import { onProductsChanged } from '../services/productCacheBus.js';
import { onStorefrontResolved } from '../services/storefrontResolvedBus.js';

/* Cache em memória — persiste durante a sessão (singleton do módulo, como no App.jsx original) */
const _prodCache = new Map();

/* PRICE-DOMAIN-01: toda escrita de produto no Admin (DataService.upsert/toggle/delProd) limpa
   este cache de sessão, garantindo que a próxima leitura da loja busque dados frescos do
   Supabase — sem depender de F5 nem de nova aba. Inscrição única no load do módulo (singleton). */
onProductsChanged(() => _prodCache.clear());

/* REF-PROD-GOLIVE-01 (fecha CHECKOUT-TENANT-02): se este cache foi populado ANTES da loja resolver
   por domínio, pode ter vindo sem filtro de store_id (catálogo de outra loja ativa junto). Limpa
   assim que a resolução chegar — a próxima leitura (disparada pelo tick no hook abaixo) vem
   corretamente filtrada. */
onStorefrontResolved(() => _prodCache.clear());

export function useProducts(catId, search) {
  const cacheKey = `${catId||'*'}::${search||''}`;

  /* Iniciar com dados do cache (Supabase) ou mock enquanto busca */
  const [prods,   setProds]   = useState(()=> _prodCache.get(cacheKey) || []);
  const [loading, setLoading] = useState(!_prodCache.has(cacheKey));
  const [src,     setSrc]     = useState(_prodCache.has(cacheKey) ? 'cache' : 'mock');
  const [resolvedTick, setResolvedTick] = useState(0);

  /* Força um novo fetch (abaixo, via dep) quando a loja resolver depois deste hook já ter buscado. */
  useEffect(() => onStorefrontResolved(() => setResolvedTick(t => t + 1)), []);

  useEffect(()=>{
    const key = `${catId||'*'}::${search||''}`;

    /* Cache hit: usar imediatamente */
    if (_prodCache.has(key)) {
      setProds(_prodCache.get(key));
      setSrc('cache');
      setLoading(false);
      return;
    }

    /* Sem cache: NÃO exibir mock como placeholder — manter vazio + loading
       até o Supabase responder (evita o flash de produtos do MOCK no refresh). */
    setSrc('mock');

    let live = true;
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
        console.warn('[Encanto] ⚠️ Supabase offline — products usando fallback local');
        DS.logEvent('catalog','getProds','warn','Supabase offline — fallback local de products', { catId: catId||null, has_search: !!search });
      }
      setLoading(false);
    });
    return () => { live = false; };
  }, [catId, search, resolvedTick]);

  return { prods, loading, src };
}
