/* services/loyalty/loyaltyService.js — REF-LOYALTY-01.
   FONTE OFICIAL da fidelidade = Supabase (RPCs SECURITY DEFINER). O cliente le/resgata a PROPRIA
   fidelidade via dbCliente (sessao do cliente, auth.uid()); o admin opera via db (sessao do admin,
   is_admin()). Toda MUTACAO acontece no backend — o frontend nunca conta/grava selo.
   localStorage e SO CACHE (pintura instantanea): guarda o ultimo estado conhecido do PROPRIO cliente
   (validado por customer_id) e e sempre reconciliado por get_my_loyalty. NUNCA e a verdade.
   Camada service: importa dbCliente/db (infra) e constants — nunca pricing/addons/format (D2 ok). */
import { dbCliente } from '../../lib/dbCliente.js';
import { db } from '../../lib/supabase.js';
import { STORAGE_KEYS } from '../../constants/storage.js';
import { ESTADO_VAZIO, normalizarEstado } from './loyalty.js';

export { ESTADO_VAZIO } from './loyalty.js';
/* Evento "algo mudou, re-sincronize do servidor" — disparado pelo checkout apos um pedido.
   O hook (useLoyalty) responde PUXANDO get_my_loyalty (fonte oficial), nunca lendo cache velho. */
export const LOYALTY_EVENT = 'encanto:loyalty';

/* ── CACHE (por cliente) — nunca fonte de verdade, so pintura sem flash ─────────────── */
export function lerCache(customerId) {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.LOYALTY_CACHE) || 'null');
    if (raw && customerId && raw.cid === customerId && raw.estado) return normalizarEstado(raw.estado);
  } catch { /* ignore */ }
  return { ...ESTADO_VAZIO };
}
function gravarCache(customerId, estado) {
  try {
    if (customerId) localStorage.setItem(STORAGE_KEYS.LOYALTY_CACHE, JSON.stringify({ cid: customerId, estado }));
  } catch { /* ignore */ }
}
export function limparCache() { try { localStorage.removeItem(STORAGE_KEYS.LOYALTY_CACHE); } catch { /* ignore */ } }

/* ── CLIENTE: leitura oficial (get_my_loyalty resolve o customer por auth.uid() no servidor) ── */
export async function sincronizar(customerId) {
  if (!dbCliente) return lerCache(customerId);
  try {
    const { data, error } = await dbCliente.rpc('get_my_loyalty');
    if (error || data == null) return lerCache(customerId);
    const estado = normalizarEstado(data);
    gravarCache(customerId, data);
    return estado;
  } catch { return lerCache(customerId); }
}

/* ── CLIENTE: resgatar a propria recompensa (backend valida saldo/identidade, atomico) ── */
export async function resgatar(customerId) {
  if (!dbCliente) return { ok: false, error: 'offline' };
  try {
    const { data, error } = await dbCliente.rpc('redeem_reward');
    if (error) return { ok: false, error: error.message || 'falha ao resgatar' };
    if (data && data.ok === false) return { ok: false, error: data.error || 'recompensa indisponivel' };
    const estado = await sincronizar(customerId);   // reconcilia com a verdade do servidor
    return { ok: true, estado };
  } catch (e) { return { ok: false, error: e?.message || 'falha ao resgatar' }; }
}

/* ── ADMIN (via db, is_admin() no servidor): busca / ajuste / resgate / config ────────── */
export async function adminBuscar(query) {
  if (!db) return { ok: false, error: 'offline' };
  try {
    const { data, error } = await db.rpc('admin_find_loyalty', { p_query: query });
    if (error) return { ok: false, error: error.message };
    return data || { ok: false, error: 'sem resposta' };
  } catch (e) { return { ok: false, error: e?.message || 'falha' }; }
}
export async function adminAjustar(customerId, delta, note) {
  if (!db) return { ok: false, error: 'offline' };
  try {
    const { data, error } = await db.rpc('admin_adjust_loyalty', { p_customer_id: customerId, p_delta: delta, p_note: note || null });
    if (error) return { ok: false, error: error.message };
    return data || { ok: false, error: 'sem resposta' };
  } catch (e) { return { ok: false, error: e?.message || 'falha' }; }
}
export async function adminResgatar(customerId) {
  if (!db) return { ok: false, error: 'offline' };
  try {
    const { data, error } = await db.rpc('redeem_reward', { p_customer_id: customerId });
    if (error) return { ok: false, error: error.message };
    return data || { ok: false, error: 'sem resposta' };
  } catch (e) { return { ok: false, error: e?.message || 'falha' }; }
}
export async function adminLerConfig() {
  if (!db) return { required: 10, discount: 50, enabled: true };
  const um = async (chave, def) => {
    try { const { data } = await db.rpc('get_setting', { p_chave: chave, p_default: def }); return data; }
    catch { return def; }
  };
  const [req, dis, en] = await Promise.all([
    um('loyalty_required', '10'), um('loyalty_discount', '50'), um('loyalty_enabled', 'true'),
  ]);
  return { required: parseInt(req, 10) || 10, discount: parseInt(dis, 10) || 50, enabled: String(en) !== 'false' };
}
export async function adminSalvarConfig(required, discount, enabled) {
  if (!db) return { ok: false, error: 'offline' };
  try {
    const { data, error } = await db.rpc('set_loyalty_config', { p_required: required, p_discount: discount, p_enabled: enabled });
    if (error) return { ok: false, error: error.message };
    return data || { ok: false, error: 'sem resposta' };
  } catch (e) { return { ok: false, error: e?.message || 'falha' }; }
}
