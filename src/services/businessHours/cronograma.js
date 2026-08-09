/* services/businessHours/cronograma.js — REF-BUSINESS-HOURS-04.
   FONTE OFICIAL do cronograma SEMANAL (quais dias abrem, em quais horarios) = Supabase (tabela reutilizada
   public.settings, chave 'business_hours_schedule', acessada pelos RPCs get_business_hours_schedule/
   set_business_hours_schedule). Ate aqui (HB-01/02/03) so o OVERRIDE (AUTO/OPEN/CLOSED) vivia no banco —
   este arquivo faz para o CRONOGRAMA exatamente o que override.js ja faz para o modo.

   Espelha services/delivery/deliveryEta.js (padrao TRUTHFUL, sem pintura otimista): o formulario do Admin
   tem um botao "Salvar" explicito, entao nao ha necessidade de otimismo — so refletimos o valor quando o
   SERVIDOR confirma. Cache em MEMORIA (sessao), nunca localStorage (mesma escolha de deliveryEta.js: evita
   flash entre consumidores sem criar uma fonte paralela). O engine (businessHours.js) nao conhece este
   arquivo nem o Supabase — recebe o cronograma ja convertido (semanaFromSchedule) de quem usa este cache
   (hooks/useBusinessHours.js, hooks/useBusinessHoursSchedule.js). */
import { db } from '../../lib/supabase.js';
import { TIMEZONE } from './schedule.js';
import { buildStoreRpcParam } from '../resolveStoreParam.js'; // REF-SAAS-01 · Onda 5/6.1: {p_store_id} do Admin (seletor) ou do storefront (dominio), {} se nenhum resolveu

export const SCHEDULE_EVENT = 'encanto:business-hours-schedule';

/* Fallback de resiliencia — EXATAMENTE o horario semeado pela migration (zero mudanca de comportamento
   antes da 1a sincronizacao ou se o Supabase estiver inacessivel). Mesmo papel que ETA_DEFAULT tem em
   deliveryEta.js; mesmos numeros que services/businessHours/schedule.js (SEMANA) sempre teve. */
const PERIODO_PADRAO = [{ ini: '10:00', fim: '15:00' }, { ini: '17:00', fim: '22:00' }];
export const CRONOGRAMA_PADRAO = {
  version: 1,
  timezone: TIMEZONE,
  schedule: {
    domingo: { fechado: true, periodos: [] },
    segunda: { fechado: false, periodos: [{ ini: '10:00', fim: '15:00' }] },
    terca: { fechado: false, periodos: PERIODO_PADRAO },
    quarta: { fechado: false, periodos: PERIODO_PADRAO },
    quinta: { fechado: false, periodos: PERIODO_PADRAO },
    sexta: { fechado: false, periodos: PERIODO_PADRAO },
    sabado: { fechado: false, periodos: PERIODO_PADRAO },
  },
  exceptions: {},
};

let cache = CRONOGRAMA_PADRAO;   // cache em memoria (NAO e a fonte de verdade; reconciliado por sincronizarCronograma)

const notificar = () => { try { window.dispatchEvent(new Event(SCHEDULE_EVENT)); } catch { /* ignore */ } };

/* GERACAO de escrita (mesma tecnica de override.js/deliveryEta.js): cada definirCronograma incrementa. Uma
   leitura (sincronizarCronograma) so aplica seu resultado ao cache se NENHUMA escrita ocorreu desde que ela
   comecou — evita que uma leitura obsoleta em voo durante um save sobrescreva o valor recem-gravado. */
let geracao = 0;

/* Leitura SINCRONA do cache — usada pelos hooks p/ pintar na hora, antes do fetch autoritativo resolver. */
export function lerCronogramaCache() { return cache; }

/* Le o cronograma OFICIAL no Supabase (get_business_hours_schedule, SECURITY DEFINER) e atualiza o cache.
   Em offline/erro, devolve o cache atual. So aplica se nenhuma escrita ocorreu desde o inicio desta leitura. */
export async function sincronizarCronograma() {
  if (!db) return cache;
  const gen = geracao;
  try {
    const { data, error } = await db.rpc('get_business_hours_schedule', buildStoreRpcParam());
    if (error || !data || typeof data !== 'object') return cache;
    if (geracao === gen && data !== cache) { cache = data; notificar(); }
    return data;
  } catch { return cache; }
}

/* Grava (set_business_hours_schedule) — FONTE OFICIAL, global. TRUTHFUL: so reporta ok se o SERVIDOR
   confirmar (RPC sem erro devolve o objeto canonico salvo, o que so acontece com is_admin() true + upsert
   efetivado + validacao server-side passada). Qualquer erro -> ok:false com a mensagem REAL (a RPC valida
   tudo de novo: dias/horarios/sobreposicao — nunca confia so na validacao client-side). Sem otimismo
   pre-escrita: o cache so muda com o valor CONFIRMADO pelo servidor -> a UI nunca mostra algo que nao
   persistiu (mesmo padrao de AdminEmpresa/AdminDeliveryEta: botao "Salvar" unico, sem auto-save). */
export async function definirCronograma(schedule) {
  if (!db) return { ok: false, error: 'Sem conexão. Tente novamente.' };
  const gen = ++geracao;
  try {
    const { data, error } = await db.rpc('set_business_hours_schedule', { p_schedule: schedule, ...buildStoreRpcParam() });
    if (error) return { ok: false, error: error.message || 'Não foi possível salvar.' };
    if (geracao === gen) { cache = data; notificar(); }
    return { ok: true, cronograma: data };
  } catch (e) {
    return { ok: false, error: e?.message || 'Não foi possível salvar.' };
  }
}
