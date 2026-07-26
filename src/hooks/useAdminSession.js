/* hooks/useAdminSession.js — REF-ADMIN-01 · Onda 2 (sessão do Admin) + REF-STABILITY-02 (acesso ao
   Admin como escolha EXPLÍCITA — sessão nunca mais promove sozinha, nem via engrenagem/hash).
   Move puro do gate de acesso que vivia em App.jsx (mode/hash), + fix do achado real (ADR/memória
   REF-E2E-03 Onda 1): não existia logout de verdade — "Sair" só trocava de tela, nunca chamava
   db.auth.signOut(). Espelha o padrão já usado por AuthProvider/AuthService (sessão do CLIENTE, via
   `dbCliente`) só na PARTE de detectar encerramento de sessão (onAuthStateChange) — sem
   "carregarCustomer" (Admin não tem perfil de cliente) e sem provider próprio, porque só App.jsx
   consome isto.

   Dois botões de saída, dois comportamentos (achado REF-E2E-03 §1.2: antes eram o MESMO handler):
   - `verLoja()`  → "← Ver loja": só troca de tela, sessão do Supabase permanece válida (persistência
     normal — reutilizável na próxima vez que o usuário clicar em "Entrar").
   - `sair()`     → "Sair" (sidebar): chama db.auth.signOut() de verdade — a sessão deixa de existir,
     "Entrar" volta a exigir e-mail/senha.

   STORAGE KEY (REF-ADMIN-03 · Onda 2): `db` tem storageKey explícito (constants/authStorage.js, mesma
   ideia que `dbCliente` já usava) — nunca reconstrói o formato default do supabase-js a partir da URL.

   REF-STABILITY-02 — MUDANÇA DE COMPORTAMENTO (decisão do dono, substitui REF-AUTH-02/REF-ADMIN-02/
   REF-STABILITY-01 nesta parte específica): a persistência de sessão do Supabase continua normal (um
   login válido sobrevive a um F5), mas ela NUNCA MAIS decide sozinha qual tela aparece — nem na
   abertura do app, nem num F5, nem ao entrar no fluxo admin (engrenagem/hash). O único gatilho que
   consulta/reaproveita a sessão salva é o clique explícito em "Entrar" (AdminLogin.jsx): se houver uma
   sessão válida E autorizada (is_admin()), entra direto, sem pedir credencial de novo; caso contrário,
   segue o login normal por e-mail/senha. Por isso este hook NÃO tem mais:
   - um 3º estado 'checking' (não existe mais "F5 dentro do painel continua no painel automaticamente"
     — todo bootstrap, sem exceção, começa em 'store'; só muda de tela por ação do usuário);
   - `verificandoSessao` (existia só para esconder o formulário enquanto uma verificação em BACKGROUND
     acontecia — não há mais verificação em background nenhuma);
   - a flag de sessionStorage "já entrou no fluxo admin nesta aba" (ADMIN_FLOW_SESSION_KEY/REF-AUTH-02)
     e nenhum getSession() automático no mount — a sessão só é CONSULTADA no momento do clique em
     "Entrar", nunca antes.
   `onAuthStateChange` permanece, mas só para REAGIR (nunca promover): se a sessão cair enquanto o
   Admin está aberto (logout em outra aba, refresh token revogado), volta pra Loja; se um token for
   renovado enquanto já em 'admin', só atualiza os dados da sessão guardada — nunca promove mode. */
import { useState, useEffect, useCallback } from 'react';
import { db } from '../lib/supabase.js';
import { setUsuario, limparUsuario, marcarArea } from '../lib/sentry.js'; // REF-OBS-01: no-op sem VITE_SENTRY_DSN

export function useAdminSession() {
  /* Acesso por hash #admin-encanto — entrada EXPLÍCITA no fluxo administrativo (equivalente a clicar
     na engrenagem, mas via link/favorito). Só decide qual TELA abre ('login'); nunca consulta sessão
     aqui — quem faz isso é o clique em "Entrar" dentro de AdminLogin. */
  const [mode, setMode] = useState(() => {
    if (typeof window !== 'undefined' && window.location.hash === '#admin-encanto') {
      window.history.replaceState(null, '', window.location.pathname);
      return 'login';
    }
    return 'store';
  });
  const [admin, setAdmin] = useState(null);

  /* Só REAGE a mudanças de sessão — nunca decide a tela inicial nem promove implicitamente. Sessão
     encerrada (logout real em qualquer aba, refresh token revogado) enquanto o Admin está aberto:
     volta pra Loja. Sessão presente enquanto já em 'admin' (ex.: token renovado em background): só
     atualiza os dados guardados, nunca muda `mode`. Fora de 'admin', uma sessão aparecendo (ex.: outra
     aba logou) é ignorada de propósito — só "Entrar" decide entrar. */
  useEffect(() => {
    if (!db) return undefined; // modo degradado (offline) — preserva o comportamento anterior
    const { data: sub } = db.auth.onAuthStateChange((_evento, session) => {
      if (!session) {
        setAdmin(null);
        setMode((m) => (m === 'admin' ? 'store' : m));
        limparUsuario(); // REF-OBS-01: logout/expiração — some do contexto do Sentry
      } else {
        setAdmin((a) => (a ? { ...a, session } : a));
      }
    });
    return () => { sub?.subscription?.unsubscribe?.(); };
  }, []);

  // REF-OBS-01: contexto do Sentry sincronizado com o estado real — só id (nunca e-mail/senha do admin).
  useEffect(() => {
    marcarArea(mode === 'admin' ? 'admin' : 'loja');
    if (mode === 'admin' && admin?.session?.user?.id) setUsuario(admin.session.user.id, { role: 'admin' });
  }, [mode, admin]);

  /* entrar (chamado por AdminLogin.jsx após confirmar credencial OU reaproveitar sessão existente —
     em ambos os casos só depois de is_admin()===true) e abrirLogin (engrenagem) são as DUAS únicas
     ações do usuário que mudam `mode` para fora de 'store'. verLoja NÃO desloga — sessão permanece
     válida (persistência normal); F5 depois volta pra Loja (não mais direto pro Admin), mas "Entrar"
     reaproveita sem pedir senha de novo. sair() é o único logout real. */
  const entrar = useCallback((u) => { setAdmin(u); setMode('admin'); }, []);
  const abrirLogin = useCallback(() => { setMode('login'); }, []);
  const verLoja = useCallback(() => { setMode('store'); }, []);
  const sair = useCallback(async () => {
    if (db) { try { await db.auth.signOut(); } catch { /* best-effort — a UI já sai mesmo se a rede falhar */ } }
    setAdmin(null);
    setMode('store');
  }, []);

  return { mode, admin, entrar, abrirLogin, verLoja, sair };
}
