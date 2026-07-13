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

/* Busca o modo OFICIAL no Supabase (get_store_mode) e atualiza o cache. Retorna o modo; em offline/erro,
   devolve o cache atual (degradacao graciosa). So aplica se nenhuma escrita ocorreu desde o dispatch. */
export async function sincronizarModo() {
  if (!db) return lerCache();
  const gen = geracao;
  try {
    const { data, error } = await db.rpc('get_store_mode');
    if (error || data == null) return lerCache();
    const modo = normalizar(data);
    if (geracao === gen && modo !== lerCache()) { gravarCache(modo); notificar(); }
    return modo;
  } catch { return lerCache(); }
}

/* Grava o modo no Supabase (set_store_mode) — FONTE OFICIAL, global p/ todos os dispositivos. Otimista:
   atualiza o cache + notifica na hora. Reconciliacao robusta: se a chamada falhar, LE o valor real do
   servidor; se o servidor ja tem 'alvo', a escrita valeu (resposta perdida) -> ok:true (sem falso erro).
   Se falhou de fato, adota o valor oficial e devolve o erro. So ADMIN passa (is_admin() no servidor). */
export async function definirModo(modo) {
  const alvo = normalizar(modo);
  const anterior = lerCache();
  const gen = ++geracao;                                   // marca esta escrita (invalida leituras em voo)
  gravarCache(alvo); notificar();                          // otimista: reflete localmente ja
  if (!db) { gravarCache(anterior); notificar(); return { ok: false, modo: anterior, error: 'offline' }; }
  try {
    const { data, error } = await db.rpc('set_store_mode', { p_mode: alvo });
    if (error) {
      const oficial = await sincronizarModo();             // reconcilia com a verdade do servidor
      if (oficial === alvo) return { ok: true, modo: alvo }; // commitou apesar do erro de resposta
      return { ok: false, modo: oficial, error: error.message || 'falha ao salvar' };
    }
    const salvo = normalizar(data ?? alvo);
    if (geracao === gen && salvo !== lerCache()) { gravarCache(salvo); notificar(); } // so aplica se ninguem escreveu depois
    return { ok: true, modo: salvo };
  } catch (e) {
    const oficial = await sincronizarModo();               // resposta perdida? adota o valor REAL do servidor
    if (oficial === alvo) return { ok: true, modo: alvo };  // commitou apesar da resposta perdida (sem falso erro)
    return { ok: false, modo: oficial, error: e?.message || 'falha ao salvar' };
  }
}
