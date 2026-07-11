/* services/AuthService.js — DOMINIO de autenticacao do CLIENTE (AUTH-01).
   Responsabilidade UNICA: falar com dbCliente.auth (Phone OTP) + vincular a conta ao customer por
   telefone (RPC link_customer_to_auth). NAO importa React/JSX, NAO importa DataService de pedidos,
   NAO importa pricing/addons/format nem o dominio de pedido. Camada services: folha de auth. */
import { dbCliente } from '../lib/dbCliente.js';

const semAuth = () => ({ data: null, error: { message: 'auth indisponivel (offline)' } });

export const AuthService = {
  disponivel: () => !!dbCliente,

  async getSession() {
    if (!dbCliente) return null;
    const { data } = await dbCliente.auth.getSession();
    return data?.session ?? null;
  },

  /* Assina mudancas de sessao; devolve funcao para cancelar. */
  onAuthStateChange(cb) {
    if (!dbCliente) return () => {};
    const { data } = dbCliente.auth.onAuthStateChange((evento, session) => cb(evento, session));
    return () => data?.subscription?.unsubscribe?.();
  },

  /* Phone OTP: envia o SMS com o codigo. */
  async signInWithOtp(phone) {
    if (!dbCliente) return semAuth();
    return dbCliente.auth.signInWithOtp({ phone });
  },

  /* Phone OTP: confirma o codigo -> cria a sessao do cliente. */
  async verifyOtp(phone, token) {
    if (!dbCliente) return semAuth();
    return dbCliente.auth.verifyOtp({ phone, token, type: 'sms' });
  },

  async signOut() {
    if (!dbCliente) return semAuth();
    return dbCliente.auth.signOut();
  },

  /* Vinculo Auth->Customer por telefone (idempotente, no banco; usa auth.uid() da sessao do cliente).
     Chamado apos o login na Onda 3. Nunca duplica customer. */
  async linkCustomer(phone) {
    if (!dbCliente) return semAuth();
    return dbCliente.rpc('link_customer_to_auth', { p_phone: phone });
  },
};
