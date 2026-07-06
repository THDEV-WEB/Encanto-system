/* hooks/useProducts.js — REF-APP-01 · Onda 3 (move puro do App.jsx).
   Hook de catálogo por categoria/busca: cache de sessão (_prodCache) + DS.getProds,
   fallback filterMock offline, telemetria DS.logEvent. Expõe { prods, loading, src }. */
import { useState, useEffect } from 'react';
import { DS } from '../services/DataService.js';
import { filterMock } from '../data/mockCatalog.js';

/* Cache em memória — persiste durante a sessão (singleton do módulo, como no App.jsx original) */
const _prodCache = new Map();

export function useProducts(catId, search) {
  const cacheKey = `${catId||'*'}::${search||''}`;

  /* Iniciar com dados do cache (Supabase) ou mock enquanto busca */
  const [prods,   setProds]   = useState(()=> _prodCache.get(cacheKey) || []);
  const [loading, setLoading] = useState(!_prodCache.has(cacheKey));
  const [src,     setSrc]     = useState(_prodCache.has(cacheKey) ? 'cache' : 'mock');

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
  }, [catId, search]);

  return { prods, loading, src };
}
