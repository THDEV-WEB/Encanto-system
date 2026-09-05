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
