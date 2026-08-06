/* lib/supabase.js — singleton de I/O + configuração de ambiente (REF-APP-01 · Onda 1)
   Move puro do topo de App.jsx: SUPA_URL/KEY, RPC_TIMEOUT, LOGO e o cliente Supabase `db`.
   REF-COMPANY-01: WHATSAPP (env var + fallback hardcoded) foi RETIRADO daqui — o numero oficial da loja
   agora vem exclusivamente de settings.company_info via useCompanyInfo()/get_company_info() (fonte unica
   administravel pelo Admin, sem depender de variavel de ambiente nem de redeploy).
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

/* -- Config (via variaveis de ambiente VITE_*) --
   REF-ADDRESS-02 · Onda 4: `import.meta.env` só existe sob o Vite (dev/build) — scripts Node puros que
   importem este módulo de verdade (não só análise estática de texto) travavam no module-eval, antes até
   do try/catch de baixo poder agir. A guarda preserva o padrão LITERAL `import.meta.env.VITE_X` em cada
   ramo (é o que o Vite substitui estaticamente no build) — só decide qual ramo roda, zero mudança de
   comportamento onde import.meta.env já existe (dev/build reais). */
const TEM_VITE_ENV = typeof import.meta.env !== 'undefined';
export const SUPA_URL = TEM_VITE_ENV ? import.meta.env.VITE_SUPABASE_URL : undefined;
export const SUPA_KEY = TEM_VITE_ENV ? import.meta.env.VITE_SUPABASE_KEY : undefined;
export const RPC_TIMEOUT = Number(TEM_VITE_ENV ? import.meta.env.VITE_RPC_TIMEOUT : undefined) || 12000; /* ms; configurável, fallback seguro */
/* REF-AUDIT-01: era base64 em logo.js (inflava o bundle JS ~46KB) -> arquivo em /public, cacheavel.
   REF-BRAND-01: prefixado com BASE_URL (não mais '/logo.jpg' fixo) -> continua correto agora que o
   app é servido sob /encanto/ (Vite injeta BASE_URL no build; TEM_VITE_ENV cobre os scripts Node que
   importam este módulo fora do Vite, mesmo padrão das constantes acima).
   REF-PERF-01: .webp (scripts/optimize-static-images.mjs) — 45,9KB -> 11,3KB, mesma imagem/qualidade,
   redimensionada pro tamanho real exibido (≤147px). Original .jpg preservado em public/. */
export const LOGO     = `${TEM_VITE_ENV ? import.meta.env.BASE_URL : '/'}logo.webp`;

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
