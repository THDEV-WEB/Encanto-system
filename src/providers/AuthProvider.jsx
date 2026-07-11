/* providers/AuthProvider.jsx — ESTADO do usuario cliente + ciclo de sessao (AUTH-01).
   Envolve SOMENTE a arvore da loja (nunca o Admin). Consome AuthService (service). NAO faz fetch de
   catalogo/carrinho, NAO conhece pricing/addons/pedido. Expoe {status, isLogged, user, entrar,
   confirmarCodigo, sair}. Vinculo Auth->Customer entra na Onda 3. */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { AuthContext } from '../contexts/AuthContext.js';
import { AuthService } from '../services/AuthService.js';

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [status,  setStatus]  = useState('loading'); // loading | anon | logged

  useEffect(() => {
    let vivo = true;
    AuthService.getSession().then(s => {
      if (!vivo) return;
      setSession(s);
      setStatus(s ? 'logged' : 'anon');
    });
    const off = AuthService.onAuthStateChange((_evento, s) => {
      setSession(s);
      setStatus(s ? 'logged' : 'anon');
    });
    return () => { vivo = false; off && off(); };
  }, []);

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
