/* services/delivery/deliveryFeeConfig.js — REF-DELIVERY-FEE-01.
   FONTE OFICIAL da configuracao da taxa de entrega automatica por distancia = Supabase (tabela reutilizada
   public.settings, chave 'delivery_fee_config', acessada pelos RPCs get_delivery_fee_config/
   set_delivery_fee_config). Espelha services/businessHours/cronograma.js 1:1 (mesma estrategia: substituicao
   TOTAL do objeto ao salvar, nao PATCH — a tabela de faixas e uma unidade so).

   CACHE: apenas EM MEMORIA (modulo/sessao) — SEM localStorage (mesma escolha de deliveryEta.js/
   cronograma.js/companyInfo.js: evita flash entre consumidores sem criar uma fonte paralela). TRUTHFUL: o
   Admin so ve "salvo" quando o SERVIDOR confirma (sem otimismo pre-escrita). */
import { db } from '../../lib/supabase.js';
import { buildStoreRpcParam } from '../adminStore.js'; // REF-SAAS-01 · Onda 5: {} no storefront, {p_store_id} no Admin

export const DELIVERY_FEE_EVENT = 'encanto:delivery-fee-config';

/* Fallback de resiliencia — EXATAMENTE a semente da migration (zero mudanca de comportamento antes da 1a
   sincronizacao ou se o Supabase estiver inacessivel). Nenhum outro lugar do codigo hardcoda faixas/valores
   — este e o UNICO fallback, usado so quando o servidor esta inalcancavel. */
export const DELIVERY_FEE_CONFIG_PADRAO = {
  version: 1,
  ativo: true,
  maquininha: { ativo: true, valor: 2.00 },
  faixas: [
    { de: 0.0, ate: 5.0, valor: 10.00 }, { de: 5.1, ate: 6.0, valor: 12.00 },
    { de: 6.1, ate: 7.0, valor: 14.00 }, { de: 7.1, ate: 8.0, valor: 16.00 },
    { de: 8.1, ate: 9.0, valor: 18.00 }, { de: 9.1, ate: 10.0, valor: 20.00 },
    { de: 10.1, ate: 11.0, valor: 22.00 }, { de: 11.1, ate: 12.0, valor: 24.00 },
    { de: 12.1, ate: 13.0, valor: 26.00 }, { de: 13.1, ate: 14.0, valor: 28.00 },
    { de: 14.1, ate: 15.0, valor: 30.00 }, { de: 15.1, ate: 16.0, valor: 32.00 },
    { de: 16.1, ate: 17.0, valor: 34.00 }, { de: 17.1, ate: 18.0, valor: 36.00 },
    { de: 18.1, ate: 19.0, valor: 38.00 }, { de: 19.1, ate: 20.0, valor: 40.00 },
    { de: 20.1, ate: 21.0, valor: 42.00 },
  ],
};

let cache = DELIVERY_FEE_CONFIG_PADRAO;   // cache em memoria (NAO e a fonte de verdade; reconciliado por sincronizarDeliveryFeeConfig)

const notificar = () => { try { window.dispatchEvent(new Event(DELIVERY_FEE_EVENT)); } catch { /* ignore */ } };

/* GERACAO de escrita (mesma tecnica de cronograma.js/deliveryEta.js/companyInfo.js): cada
   definirDeliveryFeeConfig incrementa. Uma leitura (sincronizarDeliveryFeeConfig) so aplica seu resultado ao
   cache se NENHUMA escrita ocorreu desde que ela comecou. */
let geracao = 0;

/* Leitura SINCRONA do cache — usada pelo hook p/ pintar na hora, antes do fetch autoritativo resolver. */
export function lerDeliveryFeeConfigCache() { return cache; }

/* Le a configuracao OFICIAL no Supabase (get_delivery_fee_config, SECURITY DEFINER) e atualiza o cache. Em
   offline/erro, devolve o cache atual. So aplica se nenhuma escrita ocorreu desde o inicio desta leitura. */
export async function sincronizarDeliveryFeeConfig() {
  if (!db) return cache;
  const gen = geracao;
  try {
    const { data, error } = await db.rpc('get_delivery_fee_config', buildStoreRpcParam());
    if (error || !data || typeof data !== 'object') return cache;
    if (geracao === gen && data !== cache) { cache = data; notificar(); }
    return data;
  } catch { return cache; }
}

/* Grava (set_delivery_fee_config) — FONTE OFICIAL, global. TRUTHFUL: so reporta ok se o SERVIDOR confirmar
   (RPC sem erro devolve o objeto canonico salvo, o que so acontece com is_admin() true + upsert efetivado +
   validacao server-side passada). Qualquer erro -> ok:false com a mensagem REAL — o servidor SEMPRE
   revalida tudo de novo (nunca confia so no cliente). Sem otimismo pre-escrita. */
export async function definirDeliveryFeeConfig(config) {
  if (!db) return { ok: false, error: 'Sem conexão. Tente novamente.' };
  const gen = ++geracao;
  try {
    const { data, error } = await db.rpc('set_delivery_fee_config', { p_config: config, ...buildStoreRpcParam() });
    if (error) return { ok: false, error: error.message || 'Não foi possível salvar.' };
    if (geracao === gen) { cache = data; notificar(); }
    return { ok: true, config: data };
  } catch (e) {
    return { ok: false, error: e?.message || 'Não foi possível salvar.' };
  }
}
