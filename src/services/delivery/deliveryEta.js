/* services/delivery/deliveryEta.js — REF-DELIVERY-01 (+01a).
   Tempo estimado de ENTREGA (minutos) — FONTE UNICA no Supabase (tabela reutilizada public.settings,
   chave 'delivery_eta_min'). Leitura via get_delivery_eta() e escrita via set_delivery_eta(int) — AMBOS RPC
   SECURITY DEFINER dedicados (espelham get_store_mode/set_store_mode). NAO usar get_setting no cliente: a
   RLS de public.settings e TRANCADA, entao get_setting chamado do BROWSER nunca enxerga a linha e devolve o
   FALLBACK (bug REF-DELIVERY-01a). O leitor DEFINER get_delivery_eta le settings direto (ignora a RLS).

   CACHE: apenas EM MEMORIA (modulo/sessao) — SEM localStorage. Evita flash entre consumidores sem criar uma
   fonte paralela nova (o Supabase segue sendo a unica fonte de verdade). Quando o admin salva, dispara
   ETA_EVENT e todos os consumidores (hook) re-sincronizam. */
import { db } from '../../lib/supabase.js';

export const ETA_EVENT = 'encanto:delivery-eta';
export const ETA_MIN = 10;
export const ETA_MAX = 180;
export const ETA_DEFAULT = 45;

let cache = ETA_DEFAULT;   // cache em memoria (NAO e a fonte de verdade; reconciliado por sincronizarEta)

const valido = (n) => Number.isFinite(n) && n >= ETA_MIN && n <= ETA_MAX;
const notificar = () => { try { window.dispatchEvent(new Event(ETA_EVENT)); } catch { /* ignore */ } };

/* GERACAO de escrita (mesma tecnica de businessHours/override.js): cada definirEta incrementa. Uma leitura
   (sincronizarEta) so aplica seu resultado ao cache se NENHUMA escrita ocorreu desde que ela comecou —
   assim uma leitura obsoleta em voo durante um save NUNCA sobrescreve o valor recem-gravado. */
let geracao = 0;

/* Leitura SINCRONA do cache — usada pelo hook p/ pintar na hora, antes do fetch autoritativo resolver. */
export function lerEtaCache() { return cache; }

/* Le o valor OFICIAL no Supabase (get_delivery_eta, SECURITY DEFINER) e atualiza o cache. Em offline/erro,
   devolve o cache atual. So aplica ao cache se nenhuma escrita ocorreu desde o inicio desta leitura. */
export async function sincronizarEta() {
  if (!db) return cache;
  const gen = geracao;
  try {
    const { data, error } = await db.rpc('get_delivery_eta');
    if (error) return cache;
    const n = parseInt(data, 10);
    const oficial = valido(n) ? n : cache;
    if (geracao === gen && oficial !== cache) { cache = oficial; notificar(); }
    return oficial;
  } catch { return cache; }
}

/* Grava (set_delivery_eta) — FONTE OFICIAL, global. TRUTHFUL: so reporta ok se o SERVIDOR confirmar (RPC
   sem erro devolve o v_min salvo, o que so acontece com is_admin() true + upsert efetivado). Qualquer erro
   -> ok:false com a mensagem REAL (nada de "salvo" falso). Sem otimismo pre-escrita: o cache so muda com o
   valor CONFIRMADO pelo servidor -> a UI nunca mostra um valor que nao persistiu. Valida tambem no cliente. */
export async function definirEta(min) {
  const n = Math.round(Number(min));
  if (!valido(n)) return { ok: false, error: `Use um valor entre ${ETA_MIN} e ${ETA_MAX} minutos.` };
  if (!db) return { ok: false, error: 'Sem conexão. Tente novamente.' };
  const gen = ++geracao;                                     // marca esta escrita (invalida leituras em voo)
  try {
    const { data, error } = await db.rpc('set_delivery_eta', { p_min: n });
    if (error) return { ok: false, error: error.message || 'Não foi possível salvar.' };
    const salvo = parseInt(data, 10);                        // o servidor RETURN v_min (valor salvo)
    const eta = valido(salvo) ? salvo : n;
    if (geracao === gen) { cache = eta; notificar(); }        // aplica o valor CONFIRMADO (nao stale)
    return { ok: true, eta };
  } catch (e) {
    return { ok: false, error: e?.message || 'Não foi possível salvar.' };
  }
}
