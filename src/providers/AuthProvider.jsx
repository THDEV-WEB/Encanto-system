/* providers/AuthProvider.jsx — ESTADO do usuario cliente + ciclo de sessao (LOGIN-ARCH-02.1).
   Credencial Google/e-mail; IDENTIDADE = TELEFONE. Envolve SOMENTE a arvore da loja (nunca o Admin).
   Apos login, carrega o customer proprio: se ainda nao tem telefone -> precisaTelefone (1o acesso).
   Expoe {status, isLogged, user, customer, precisaTelefone, entrarComGoogle, enviarEmail,
   confirmarEmail, completarCadastro, sair}. */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { AuthContext } from '../contexts/AuthContext.js';
import { AuthService } from '../services/AuthService.js';

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [status,  setStatus]  = useState('loading'); // loading | anon | logged
  const [customer, setCustomer] = useState(null);
  const [precisaTelefone, setPrecisaTelefone] = useState(false);

  const carregarCustomer = useCallback(async (s) => {
    if (!s?.user) { setCustomer(null); setPrecisaTelefone(false); return; }
    const cust = await AuthService.getMeuCustomer(s.user.id);
    setCustomer(cust);
    setPrecisaTelefone(!cust?.phone);   // 1o acesso (sem telefone) -> pedir telefone uma vez
  }, []);

  useEffect(() => {
    let vivo = true;
    AuthService.getSession().then(async s => {
      if (!vivo) return;
      setSession(s); setStatus(s ? 'logged' : 'anon');
      await carregarCustomer(s);
    });
    const off = AuthService.onAuthStateChange(async (_evento, s) => {
      setSession(s); setStatus(s ? 'logged' : 'anon');
      await carregarCustomer(s);
    });
    return () => { vivo = false; off && off(); };
  }, [carregarCustomer]);

  const entrarComGoogle = useCallback(()             => AuthService.signInWithGoogle(), []);
  const enviarEmail     = useCallback((email)        => AuthService.signInWithEmailOtp(email), []);
  const confirmarEmail  = useCallback((email, token) => AuthService.verifyEmailOtp(email, token), []);
  const sair            = useCallback(async () => { const r = await AuthService.signOut(); setCustomer(null); setPrecisaTelefone(false); return r; }, []);

  /* 1o acesso: nome + telefone -> vinculo hibrido (por telefone). */
  const completarCadastro = useCallback(async (nome, telefone) => {
    const email = session?.user?.email ?? null;
    const r = await AuthService.linkCustomer(telefone, email, nome);
    if (!r?.error && r?.data?.ok !== false) {
      await AuthService.atualizarNome(nome);   // espelha o nome no metadata (fallback reload-safe)
      await carregarCustomer(session);
    }
    return r;
  }, [session, carregarCustomer]);

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    status,
    isLogged: status === 'logged',
    disponivel: AuthService.disponivel(),
    customer,
    precisaTelefone,
    entrarComGoogle, enviarEmail, confirmarEmail, completarCadastro, sair,
  }), [session, status, customer, precisaTelefone, entrarComGoogle, enviarEmail, confirmarEmail, completarCadastro, sair]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
