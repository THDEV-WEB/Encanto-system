/* pagamento/services/pagamentoConfig.js — REF-PAGAMENTO-01 · Onda 5.
   FONTE OFICIAL da capacidade de pagamento online por loja = Supabase (store_settings, chaves
   pagamento_online_habilitada/mp_public_key, RPC get_pagamento_config, ver migration
   REF-PAGAMENTO-01-onda5-config-e-status-cliente.sql). Espelha services/mesa/mesaConfig.js 1:1 (mesma
   estrategia, ja provada em producao: cache em memoria + puxar do servidor, default seguro).

   Default seguro ENQUANTO não sincroniza (1ª carga, offline): pagamento online desabilitado — mesma
   decisão de produto já tomada para mesa_habilitada/loyalty_enabled (uma loja nunca "ganha" uma
   capability por omissão/falha de rede). */
import { db } from '../../lib/supabase.js';
import { buildStoreRpcParam } from '../../services/resolveStoreParam.js';

export const PAGAMENTO_CONFIG_EVENT = 'encanto:pagamento-config';

export const PAGAMENTO_CONFIG_PADRAO = { habilitada: false, public_key: null };

let cache = PAGAMENTO_CONFIG_PADRAO;
let geracao = 0;

const notificar = () => { try { window.dispatchEvent(new Event(PAGAMENTO_CONFIG_EVENT)); } catch { /* ignore */ } };

export function lerPagamentoConfigCache() { return cache; }

/* Le a configuracao OFICIAL no Supabase (get_pagamento_config, SECURITY DEFINER, publica) e atualiza
   o cache. Em offline/erro, devolve o cache atual (nunca promove pagamento online por falha de rede). */
export async function sincronizarPagamentoConfig() {
  if (!db) return cache;
  const gen = geracao;
  try {
    const { data, error } = await db.rpc('get_pagamento_config', buildStoreRpcParam());
    if (error || !data || typeof data !== 'object') return cache;
    if (geracao === gen && data !== cache) { cache = data; notificar(); }
    return data;
  } catch { return cache; }
}
