/* e2e/support/storeMode.js — REF-E2E-01.
   Forca o status GLOBAL da loja via a mesma RPC oficial do override do Admin (HB-03: set_store_mode/
   get_store_mode, ver src/services/businessHours/override.js). Usado no setup de specs de checkout
   para nao depender do relogio real (Seg 10-15; Ter-Sab 10-15/17-22; Dom fechado) — anti-flaky.
   Env-gated: sem o projeto de E2E, {skipped:true} — specs @writes nao devem rodar sem o ambiente. */
import { supabaseAdmin } from './supabaseAdmin.js';

/** @param {'AUTO'|'OPEN'|'CLOSED'} modo */
export async function forcarStoreMode(modo = 'OPEN') {
  const client = supabaseAdmin();
  if (!client) return { ok: false, skipped: true };
  const { error } = await client.rpc('set_store_mode', { p_mode: modo });
  if (error) throw new Error(`[e2e] set_store_mode('${modo}') falhou: ${error.message}`);
  return { ok: true, skipped: false };
}
