/* services/businessHours/override.js — REF-BUSINESS-HOURS-03.
   FONTE OFICIAL do override (modo AUTO/OPEN/CLOSED) = Supabase (tabela reutilizada public.settings,
   chave 'store_mode', acessada pelos RPCs get_store_mode/set_store_mode). O localStorage passa a ser
   apenas CACHE (pintura instantanea + tolerancia offline), NUNCA fonte de verdade.

   A DECISAO (prioridade OPEN>CLOSED>AUTO) continua em resolverOverride (businessHours.js) — aqui so muda
   a ORIGEM do modo: localStorage -> Supabase. Escrita restrita ao Admin no servidor (is_admin()). */
import { MODOS } from './businessHours.js';
import { STORAGE_KEYS } from '../../constants/storage.js';
import { db } from '../../lib/supabase.js';

export { MODOS };
export const MODE_EVENT = 'encanto:store-mode';

const normalizar = (v) => {
  const u = typeof v === 'string' ? v.toUpperCase() : v;
  return u === MODOS.OPEN || u === MODOS.CLOSED || u === MODOS.AUTO ? u : MODOS.AUTO;
};
const lerCache = () => { try { return normalizar(localStorage.getItem(STORAGE_KEYS.STORE_MODE)); } catch { return MODOS.AUTO; } };
const gravarCache = (m) => { try { localStorage.setItem(STORAGE_KEYS.STORE_MODE, m); } catch { /* ignore */ } };
const notificar = () => { try { window.dispatchEvent(new Event(MODE_EVENT)); } catch { /* ignore */ } };

/* GERACAO de escrita: cada definirModo incrementa. Uma leitura (sincronizarModo) so aplica seu resultado
   ao cache se NENHUMA escrita ocorreu desde que ela comecou. Assim uma leitura obsoleta (get_store_mode
   com snapshot pre-commit, em voo durante um save) NUNCA sobrescreve o valor que uma escrita mais nova
   ja assumiu — corrige a corrida leitura-vs-escrita no dispositivo do admin. */
let geracao = 0;

/* Leitura SINCRONA do cache local — usada pelo hook p/ pintar o estado na hora (sem flash), antes de o
   fetch autoritativo resolver. Nunca e a fonte de verdade; e reconciliada por sincronizarModo(). */
export function lerModoCache() { return lerCache(); }

/* Le o modo OFICIAL no servidor (get_store_mode). Sucesso -> modo normalizado; erro/offline -> null.
   NAO cai no cache aqui de proposito: quem chama decide o que fazer com a incerteza. E isto que torna a
   reconciliacao de definirModo TRUTHFUL — um cache contaminado pela pintura otimista nunca vira "sucesso". */
async function lerModoServidor() {
  if (!db) return null;
  try {
    const { data, error } = await db.rpc('get_store_mode');
    if (error || data == null) return null;
    return normalizar(data);
  } catch { return null; }
}

/* Busca o modo OFICIAL no Supabase e atualiza o cache. Retorna o modo; em offline/erro, devolve o cache
   atual (degradacao graciosa — aqui cair no cache e ok, pois so PINTA; nao decide sucesso de escrita).
   So aplica se nenhuma escrita ocorreu desde o dispatch. */
export async function sincronizarModo() {
  const gen = geracao;
  const modo = await lerModoServidor();
  if (modo == null) return lerCache();
  if (geracao === gen && modo !== lerCache()) { gravarCache(modo); notificar(); }
  return modo;
}

/* Grava o modo no Supabase (set_store_mode) — FONTE OFICIAL, global p/ todos os dispositivos. Pinta otimista
   (reflete localmente na hora), mas o VEREDITO de sucesso depende SO da confirmacao do servidor:
     - RPC sem erro (RETURN v_mode) -> ok:true (servidor confirmou).
     - RPC com erro/resposta perdida -> reconciliarFalha LE o valor REAL do servidor (lerModoServidor, que
       NAO cai no cache); ok:true SO se o servidor realmente ja tem 'alvo' (resposta perdida apos commit).
   BUG corrigido (auditoria REF-AUDIT-01): antes a reconciliacao usava sincronizarModo, que no erro devolvia
   o CACHE — ja contaminado pela pintura otimista (=alvo) -> falso ok:true numa queda TOTAL de rede (a RPC e
   a leitura falhando juntas). Mesmo padrao ja corrigido em services/delivery/deliveryEta.js. So ADMIN passa
   (is_admin() no servidor). */
export async function definirModo(modo) {
  const alvo = normalizar(modo);
  const anterior = lerCache();
  const gen = ++geracao;                                   // marca esta escrita (invalida leituras em voo)
  gravarCache(alvo); notificar();                          // otimista: reflete localmente ja
  if (!db) { gravarCache(anterior); notificar(); return { ok: false, modo: anterior, error: 'offline' }; }
  try {
    const { data, error } = await db.rpc('set_store_mode', { p_mode: alvo });
    if (error) return reconciliarFalha(alvo, anterior, gen, error.message);
    const salvo = normalizar(data ?? alvo);                // servidor CONFIRMOU (RETURN v_mode)
    if (geracao === gen && salvo !== lerCache()) { gravarCache(salvo); notificar(); } // so aplica se ninguem escreveu depois
    return { ok: true, modo: salvo };
  } catch (e) {
    return reconciliarFalha(alvo, anterior, gen, e?.message);
  }
}

/* Reconciliacao TRUTHFUL apos a RPC nao confirmar (erro ou resposta perdida). LE o valor REAL do servidor
   SEM cair no cache: so ha sucesso se o servidor REALMENTE ja tem 'alvo'. Senao, reverte a pintura otimista
   para o melhor valor conhecido (oficial do servidor, ou o estado anterior) e devolve erro honesto — nunca
   um "salvo" falso. O guard geracao===gen evita sobrescrever uma escrita mais nova. */
async function reconciliarFalha(alvo, anterior, gen, msg) {
  const oficial = await lerModoServidor();                 // null se a leitura tambem falhou
  if (oficial === alvo) {                                  // resposta perdida apos commit: o write valeu
    if (geracao === gen && lerCache() !== alvo) { gravarCache(alvo); notificar(); }
    return { ok: true, modo: alvo };
  }
  const real = oficial ?? anterior;                        // desconhecido -> reverte ao estado anterior
  if (geracao === gen && lerCache() !== real) { gravarCache(real); notificar(); }
  return { ok: false, modo: real, error: msg || 'falha ao salvar' };
}
