/* services/AuthService.js — DOMINIO de autenticacao do CLIENTE (LOGIN-ARCH-02.1).
   Credencial: Google OAuth + e-mail (OTP). IDENTIDADE do cliente = TELEFONE (coletado no 1o acesso;
   e-mail e atributo). Vinculo HIBRIDO por telefone via RPC link_customer_to_auth(phone,email,name).
   NAO importa React/JSX, NAO importa DataService de pedidos, NAO importa pricing/addons/format. */
import { dbCliente } from '../lib/dbCliente.js';

const semAuth = () => ({ data: null, error: { message: 'auth indisponivel (offline)' } });

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
    return dbCliente.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined },
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
     TODOS os customers, entao um .limit(1) sem filtro traria linha alheia (nome bugado apos F5). (fix 02.2) */
  async getMeuCustomer(userId) {
    if (!dbCliente || !userId) return null;
    const { data } = await dbCliente.from('customers').select('id,name,phone,email').eq('auth_user_id', userId).limit(1).maybeSingle();
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
    return dbCliente.rpc('link_customer_to_auth', { p_phone: phone, p_email: email ?? null, p_name: nome ?? null });
  },
};
