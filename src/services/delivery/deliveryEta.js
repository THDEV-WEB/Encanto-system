/* services/delivery/deliveryEta.js — REF-DELIVERY-01.
   Tempo estimado de ENTREGA (minutos) — FONTE UNICA no Supabase (tabela reutilizada public.settings,
   chave 'delivery_eta_min'). Leitura publica via get_setting (RPC ja existente); escrita via set_delivery_eta
   (so ADMIN; valida 10..180 no servidor). Espelha o padrao de businessHours/override.js (store_mode).

   CACHE: apenas EM MEMORIA (modulo/sessao) — SEM localStorage. Evita flash entre consumidores sem criar uma
   fonte paralela nova (o Supabase segue sendo a unica fonte de verdade). Quando o admin salva, dispara
   ETA_EVENT e todos os consumidores (hook) re-sincronizam. */
import { db } from '../../lib/supabase.js';

export const ETA_EVENT = 'encanto:delivery-eta';
export const ETA_MIN = 10;
export const ETA_MAX = 180;
export const ETA_DEFAULT = 45;
const CHAVE = 'delivery_eta_min';

let cache = ETA_DEFAULT;   // cache em memoria (NAO e a fonte de verdade; reconciliado por sincronizarEta)

const valido = (n) => Number.isFinite(n) && n >= ETA_MIN && n <= ETA_MAX;
const notificar = () => { try { window.dispatchEvent(new Event(ETA_EVENT)); } catch { /* ignore */ } };

/* GERACAO de escrita (mesma tecnica de businessHours/override.js): cada definirEta incrementa. Uma leitura
   (sincronizarEta) so aplica seu resultado ao cache se NENHUMA escrita ocorreu desde que ela comecou —
   assim uma leitura obsoleta em voo durante um save NUNCA sobrescreve o valor recem-gravado. */
let geracao = 0;

/* Leitura SINCRONA do cache — usada pelo hook p/ pintar na hora, antes do fetch autoritativo resolver. */
export function lerEtaCache() { return cache; }

/* Le o valor OFICIAL no Supabase (get_setting) e atualiza o cache. Em offline/erro, devolve o cache atual.
   So aplica ao cache se nenhuma escrita ocorreu desde o inicio desta leitura. */
export async function sincronizarEta() {
  if (!db) return cache;
  const gen = geracao;
  try {
    const { data, error } = await db.rpc('get_setting', { p_chave: CHAVE, p_default: String(ETA_DEFAULT) });
    if (error) return cache;
    const n = parseInt(data, 10);
    const oficial = valido(n) ? n : cache;
    if (geracao === gen && oficial !== cache) { cache = oficial; notificar(); }
    return oficial;
  } catch { return cache; }
}

/* Grava (set_delivery_eta) — FONTE OFICIAL, global p/ todos os dispositivos. Otimista: reflete no cache +
   notifica na hora; se a chamada falhar, LE o valor real do servidor e reconcilia (se o servidor ja tem
   'n', a escrita valeu apesar da resposta perdida). Valida tambem no cliente. So ADMIN passa (is_admin). */
export async function definirEta(min) {
  const n = Math.round(Number(min));
  if (!valido(n)) return { ok: false, error: `Use um valor entre ${ETA_MIN} e ${ETA_MAX} minutos.` };
  const anterior = cache;
  const gen = ++geracao;                                     // marca esta escrita (invalida leituras em voo)
  cache = n; notificar();                                    // otimista: reflete localmente ja
  if (!db) { cache = anterior; notificar(); return { ok: false, error: 'offline' }; }
  try {
    const { data, error } = await db.rpc('set_delivery_eta', { p_min: n });
    if (error) {
      const oficial = await sincronizarEta();                // reconcilia com a verdade do servidor
      if (oficial === n) return { ok: true, eta: n };         // commitou apesar do erro de resposta
      return { ok: false, eta: oficial, error: error.message || 'falha ao salvar' };
    }
    const salvo = parseInt(data, 10);
    if (geracao === gen && valido(salvo) && salvo !== cache) { cache = salvo; notificar(); } // so aplica se ninguem escreveu depois
    return { ok: true, eta: valido(salvo) ? salvo : n };
  } catch (e) {
    const oficial = await sincronizarEta();                  // resposta perdida? adota o valor REAL do servidor
    if (oficial === n) return { ok: true, eta: n };
    return { ok: false, eta: oficial, error: e?.message || 'falha ao salvar' };
  }
}
