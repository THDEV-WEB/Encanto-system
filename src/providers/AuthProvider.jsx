/* providers/AuthProvider.jsx — ESTADO do usuario cliente + ciclo de sessao (LOGIN-ARCH-02.1).
   Credencial Google/e-mail; IDENTIDADE = TELEFONE. Envolve SOMENTE a arvore da loja (nunca o Admin).
   Apos login, carrega o customer proprio: se ainda nao tem telefone -> precisaTelefone (1o acesso).
   Expoe {status, isLogged, user, customer, precisaTelefone, entrarComGoogle, enviarEmail,
   confirmarEmail, completarCadastro, sair}. */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { AuthContext } from '../contexts/AuthContext.js';
import { AuthService } from '../services/AuthService.js';
import { setUsuario, limparUsuario } from '../lib/sentry.js'; // REF-OBS-01: no-op sem VITE_SENTRY_DSN

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [status,  setStatus]  = useState('loading'); // loading | anon | logged
  const [customer, setCustomer] = useState(null);
  const [precisaTelefone, setPrecisaTelefone] = useState(false);

  const carregarCustomer = useCallback(async (s) => {
    if (!s?.user) { setCustomer(null); setPrecisaTelefone(false); limparUsuario(); return; }
    const cust = await AuthService.getMeuCustomer(s.user.id);
    setCustomer(cust);
    setPrecisaTelefone(!cust?.phone);   // 1o acesso (sem telefone) -> pedir telefone uma vez
    // Só id + role — nunca telefone/nome/e-mail do cliente (PII) chegam ao Sentry.
    setUsuario(cust?.id ?? s.user.id, { role: 'cliente' });
  }, []);

  useEffect(() => {
    let vivo = true;
    /* REF-BOOT-02 v2: checkpoints da sessao (pos-commit). Se getSession-start aparece mas getSession-done
       nao, a restauracao de sessao travou (ex.: crypto/localStorage do gotrue no WebView). Guardado/no-op. */
    const cp = (c, m) => { try { if (typeof window !== 'undefined' && window.__ENC_BOOT__ && window.__ENC_BOOT__.step) window.__ENC_BOOT__.step(c, m); } catch { /* noop */ } };
    cp('CP-auth-getSession-start', 'AuthProvider: getSession()');
    AuthService.getSession().then(async s => {
      if (!vivo) return;
      cp('CP-auth-getSession-done', s ? 'sessao restaurada' : 'sem sessao (anon)');
      setSession(s); setStatus(s ? 'logged' : 'anon');
      await carregarCustomer(s);
    });
    /* REF-CLIENTE-03 (fix restauracao de perfil pos-login): o callback do onAuthStateChange roda DENTRO
       do lock de auth do gotrue-js (_notifyAllSubscribers faz `await cb()` dentro do _acquireLock que
       verifyOtp/OAuth seguram). Se aqui a gente AWAIT-ar uma query .from() (carregarCustomer -> getMeuCustomer),
       o request re-entra no lock p/ pegar o token (getSession) e fica enfileirado no MESMO lock -> DEADLOCK:
       o customer nunca carrega ate um F5 (que carrega via getSession() de montagem, FORA do lock). Solucao
       oficial Supabase: NAO await Supabase dentro do callback; sincroniza o estado leve (session/status) na
       hora e DEFERE a carga do customer p/ um task novo, fora do lock -> perfil aparece na hora, sem F5. */
    const off = AuthService.onAuthStateChange((_evento, s) => {
      setSession(s); setStatus(s ? 'logged' : 'anon');
      setTimeout(() => { if (vivo) carregarCustomer(s); }, 0);
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

  /* REF-CLIENTE-03 (Minha Conta): edicao de perfil do cliente JA cadastrado. Reusa o vinculo hibrido
     por telefone (link_customer_to_auth, SECURITY DEFINER, escopo auth.uid()) -> ATUALIZA o MESMO
     customer (mesmo id/auth_user_id) sem criar novo nem quebrar pedidos/historico. Roda em handler de
     acao do usuario (fora do lock de auth), entao pode await-ar a recarga do customer sem risco. */
  const atualizarPerfil = useCallback(async (nome, telefone) => {
    const email = session?.user?.email ?? null;
    const r = await AuthService.linkCustomer(telefone, email, nome);
    if (!r?.error && r?.data?.ok !== false) {
      await AuthService.atualizarNome(nome);   // espelha o nome no metadata (fallback reload-safe)
      await carregarCustomer(session);         // sincroniza a UI na hora
    }
    return r;
  }, [session, carregarCustomer]);

  const atualizarEmail = useCallback((email) => AuthService.atualizarEmail(email), []);

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    status,
    isLogged: status === 'logged',
    disponivel: AuthService.disponivel(),
    customer,
    precisaTelefone,
    entrarComGoogle, enviarEmail, confirmarEmail, completarCadastro, atualizarPerfil, atualizarEmail, sair,
  }), [session, status, customer, precisaTelefone, entrarComGoogle, enviarEmail, confirmarEmail, completarCadastro, atualizarPerfil, atualizarEmail, sair]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
