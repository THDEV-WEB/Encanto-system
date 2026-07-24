/* lib/dbCliente.js — instancia Supabase DEDICADA a sessao do CLIENTE (AUTH-01).
   SEPARADA de lib/supabase.js (`db` = dados/admin): storageKey proprio (constants/authStorage.js,
   REF-ADMIN-03 · Onda 2 centraliza as 2 chaves — antes só esta tinha uma explícita) garante que a
   sessao do CLIENTE e a do ADMIN NUNCA se misturam nem se deslogam mutuamente.
   Reusa SUPA_URL/SUPA_KEY (mesma config; fonte unica). Modo degradado (dbCliente=null) espelha o de
   `db`: sem env -> null, e a loja de VISITANTE nunca quebra por causa disso. */
import { createClient } from '@supabase/supabase-js';
import { SUPA_URL, SUPA_KEY } from './supabase.js';
import { CLIENTE_AUTH_STORAGE_KEY } from '../constants/authStorage.js';

export let dbCliente = null;
try {
  if (SUPA_URL && SUPA_KEY) {
    dbCliente = createClient(SUPA_URL, SUPA_KEY, {
      auth: {
        storageKey: CLIENTE_AUTH_STORAGE_KEY,   // isolamento total da sessao do admin (db)
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,   // ESTA instancia inicia o OAuth (Google) -> precisa capturar o ?code=
        flowType: 'pkce',           // do retorno, trocar por sessao e PERSISTIR. (LOGIN-ARCH-02.2: corrige F5)
      },
    });
    console.log('[Encanto] dbCliente (sessao de cliente) criado');
  }
} catch (e) {
  console.warn('[Encanto] dbCliente init erro:', e && e.message);
  dbCliente = null;
}
/* REF-BOOT-02 v2 checkpoint (guardado; no-op fora do browser/coletor). */
try { if (typeof window !== 'undefined' && window.__ENC_BOOT__ && window.__ENC_BOOT__.step) window.__ENC_BOOT__.step('CP-dbcliente', dbCliente ? 'dbCliente criado' : 'dbCliente degradado (null)'); } catch { /* noop */ }
