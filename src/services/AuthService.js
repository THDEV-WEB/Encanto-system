/* services/AuthService.js — DOMINIO de autenticacao do CLIENTE (LOGIN-ARCH-02.1).
   Credencial: Google OAuth + e-mail (OTP). IDENTIDADE do cliente = TELEFONE (coletado no 1o acesso;
   e-mail e atributo). Vinculo HIBRIDO por telefone via RPC link_customer_to_auth(phone,email,name).
   NAO importa React/JSX, NAO importa DataService de pedidos, NAO importa pricing/addons/format. */
import { dbCliente } from '../lib/dbCliente.js';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App as CapacitorApp } from '@capacitor/app';
import { buildStorefrontRpcParam, getResolvedStoreId } from './storefrontStore.js'; // REF-SAAS-01 · Onda 6.1: {}/null ate resolver, {p_store_id}/id da loja resolvida por dominio

const semAuth = () => ({ data: null, error: { message: 'auth indisponivel (offline)' } });

/* REF-CAP-01 · Onda 4 (D5): esquema de deep link do login Google nativo. Precisa casar EXATAMENTE com o
   intent-filter de android/app/src/main/AndroidManifest.xml e com a entrada correspondente no allow-list
   de Redirect URLs do Supabase Auth (passo do dono, fora do codigo). */
const DEEP_LINK_LOGIN = 'br.com.valionsistemas.encanto://login-callback';

/* REF-CAP-01 · Onda 4 (D5): Google bloqueia OAuth dentro de WebView embutida (politica anti-webview desde
   2021) — dentro do Capacitor o login precisa abrir no navegador do SISTEMA (Custom Tabs), nao na WebView
   do app. `skipBrowserRedirect:true` faz o supabase-js devolver a URL de consentimento em vez de tentar
   navegar sozinho (`window.location.href=`), que e' o comportamento certo pro browser mas nao existe
   aqui. A volta e' capturada via deep link (appUrlOpen) — nunca por `detectSessionInUrl` (que so' funciona
   quando o proprio WebView navega pra URL com ?code=, o que nao acontece nesse fluxo). `flowType:'pkce'`
   (ja ligado em lib/dbCliente.js) e' o que permite trocar o `code` por sessao manualmente, fora do fluxo
   automatico. */
async function signInWithGoogleNativo() {
  const { data, error } = await dbCliente.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: DEEP_LINK_LOGIN, skipBrowserRedirect: true },
  });
  if (error || !data?.url) return { data: null, error: error ?? { message: 'nao foi possivel iniciar o login Google' } };

  return new Promise((resolve) => {
    let concluido = false;
    let handleDeepLink;
    let handleBrowserFechou;
    const finalizar = (resultado) => {
      if (concluido) return; // appUrlOpen fecha o Browser -> browserFinished tambem dispara; só o 1º resultado vale
      concluido = true;
      handleDeepLink?.remove();
      handleBrowserFechou?.remove();
      resolve(resultado);
    };

    CapacitorApp.addListener('appUrlOpen', async ({ url }) => {
      if (!url || !url.startsWith(DEEP_LINK_LOGIN)) return; // outro deep link (nao e' o do login) -> ignora
      try { await Browser.close(); } catch { /* noop */ }
      let code = null;
      try { code = new URL(url).searchParams.get('code'); } catch { /* url malformada -> code fica null */ }
      if (!code) { finalizar({ data: null, error: { message: 'retorno do Google sem codigo' } }); return; }
      const resultado = await dbCliente.auth.exchangeCodeForSession(code);
      finalizar(resultado);
    }).then((h) => { handleDeepLink = h; });

    Browser.addListener('browserFinished', () => {
      finalizar({ data: null, error: { message: 'login cancelado' } });
    }).then((h) => { handleBrowserFechou = h; });

    Browser.open({ url: data.url });
  });
}

