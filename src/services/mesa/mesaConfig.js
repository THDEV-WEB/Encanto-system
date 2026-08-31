/* services/mesa/mesaConfig.js — REF-MESA-01 · Onda 2.
   FONTE OFICIAL da capacidade de Mesa por loja = Supabase (store_settings, chaves mesa_habilitada/
   mesa_canal_qr/mesa_canal_admin, RPC get_mesa_config, ver migrations/REF-MESA-01-onda1-fundacao.sql).
   Espelha services/delivery/deliveryFeeConfig.js 1:1 na metade de LEITURA (cache em memoria + puxar do
   servidor) — a escrita (set_mesa_config) ainda não tem consumidor de UI nesta onda (nenhuma tela de
   Admin para ligar/desligar Mesa foi pedida ainda; ver docs/ref/REF-MESA-01-plano-ondas.md, gap
   registrado explicitamente).

   Default seguro ENQUANTO não sincroniza (1ª carga, offline): tudo desabilitado — mesma decisão de
   produto já tomada para loyalty_enabled (uma loja nunca "ganha" Mesa por omissão/falha de rede). */
import { db } from '../../lib/supabase.js';
import { buildStoreRpcParam } from '../resolveStoreParam.js';

export const MESA_CONFIG_EVENT = 'encanto:mesa-config';

export const MESA_CONFIG_PADRAO = { habilitada: false, canal_qr: false, canal_admin: false };

let cache = MESA_CONFIG_PADRAO;
let geracao = 0;

const notificar = () => { try { window.dispatchEvent(new Event(MESA_CONFIG_EVENT)); } catch { /* ignore */ } };

export function lerMesaConfigCache() { return cache; }

/* Le a configuracao OFICIAL no Supabase (get_mesa_config, SECURITY DEFINER, publica) e atualiza o
   cache. Em offline/erro, devolve o cache atual (nunca promove Mesa por falha de rede). */
export async function sincronizarMesaConfig() {
  if (!db) return cache;
  const gen = geracao;
  try {
    const { data, error } = await db.rpc('get_mesa_config', buildStoreRpcParam());
    if (error || !data || typeof data !== 'object') return cache;
    if (geracao === gen && data !== cache) { cache = data; notificar(); }
    return data;
  } catch { return cache; }
}
