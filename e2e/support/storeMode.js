/* e2e/support/storeMode.js — REF-E2E-01. Reescrito no REF-CI-01 (achado real em CI).
   Forca o status GLOBAL da loja antes de specs de checkout, para nao depender do relogio real
   (Seg 10-15; Ter-Sab 10-15/17-22; Dom fechado) — anti-flaky.

   A RPC oficial (set_store_mode, mesma do override do Admin - HB-03) exige is_admin()=true; um
   client service_role via PostgREST NAO satisfaz isso (auth.uid() fica nulo sem uma sessao real de
   admin autenticado). Para o SETUP de teste, em vez de forjar uma sessao de admin so para isto,
   escreve DIRETO na tabela settings via supabaseAdmin() (service_role, ignora RLS) - equivalente ao
   efeito da RPC, sem depender do gate de aplicacao (legitimo: quem escreve aqui e o dono do banco,
   preparando o estado ANTES do teste comecar, nao simulando uma acao de usuario).

   BUG REAL corrigido aqui (achado no 1o CI verde de verdade, ver docs/ref/REF-CI-01-progress.md): a
   versao anterior lia credenciais de uma conexao Postgres DIRETA num arquivo LOCAL do Windows
   (C:\Users\...\db.e2e.env) - inexistente no runner do GitHub Actions. loadConn() retornava null
   SILENCIOSAMENTE, forcarStoreMode() virava {skipped:true} sem escrever nada, e checkout-guest.spec.js
   (teste "loja fechada bloqueia o checkout") falhava sempre em CI: o store_mode real no banco
   compartilhado ficava o que sobrou de execucoes locais anteriores (nunca virava CLOSED de verdade).
   Fix: supabaseAdmin() (e2e/support/supabaseAdmin.js) — mesmas credenciais (.env.e2e / secrets do
   GitHub) que TODO o resto da suite ja usa e que ja funciona nos dois ambientes. */
import { supabaseAdmin } from './supabaseAdmin.js';

/** @param {'AUTO'|'OPEN'|'CLOSED'} modo */
export async function forcarStoreMode(modo = 'OPEN') {
  const admin = supabaseAdmin();
  if (!admin) return { ok: false, skipped: true };
  const { error } = await admin.from('settings').upsert({ chave: 'store_mode', valor: modo }, { onConflict: 'chave' });
  if (error) throw new Error(`[e2e] forcarStoreMode falhou: ${error.message}`);
  return { ok: true, skipped: false };
}
