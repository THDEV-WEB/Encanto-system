/* address/services/geocoding/gazetteerCorrector.js — REF-ADDRESS-02 · Onda 4.
   Correção/canonicalização de texto usando a tabela curada local (bairros/ruas conhecidas, fuzzy via
   pg_trgm — migration Onda 4). Mesmo cliente/timeout defensivo de addressRepository.js/DataService.

   D-GAZETTEER-ORDER (decisão registrada no ADR §17): só é chamado pelo waterfall quando a query ORIGINAL
   já voltou vazia de TODOS os providers externos — nunca "corrige" de antemão uma busca que já funciona.
   Nunca lança: falha de rede/RPC/timeout devolve a query original intacta, e o waterfall segue exatamente
   como funcionava antes desta onda (camada aditiva, puro upside). */
import { db, RPC_TIMEOUT } from '../../../lib/supabase.js';

const LIMIAR_SIMILARIDADE = 0.35;

export async function corrigir(query, { cidade = null } = {}) {
  if (!db || !query || query.trim().length < 3) return query;
  const call = () => db.rpc('buscar_gazetteer', { p_query: query, p_cidade: cidade, p_limit: 1 });
  const withTimeout = (p) => Promise.race([p,
    new Promise((res) => setTimeout(() => res({ data: null, error: { message: 'timeout' } }), RPC_TIMEOUT))]);
  try {
    const { data, error } = await withTimeout(call());
    if (error || !Array.isArray(data) || data.length === 0) return query;
    const melhor = data[0];
    if (!melhor || typeof melhor.similaridade !== 'number' || melhor.similaridade < LIMIAR_SIMILARIDADE) return query;
    return melhor.nome || query;
  } catch {
    return query;
  }
}
