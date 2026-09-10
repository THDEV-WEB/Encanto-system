/* services/mesa/mesaConfig.js — REF-MESA-01 · Onda 2 (+ Onda 9: tela de config no Admin).
   FONTE OFICIAL da capacidade de Mesa por loja = Supabase (store_settings, chaves mesa_habilitada/
   mesa_canal_qr/mesa_canal_admin/mesa_sessao_habilitada, RPC get_mesa_config/set_mesa_config, ver
   migrations/REF-MESA-01-onda1-fundacao.sql e REF-MESA-02-onda6-abertura-implicita.sql).
   Espelha services/delivery/deliveryFeeConfig.js 1:1 (cache em memoria + puxar do servidor + salvar) —
   a escrita (set_mesa_config) ganhou consumidor de UI na Onda 9 (AdminMesas.jsx), fechando o gap
   registrado desde a Onda 2 (docs/ref/REF-MESA-01-plano-ondas.md).

   Default seguro ENQUANTO não sincroniza (1ª carga, offline): tudo desabilitado — mesma decisão de
   produto já tomada para loyalty_enabled (uma loja nunca "ganha" Mesa por omissão/falha de rede). */
import { db } from '../../lib/supabase.js';
import { buildStoreRpcParam } from '../resolveStoreParam.js';

export const MESA_CONFIG_EVENT = 'encanto:mesa-config';

export const MESA_CONFIG_PADRAO = { habilitada: false, canal_qr: false, canal_admin: false, sessao_habilitada: false };

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

/* Grava (set_mesa_config) — FONTE OFICIAL, por loja. TRUTHFUL: so reporta ok se o SERVIDOR confirmar
   (RPC sem erro devolve o objeto canonico salvo, o que so acontece com is_admin_of(store_id) true +
   upsert efetivado nas 4 chaves). Qualquer erro -> ok:false com a mensagem REAL — o servidor SEMPRE
   revalida (nunca confia so no cliente). Mesmo padrao de definirDeliveryFeeConfig/salvarPagamentoConfig. */
export async function definirMesaConfig({ habilitada, canalQr, canalAdmin, sessaoHabilitada }) {
  if (!db) return { ok: false, error: 'Sem conexão. Tente novamente.' };
  const gen = ++geracao;
  try {
    const { data, error } = await db.rpc('set_mesa_config', {
      p_habilitada: !!habilitada, p_canal_qr: !!canalQr, p_canal_admin: !!canalAdmin,
      p_sessao_habilitada: !!sessaoHabilitada, ...buildStoreRpcParam(),
    });
    if (error) return { ok: false, error: error.message || 'Não foi possível salvar.' };
    if (data?.ok === false) return { ok: false, error: data.error || 'Não foi possível salvar.' };
    const novo = { habilitada: !!data.habilitada, canal_qr: !!data.canal_qr, canal_admin: !!data.canal_admin, sessao_habilitada: !!data.sessao_habilitada };
    if (geracao === gen) { cache = novo; notificar(); }
    return { ok: true, config: novo };
  } catch (e) {
    return { ok: false, error: e?.message || 'Não foi possível salvar.' };
  }
}
