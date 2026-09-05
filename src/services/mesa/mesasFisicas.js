/* services/mesa/mesasFisicas.js — REF-MESA-02 · Onda 4.
   Catálogo de mesas físicas por loja (public.mesas) — CRUD mínimo via RPCs SECURITY DEFINER
   (admin_listar_mesas/admin_criar_mesa/admin_set_mesa_status). Espelha o padrão de chamada de
   services/loyalty/index.js: sempre via buildStoreRpcParam() (bundle Admin, respeita loja ativa
   no seletor multi-loja), nunca insert direto na tabela. */
import { db } from '../../lib/supabase.js';
import { buildStoreRpcParam } from '../resolveStoreParam.js';

export async function listarMesas() {
  if (!db) return [];
  const { data, error } = await db.rpc('admin_listar_mesas', buildStoreRpcParam());
  if (error || !Array.isArray(data)) return [];
  return data;
}

export async function criarMesa(identificador) {
  if (!db) return { ok: false, error: 'offline' };
  const { data, error } = await db.rpc('admin_criar_mesa', { p_identificador: identificador, ...buildStoreRpcParam() });
  if (error) return { ok: false, error: error.message };
  return data;
}

export async function setMesaStatus(mesaId, status) {
  if (!db) return { ok: false, error: 'offline' };
  const { data, error } = await db.rpc('admin_set_mesa_status', { p_mesa_id: mesaId, p_status: status, ...buildStoreRpcParam() });
  if (error) return { ok: false, error: error.message };
  return data;
}

/* REF-MESA-02 · Onda 8: total/consulta da conta corrente de uma mesa com sessao aberta -- so
   leitura, nenhum side effect (a RPC e' STABLE). */
export async function consultarContaMesa(identificador) {
  if (!db) return { ok: false, error: 'offline' };
  const { data, error } = await db.rpc('admin_consultar_conta_mesa', { p_mesa_identificador: identificador, ...buildStoreRpcParam() });
  if (error) return { ok: false, error: error.message };
  return data;
}

/* REF-MESA-02 · Onda 9: move uma sessao aberta de uma mesa fisica pra outra (cliente mudou de
   lugar) sem fechar nada -- sessao/pedidos/total continuam os mesmos. */
export async function trocarMesaSessao(mesaSessionId, novoIdentificador) {
  if (!db) return { ok: false, error: 'offline' };
  const { data, error } = await db.rpc('admin_trocar_mesa_sessao', { p_mesa_session_id: mesaSessionId, p_novo_identificador: novoIdentificador, ...buildStoreRpcParam() });
  if (error) return { ok: false, error: error.message };
  return data;
}

/* REF-MESA-02 · Onda 5 (QR protegido): RPC publica (guest escaneando o QR, sem sessao/loja
   selecionada ainda) -- por isso NUNCA usa buildStoreRpcParam() aqui, o token sozinho ja resolve a
   loja no servidor. Nunca confiar no numero da mesa da URL crua -- so o que este RPC devolve. */
export async function resolverMesaPorToken(qrToken) {
  if (!db || !qrToken) return { ok: false, error: 'offline' };
  const { data, error } = await db.rpc('resolver_mesa_por_token', { p_qr_token: qrToken });
  if (error) return { ok: false, error: error.message };
  return data;
}
