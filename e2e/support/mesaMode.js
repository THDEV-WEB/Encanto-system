/* e2e/support/mesaMode.js — REF-MESA-01 · Onda 4.
   Liga/desliga a capacidade de Mesa (store_settings: mesa_habilitada/mesa_canal_qr/mesa_canal_admin)
   ANTES de um spec, escrevendo DIRETO via supabaseAdmin() (service_role, ignora RLS) — mesmo padrão
   e mesma justificativa de e2e/support/storeMode.js (preparar estado antes do teste, não simular uma
   ação de usuário via set_mesa_config, que exige sessão real de admin). Default: loja 'encanto' (única
   loja do fixture do E2E hoje usada pelos specs de UI). */
import { supabaseAdmin } from './supabaseAdmin.js';

/** @param {{habilitada?: boolean, canalQr?: boolean, canalAdmin?: boolean, sessaoHabilitada?: boolean}} flags */
export async function definirMesaConfig(flags = {}, slug = 'encanto') {
  const admin = supabaseAdmin();
  if (!admin) return { ok: false, skipped: true };
  const { data: loja, error: erroLoja } = await admin.from('stores').select('id').eq('slug', slug).single();
  if (erroLoja) throw new Error(`[e2e] definirMesaConfig falhou ao resolver a loja: ${erroLoja.message}`);
  const linhas = [
    flags.habilitada !== undefined && { store_id: loja.id, chave: 'mesa_habilitada', valor: String(!!flags.habilitada) },
    flags.canalQr !== undefined && { store_id: loja.id, chave: 'mesa_canal_qr', valor: String(!!flags.canalQr) },
    flags.canalAdmin !== undefined && { store_id: loja.id, chave: 'mesa_canal_admin', valor: String(!!flags.canalAdmin) },
    // REF-MESA-02 · Onda 6: capability independente -- sem ela, tipo_pedido='mesa' nunca abre/anexa
    // mesa_session_id (create_order -> _get_or_open_mesa_session), entao "Ver conta"/ocupacao nunca aparecem.
    flags.sessaoHabilitada !== undefined && { store_id: loja.id, chave: 'mesa_sessao_habilitada', valor: String(!!flags.sessaoHabilitada) },
  ].filter(Boolean);
  if (linhas.length === 0) return { ok: true, skipped: false };
  const { error } = await admin.from('store_settings').upsert(linhas, { onConflict: 'store_id,chave' });
  if (error) throw new Error(`[e2e] definirMesaConfig falhou: ${error.message}`);
  return { ok: true, skipped: false };
}

/** Restaura o estado padrão seguro (tudo desabilitado) — chamar sempre no afterEach de qualquer spec
    que ligue a capacidade, para não vazar Mesa habilitada pra specs de checkout normal (Onda 2) que
    rodam depois na MESMA loja fixture compartilhada. */
export async function desligarMesaConfig(slug = 'encanto') {
  return definirMesaConfig({ habilitada: false, canalQr: false, canalAdmin: false, sessaoHabilitada: false }, slug);
}
