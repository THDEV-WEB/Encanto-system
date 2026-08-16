/* services/delivery/routing/routeCache.js — REF-DELIVERY-FEE-03.
   Logica PURA de chave/cache para distancia de rota viaria (sem React/IO). A MESMA logica de
   arredondamento/chave e mirrorada em supabase/functions/route-distance/index.ts (Edge Function, Deno)
   — mesmo precedente de templates.ts espelhando messageTemplates.js (REF-ORDER-01 Parte 3). Mudou
   aqui, muda la tambem.

   Cache EM MEMORIA (Map por isolate), nao em tabela: no volume atual (dezenas de pedidos/dia, 2
   tenants, bem abaixo da cota de 2.000/dia do OpenRouteService) uma tabela nova + RLS + migration so
   para cache de performance seria complexidade sem necessidade real — um Map ja reduz consultas
   repetidas na pratica, porque a Edge Function reaproveita o mesmo isolate entre invocacoes proximas.
   Se o volume crescer a ponto do cache em memoria nao bastar (isolates frios com mais frequencia), a
   evolucao natural e um cache em tabela — ver estimativa de escala no relatorio da REF.

   TENANT-SAFE por construcao: a chave SEMPRE inclui storeId, mesmo que origem+destino ja quase
   garantam unicidade por loja (pino de lojas diferentes raramente coincide) — defesa em profundidade,
   nunca depende so da geometria coincidir ou nao. */

const CASAS_DECIMAIS = 4; // ~11m de precisao — junta "mesmo predio/quadra", distingue enderecos diferentes

export function arredondarCoord(n, casas = CASAS_DECIMAIS) {
  const f = 10 ** casas;
  return Math.round(Number(n) * f) / f;
}

/* storeId ausente (loja ainda nao resolvida) cai em 'default' — nunca cache vazio misturado com o de
   uma loja real, e nunca duas lojas sem storeId resolvido colidem com uma loja QUE TEM storeId. */
export function construirChaveCache({ storeId, origem, destino, perfil = 'driving-car' }) {
  const sid = storeId || 'default';
  const oLat = arredondarCoord(origem?.lat), oLng = arredondarCoord(origem?.lng);
  const dLat = arredondarCoord(destino?.lat), dLng = arredondarCoord(destino?.lng);
  return `${sid}|${oLat},${oLng}|${dLat},${dLng}|${perfil}`;
}

export const TTL_PADRAO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias — malha viaria muda raramente
export const MAX_ENTRADAS_PADRAO = 1000; // teto de memoria por isolate

/* Cache generico com TTL + teto de tamanho. `agora` injetavel para teste deterministico (sem
   depender de Date.now() real nem de sleep). Ultrapassar o teto zera o mapa inteiro (LRU real nao
   vale a pena nesta escala — ver comentario de cabecalho). */
export function criarCacheEmMemoria({ ttlMs = TTL_PADRAO_MS, maxEntradas = MAX_ENTRADAS_PADRAO, agora = () => Date.now() } = {}) {
  const mapa = new Map();
  return {
    get(chave) {
      const item = mapa.get(chave);
      if (!item) return null;
      if (agora() - item.criadoEm > ttlMs) { mapa.delete(chave); return null; }
      return item.valor;
    },
    set(chave, valor) {
      if (mapa.size >= maxEntradas) mapa.clear();
      mapa.set(chave, { valor, criadoEm: agora() });
    },
    tamanho() { return mapa.size; },
  };
}
