/* lib/supabase.js — singleton de I/O + configuração de ambiente (REF-APP-01 · Onda 1)
   Move puro do topo de App.jsx: SUPA_URL/KEY, WHATSAPP, RPC_TIMEOUT, LOGO e o cliente Supabase `db`.
   Regra-trava: createClient ÚNICO (nunca repetir — senão 2 sessões auth); modo degradado db=null preservado.
   `export let db` = binding vivo: o try/catch reatribui no load do módulo; importadores enxergam o valor final. */
import { createClient } from '@supabase/supabase-js';
import { ENCANTO_LOGO } from '../logo.js';

/* -- Config (via variaveis de ambiente VITE_*) -- */
export const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPA_KEY = import.meta.env.VITE_SUPABASE_KEY;
export const WHATSAPP = import.meta.env.VITE_WHATSAPP || '5538992203620';
export const RPC_TIMEOUT = Number(import.meta.env.VITE_RPC_TIMEOUT) || 12000; /* ms; configurável, fallback seguro */
export const LOGO     = ENCANTO_LOGO || '';

/* -- Cliente Supabase -- */
export let db = null;
try {
  db = createClient(SUPA_URL, SUPA_KEY, {
    // detectSessionInUrl:false -> admin usa signInWithPassword (sem redirect); NAO pode capturar/queimar
    // o ?code= do OAuth do cliente. So o dbCliente conclui o OAuth. (LOGIN-ARCH-02.2)
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  console.log('[Encanto] Supabase client criado');
} catch (e) {
  console.warn('[Encanto] Supabase init erro:', e && e.message);
  db = null;
}
