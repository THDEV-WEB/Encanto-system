/* hooks/useCategories.js — REF-APP-01 · Onda 3 (move puro do App.jsx).
   Hook de categorias: carrega via DS.getCats, filtra descontinuadas, fallback MOCK_CATS. */
import { useState, useEffect, useCallback } from 'react';
import { DS } from '../services/DataService.js';
import { MOCK_CATS } from '../data/mockCatalog.js';
import { isCategoriaDescontinuada } from '../utils/catalog.js';

export function useCategories() {
  const [cats,    setCats]    = useState([]);
  const [src,     setSrc]     = useState('mock');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const data = await DS.getCats();
    if (data !== null) {
      /* Banco respondeu (data pode ser [] ou [...]): usar dados do Supabase.
         Filtra categorias descontinuadas mesmo que ainda existam no banco. */
      const result = (data.length > 0 ? data : MOCK_CATS).filter(c => !isCategoriaDescontinuada(c));
      setCats(result);
      setSrc(data.length > 0 ? 'supabase' : 'mock');
      if (data.length > 0) {
        console.log(`[Encanto] ✅ ${data.length} categorias carregadas do Supabase`);
      } else {
        console.warn('[Encanto] ⚠️ Tabela categorias vazia — usando fallback local');
      }
    } else {
      /* null = Supabase offline ou erro de rede */
      console.warn('[Encanto] ⚠️ Supabase offline — categorias usando fallback local');
      setCats(MOCK_CATS.filter(c => !isCategoriaDescontinuada(c)));
      setSrc('mock');
    }
    setLoading(false);
  },[]);
  useEffect(()=>{ load(); },[load]);
  return { cats, loading, src, refresh:load };
}
