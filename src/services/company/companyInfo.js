/* services/company/companyInfo.js — REF-COMPANY-01.
   Dados institucionais da empresa (nome, telefone, whatsapp, e-mail, toggle do botao flutuante) — FONTE
   UNICA no Supabase (tabela reutilizada public.settings, chave 'company_info', valor = objeto JSON).
   Leitura via get_company_info() e escrita via set_company_info(jsonb) — AMBOS RPC SECURITY DEFINER
   dedicados (espelham get_delivery_eta/set_delivery_eta). NAO usar get_setting no cliente: a RLS de
   public.settings e TRANCADA, entao get_setting chamado do BROWSER nunca enxerga a linha e devolve o
   FALLBACK (mesmo bug de REF-DELIVERY-01a). O leitor DEFINER get_company_info le settings direto.

   set_company_info faz PATCH (merge raso no servidor) — um campo institucional NOVO no futuro (ex.:
   "instagram") pode ser lido/escrito sem alterar este arquivo nem o RPC: basta o formulario do Admin
   passar a enviar/ler esse campo.

   CACHE: apenas EM MEMORIA (modulo/sessao) — SEM localStorage. Mesma tecnica de deliveryEta.js: quando o
   admin salva, dispara COMPANY_INFO_EVENT e todos os consumidores (hook) re-sincronizam. DEFAULT_COMPANY_INFO
   cobre o modo degradado (db=null / offline) com os mesmos valores hoje reais da loja.

   Regras PURAS (defaults/formatacao/validacao) vivem em companyInfoRules.js (sem import de lib/supabase,
   testavel em Node puro) — este arquivo so acrescenta o IO (db.rpc).

   REF-SAAS-01 · Onda 6.2: company_info migrou de settings (global) para store_settings (por loja) —
   get_company_info/set_company_info ganharam p_store_id. Lido tanto pelo Admin (loja ESCOLHIDA) quanto
   pelo storefront anonimo (loja RESOLVIDA por dominio), por isso usa buildStoreRpcParam de
   resolveStoreParam.js (combinador dos dois singletons — Onda 6.1), nao adminStore.js isolado. */
import { db } from '../../lib/supabase.js';
import { DEFAULT_COMPANY_INFO, validarPatchCompanyInfo } from './companyInfoRules.js';
import { buildStoreRpcParam } from '../resolveStoreParam.js';

export { DEFAULT_COMPANY_INFO, formatarTelefoneBR } from './companyInfoRules.js';
export const COMPANY_INFO_EVENT = 'encanto:company-info';

let cache = { ...DEFAULT_COMPANY_INFO };   // cache em memoria (NAO e a fonte de verdade; reconciliado por sincronizarCompanyInfo)

/* GERACAO de escrita (mesma tecnica de businessHours/override.js e delivery/deliveryEta.js): cada
   salvarCompanyInfo incrementa. Uma leitura (sincronizarCompanyInfo) so aplica seu resultado ao cache se
   NENHUMA escrita ocorreu desde que ela comecou — uma leitura obsoleta em voo durante um save nunca
   sobrescreve o valor recem-gravado. */
let geracao = 0;

const notificar = () => { try { window.dispatchEvent(new Event(COMPANY_INFO_EVENT)); } catch { /* ignore */ } };

/* Leitura SINCRONA do cache — usada pelo hook p/ pintar na hora, antes do fetch autoritativo resolver. */
export function lerCompanyInfoCache() { return cache; }

/* Le o valor OFICIAL no Supabase (get_company_info, SECURITY DEFINER) e atualiza o cache. Em offline/erro,
   devolve o cache atual. So aplica ao cache se nenhuma escrita ocorreu desde o inicio desta leitura. */
export async function sincronizarCompanyInfo() {
  if (!db) return cache;
  const gen = geracao;
  try {
    const { data, error } = await db.rpc('get_company_info', { ...buildStoreRpcParam() });
    if (error || !data || typeof data !== 'object') return cache;
    if (geracao === gen) { cache = { ...DEFAULT_COMPANY_INFO, ...data }; notificar(); }
    return cache;
  } catch { return cache; }
}

/* Grava (set_company_info) — FONTE OFICIAL, global. TRUTHFUL: so reporta ok se o SERVIDOR confirmar (RPC
   sem erro devolve o objeto MERGEADO, o que so acontece com is_admin() true + upsert efetivado). Qualquer
   erro -> ok:false com a mensagem REAL. O cache so muda com o valor CONFIRMADO pelo servidor. Aceita um
   PATCH parcial (so os campos que mudaram) ou o objeto inteiro — tanto faz, o merge e sempre no servidor. */
export async function salvarCompanyInfo(patch) {
  const v = validarPatchCompanyInfo(patch || {});
  if (v.erro) return { ok: false, error: v.erro };
  if (!db) return { ok: false, error: 'Sem conexão. Tente novamente.' };
  const gen = ++geracao;   // marca esta escrita (invalida leituras em voo)
  try {
    const { data, error } = await db.rpc('set_company_info', { p_patch: v.patch, ...buildStoreRpcParam() });
    if (error) return { ok: false, error: error.message || 'Não foi possível salvar.' };
    if (!data || typeof data !== 'object') return { ok: false, error: 'Resposta inesperada do servidor.' };
    if (geracao === gen) { cache = { ...DEFAULT_COMPANY_INFO, ...data }; notificar(); }
    return { ok: true, info: { ...DEFAULT_COMPANY_INFO, ...data } };
  } catch (e) {
    return { ok: false, error: e?.message || 'Não foi possível salvar.' };
  }
}
