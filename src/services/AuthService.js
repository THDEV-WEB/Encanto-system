/* services/AuthService.js — DOMINIO de autenticacao do CLIENTE (AUTH-01 · LOGIN-ARCH-02).
   Metodo: Google OAuth + e-mail (OTP por e-mail). Phone OTP REMOVIDO. Responsabilidade UNICA:
   falar com dbCliente.auth + vincular a conta ao customer POR E-MAIL (RPC link_customer_to_auth_email).
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

  /* Google OAuth — redireciona e volta para a mesma origem. */
  async signInWithGoogle() {
    if (!dbCliente) return semAuth();
    return dbCliente.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined },
    });
  },

  /* E-mail OTP — envia o codigo/magic link para o e-mail. */
  async signInWithEmailOtp(email) {
    if (!dbCliente) return semAuth();
    return dbCliente.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  },

  /* E-mail OTP — confirma o codigo -> cria a sessao do cliente. */
  async verifyEmailOtp(email, token) {
    if (!dbCliente) return semAuth();
    return dbCliente.auth.verifyOtp({ email, token, type: 'email' });
  },

  async signOut() {
    if (!dbCliente) return semAuth();
    return dbCliente.auth.signOut();
  },

  /* Vinculo Auth->Customer por E-MAIL (idempotente, no banco; usa auth.uid()). Nunca duplica. */
  async linkCustomer(email) {
    if (!dbCliente) return semAuth();
    return dbCliente.rpc('link_customer_to_auth_email', { p_email: email });
  },
};
