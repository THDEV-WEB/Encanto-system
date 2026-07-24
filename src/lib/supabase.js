/* lib/supabase.js — singleton de I/O + configuração de ambiente (REF-APP-01 · Onda 1)
   Move puro do topo de App.jsx: SUPA_URL/KEY, WHATSAPP, RPC_TIMEOUT, LOGO e o cliente Supabase `db`.
   Regra-trava: createClient ÚNICO (nunca repetir — senão 2 sessões auth); modo degradado db=null preservado.
   `export let db` = binding vivo: o try/catch reatribui no load do módulo; importadores enxergam o valor final.

   REF-ADMIN-03 · Onda 2: `db` (sessão do Admin) não tinha `storageKey` explícito — ao contrário de
   `dbCliente` (que sempre teve o seu), dependia da chave DEFAULT que o supabase-js deriva da própria
   URL (`sb-<ref>-auth-token`, formato interno/não documentado da lib) — useAdminSession.js e os specs
   de E2E tinham cada um sua PRÓPRIA cópia da lógica de derivar essa chave a partir da URL (dependência
   implícita espalhada, exatamente o que esta onda elimina). Agora `db` usa a MESMA estratégia de
   `dbCliente`: chave explícita, centralizada em constants/authStorage.js (fonte única, também
   importável por specs Node puros). `migrarChaveSessaoAdminLegada()` roda 1x no load do módulo — ANTES
   do createClient — para que uma sessão de Admin já salva sob a chave antiga (default) continue válida
   após o deploy, sem forçar relogin (só copia; se não achar a chave antiga, é um no-op instantâneo —
   não atrasa o boot de ninguém). */
import { createClient } from '@supabase/supabase-js';
import { ADMIN_AUTH_STORAGE_KEY } from '../constants/authStorage.js';

/* -- Config (via variaveis de ambiente VITE_*) -- */
export const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPA_KEY = import.meta.env.VITE_SUPABASE_KEY;
export const WHATSAPP = import.meta.env.VITE_WHATSAPP || '5538992203620';
export const RPC_TIMEOUT = Number(import.meta.env.VITE_RPC_TIMEOUT) || 12000; /* ms; configurável, fallback seguro */
export const LOGO     = '/logo.jpg'; /* REF-AUDIT-01: era base64 em logo.js (inflava o bundle JS ~46KB) -> arquivo em /public, cacheavel */

/* Migração 1x: uma sessão de Admin salva ANTES desta onda vive sob a chave default do supabase-js
   (sb-<ref>-auth-token) — nunca reconstruída via URL aqui (dependência implícita é exatamente o que
   estamos eliminando); em vez disso varre as chaves do localStorage por QUALQUER uma nesse formato
   (dbCliente nunca usa esse formato, sempre teve chave própria — sem risco de colisão). */
function migrarChaveSessaoAdminLegada() {
  if (typeof window === 'undefined') return;
  try {
    if (window.localStorage.getItem(ADMIN_AUTH_STORAGE_KEY)) return; // já na chave nova — nada a fazer
    for (let i = 0; i < window.localStorage.length; i++) {
      const chave = window.localStorage.key(i);
      if (chave && chave.startsWith('sb-') && chave.endsWith('-auth-token')) {
        const valor = window.localStorage.getItem(chave);
        if (valor) window.localStorage.setItem(ADMIN_AUTH_STORAGE_KEY, valor);
        window.localStorage.removeItem(chave);
        break;
      }
    }
  } catch { /* noop — pior caso, o Admin loga de novo (mesmo custo de hoje sem storageKey nenhum) */ }
}
migrarChaveSessaoAdminLegada();

/* -- Cliente Supabase -- */
export let db = null;
try {
  db = createClient(SUPA_URL, SUPA_KEY, {
    // detectSessionInUrl:false -> admin usa signInWithPassword (sem redirect); NAO pode capturar/queimar
    // o ?code= do OAuth do cliente. So o dbCliente conclui o OAuth. (LOGIN-ARCH-02.2)
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: ADMIN_AUTH_STORAGE_KEY },
  });
  console.log('[Encanto] Supabase client criado');
} catch (e) {
  console.warn('[Encanto] Supabase init erro:', e && e.message);
  db = null;
}
/* REF-BOOT-02 v2 checkpoint (guardado; no-op fora do browser/coletor). Prova que o module-eval passou por aqui. */
try { if (typeof window !== 'undefined' && window.__ENC_BOOT__ && window.__ENC_BOOT__.step) window.__ENC_BOOT__.step('CP-supabase', db ? 'db client criado' : 'db degradado (null)'); } catch { /* noop */ }
