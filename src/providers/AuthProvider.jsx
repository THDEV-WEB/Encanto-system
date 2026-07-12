/* providers/AuthProvider.jsx — ESTADO do usuario cliente + ciclo de sessao (AUTH-01 · LOGIN-ARCH-02).
   Metodo: Google OAuth + e-mail. Envolve SOMENTE a arvore da loja (nunca o Admin). Consome AuthService.
   Expoe {status, isLogged, user, entrarComGoogle, enviarEmail, confirmarEmail, sair}.
   Vinculo Auth->Customer por E-MAIL apos login (idempotente; nunca duplica). */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AuthContext } from '../contexts/AuthContext.js';
import { AuthService } from '../services/AuthService.js';

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [status,  setStatus]  = useState('loading'); // loading | anon | logged
  const linkedUidRef = useRef(null); // vinculo feito 1x por sessao (a RPC ja e idempotente)

  /* LOGIN-ARCH-02: apos login, vincula a conta ao customer POR E-MAIL (nunca duplica). */
  const tentarVincular = useCallback((s) => {
    const uid = s?.user?.id;
    const email = s?.user?.email;
    if (!uid || !email) return;
    if (linkedUidRef.current === uid) return;
    linkedUidRef.current = uid;
    AuthService.linkCustomer(email)
      .then(r => { if (r?.error) console.warn('[LOGIN-ARCH-02] link_customer_to_auth_email:', r.error.message); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let vivo = true;
    AuthService.getSession().then(s => {
      if (!vivo) return;
      setSession(s);
      setStatus(s ? 'logged' : 'anon');
      if (s) tentarVincular(s);
    });
    const off = AuthService.onAuthStateChange((_evento, s) => {
      setSession(s);
      setStatus(s ? 'logged' : 'anon');
      if (s) tentarVincular(s); else linkedUidRef.current = null;
    });
    return () => { vivo = false; off && off(); };
  }, [tentarVincular]);

  const entrarComGoogle = useCallback(()             => AuthService.signInWithGoogle(), []);
  const enviarEmail     = useCallback((email)        => AuthService.signInWithEmailOtp(email), []);
  const confirmarEmail  = useCallback((email, token) => AuthService.verifyEmailOtp(email, token), []);
  const sair            = useCallback(()             => AuthService.signOut(), []);

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    status,
    isLogged: status === 'logged',
    disponivel: AuthService.disponivel(),
    entrarComGoogle, enviarEmail, confirmarEmail, sair,
  }), [session, status, entrarComGoogle, enviarEmail, confirmarEmail, sair]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
