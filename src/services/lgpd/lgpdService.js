/* services/lgpd/lgpdService.js — REF-LGPD-01 · Onda 1 (LGPD-R01).
   Exclusao/anonimizacao de dados do cliente, lado ADMIN (assistido — atende um pedido recebido por
   outro canal, ex.: WhatsApp/telefone). O self-service do proprio cliente fica em
   providers/AuthProvider.jsx (excluirMeusDados -> AuthService.deleteMyData), sessao dbCliente; aqui e'
   sessao do admin (db), mesmo padrao de services/loyalty/loyaltyService.js (adminBuscar/adminAjustar). */
import { db } from '../../lib/supabase.js';
import { buildStoreRpcParam } from '../adminStore.js'; // REF-SAAS-01 · Onda 5: {p_store_id} da loja ativa do admin

export async function adminExcluirDadosCliente(customerId) {
  if (!db) return { ok: false, error: 'offline' };
  try {
    const { data, error } = await db.rpc('admin_lgpd_delete_customer_data', {
      p_customer_id: customerId, ...buildStoreRpcParam(),
    });
    if (error) return { ok: false, error: error.message };
    return data || { ok: false, error: 'sem resposta' };
  } catch (e) { return { ok: false, error: e?.message || 'falha' }; }
}
