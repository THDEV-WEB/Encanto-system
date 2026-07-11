/* providers/AuthProvider.jsx — ESTADO do usuario cliente + ciclo de sessao (AUTH-01).
   Envolve SOMENTE a arvore da loja (nunca o Admin). Consome AuthService (service). NAO faz fetch de
   catalogo/carrinho, NAO conhece pricing/addons/pedido. Expoe {status, isLogged, user, entrar,
   confirmarCodigo, sair}. Vinculo Auth->Customer entra na Onda 3. */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AuthContext } from '../contexts/AuthContext.js';
import { AuthService } from '../services/AuthService.js';

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [status,  setStatus]  = useState('loading'); // loading | anon | logged
  const linkedUidRef = useRef(null); // vinculo Auth->Customer feito 1x por sessao (RPC ja e idempotente)

  /* AUTH-01 · Onda 3: apos login, vincula a conta ao customer por telefone (nunca duplica).
     O phone verificado vem em session.user.phone (E.164 sem '+'); a RPC reduz p/ o formato local. */
  const tentarVincular = useCallback((s) => {
    const uid = s?.user?.id;
    const phone = s?.user?.phone;
    if (!uid || !phone) return;
    if (linkedUidRef.current === uid) return;
    linkedUidRef.current = uid;
    AuthService.linkCustomer(phone)
      .then(r => { if (r?.error) console.warn('[AUTH-01] link_customer_to_auth:', r.error.message); })
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

  const entrar          = useCallback((phone)        => AuthService.signInWithOtp(phone), []);
  const confirmarCodigo = useCallback((phone, token) => AuthService.verifyOtp(phone, token), []);
  const sair            = useCallback(()             => AuthService.signOut(), []);

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    status,
    isLogged: status === 'logged',
    disponivel: AuthService.disponivel(),
    entrar, confirmarCodigo, sair,
  }), [session, status, entrar, confirmarCodigo, sair]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
