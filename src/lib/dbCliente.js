/* lib/dbCliente.js — instancia Supabase DEDICADA a sessao do CLIENTE (AUTH-01).
   SEPARADA de lib/supabase.js (`db` = dados/admin): storageKey proprio ('encanto-cliente-auth')
   garante que a sessao do CLIENTE e a do ADMIN NUNCA se misturam nem se deslogam mutuamente.
   Reusa SUPA_URL/SUPA_KEY (mesma config; fonte unica). Modo degradado (dbCliente=null) espelha o de
   `db`: sem env -> null, e a loja de VISITANTE nunca quebra por causa disso. */
import { createClient } from '@supabase/supabase-js';
import { SUPA_URL, SUPA_KEY } from './supabase.js';

export let dbCliente = null;
try {
  if (SUPA_URL && SUPA_KEY) {
    dbCliente = createClient(SUPA_URL, SUPA_KEY, {
      auth: {
        storageKey: 'encanto-cliente-auth',   // isolamento total da sessao do admin (db)
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
    console.log('[Encanto] dbCliente (sessao de cliente) criado');
  }
} catch (e) {
  console.warn('[Encanto] dbCliente init erro:', e && e.message);
  dbCliente = null;
}