export const AuthService = {
  disponivel: () => !!dbCliente,

  async getSession() {
    if (!dbCliente) return null;
    const { data } = await dbCliente.auth.getSession();
    return data?.session ?? null;
  },

  onAuthStateChange(cb) {
    if (!dbCliente) return () => {};
    const { data } = dbCliente.auth.onAuthStateChange((evento, session) => cb(evento, session));
    return () => data?.subscription?.unsubscribe?.();
  },

  /* Credenciais (Google / e-mail OTP). */
  async signInWithGoogle() {
    if (!dbCliente) return semAuth();
    // REF-CAP-01 · Onda 4 (D5): dentro do Capacitor, o redirect de browser abaixo e' bloqueado pelo
    // proprio Google (WebView embutida) — precisa do fluxo nativo (Browser do sistema + deep link).
    if (Capacitor.isNativePlatform()) return signInWithGoogleNativo();
    /* REF-BRAND-01: origin sozinho volta pra raiz do dominio (landing), nao pro app — app agora vive
       sob /encanto/. BASE_URL (injetado pelo Vite a partir de `base` em vite.config.js) fecha o
       caminho de volta certo. Precisa estar na allow-list de Redirect URLs do Supabase Auth. */
    const redirectTo = typeof window !== 'undefined'
      ? window.location.origin + import.meta.env.BASE_URL
      : undefined;
    return dbCliente.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
  },
  async signInWithEmailOtp(email) {
    if (!dbCliente) return semAuth();
    return dbCliente.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  },
  async verifyEmailOtp(email, token) {
    if (!dbCliente) return semAuth();
    return dbCliente.auth.verifyOtp({ email, token, type: 'email' });
  },
  async signOut() {
    if (!dbCliente) return semAuth();
    return dbCliente.auth.signOut();
  },

  /* Meu customer — SEMPRE filtrado pelo proprio auth_user_id. Nao depende so da RLS: is_admin() enxerga
     TODOS os customers, entao um .limit(1) sem filtro traria linha alheia (nome bugado apos F5). (fix 02.2)
     REF-SAAS-01 · Onda 6.1: a RLS ("Cliente le proprio customer") deixou de ancorar em
     default_store_id() -- a mesma pessoa pode ter customer em varias lojas (ADR §2), entao SEM o
     .eq('store_id',...) aqui o resultado voltaria a ser ambiguo (2+ linhas, .limit(1) sem ORDER BY
     nao e deterministico). Enquanto a loja ainda nao resolveu (id null), nao filtra -- mesmo
     comportamento de sempre (so existe 1 customer por pessoa hoje, no unico dominio real). */
  async getMeuCustomer(userId) {
    if (!dbCliente || !userId) return null;
    const storefrontId = getResolvedStoreId();
    let q = dbCliente.from('customers').select('id,name,phone,email').eq('auth_user_id', userId);
    if (storefrontId) q = q.eq('store_id', storefrontId);
    const { data } = await q.limit(1).maybeSingle();
    return data ?? null;
  },

  /* Espelha o nome no metadata do Auth: fallback reload-safe (nomeExibicao usa full_name se o customer
     vier vazio/lento na restauracao da sessao). Best-effort — nunca bloqueia o cadastro. */
  async atualizarNome(nome) {
    if (!dbCliente || !nome?.trim()) return;
    try { await dbCliente.auth.updateUser({ data: { full_name: nome.trim() } }); } catch { /* best-effort */ }
  },

  /* Vinculo HIBRIDO: telefone e a identidade; email/nome sao atributos. Idempotente, nunca duplica. */
  async linkCustomer(phone, email, nome) {
    if (!dbCliente) return semAuth();
    return dbCliente.rpc('link_customer_to_auth', { p_phone: phone, p_email: email ?? null, p_name: nome ?? null, ...buildStorefrontRpcParam() });
  },

  /* REF-CLIENTE-03 (Minha Conta): troca de e-mail pelo fluxo OFICIAL do Supabase Auth. Envia link de
     confirmacao ao novo e-mail (e ao atual, se "Secure email change" ligado); so efetiva quando o
     usuario confirma. Nao cria fluxo paralelo. Retorna {data,error} do proprio updateUser. */
  async atualizarEmail(email) {
    if (!dbCliente) return semAuth();
    const e = (email || '').trim().toLowerCase();
    if (!/.+@.+\..+/.test(e)) return { data: null, error: { message: 'e-mail invalido' } };
    return dbCliente.auth.updateUser({ email: e });
  },
};
