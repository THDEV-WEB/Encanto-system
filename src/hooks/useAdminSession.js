/* hooks/useAdminSession.js — REF-ADMIN-01 · Onda 2 (sessão do Admin) + REF-ADMIN-02 · Onda 2
   (elimina o flash da Loja durante a restauração).
   Move puro do gate de acesso que vivia em App.jsx (mode/hash), + fix do achado real (ADR/memória
   REF-E2E-03 Onda 1): não existia restauração de sessão nem logout de verdade — um F5 no meio do
   painel sempre caía na loja (o hash '#admin-encanto' já tinha sido limpo no 1º mount) mesmo com o
   token do Supabase (`db`, storageKey padrão) ainda válido; "Sair" só trocava de tela, nunca chamava
   db.auth.signOut(). Espelha o padrão já usado por AuthProvider/AuthService (sessão do CLIENTE, via
   `dbCliente`): getSession() no mount + onAuthStateChange() para manter o modo sincronizado — mas
   sem "carregarCustomer" (Admin não tem perfil de cliente) e sem provider próprio, porque só App.jsx
   consome isto (não há árvore de componentes do Admin abaixo que precise do estado antes da hora).

   Dois botões de saída, dois comportamentos (achado REF-E2E-03 §1.2: antes eram o MESMO handler):
   - `verLoja()`  → "← Ver loja": só troca de tela, sessão do Supabase permanece válida (F5 depois
     volta para o Admin — é uma prévia, não um logout).
   - `sair()`     → "Sair" (sidebar): chama db.auth.signOut() de verdade — depois disso, F5 cai na
     loja para sempre (até logar de novo), fechando o gap "logout que não desloga".

   FLASH (achado REF-ADMIN-01, limitação conhecida): antes, o 1º render assumia SEMPRE mode='store'
   até getSession() resolver — para um Admin recarregando a página, isso montava a StoreApp (com o
   fetch de catálogo) por uma fração de segundo antes de trocar para o painel. Fix: um 3º estado
   'checking', isolado deste hook (App.jsx só mostra um spinner nesse caso — nunca a Loja nem o
   Admin), mas só entra em cena quando HÁ evidência de uma sessão de Admin salva (chave do
   localStorage do client `db` presente) — para todo o resto dos visitantes (o caso comum, sem essa
   chave), o 1º render continua 'store' de forma síncrona e imediata, sem NENHUM atraso adicional.

   STORAGE KEY (REF-ADMIN-03 · Onda 2): antes, este hook precisava ADIVINHAR a chave de localStorage
   de `db` reconstruindo o formato default do supabase-js a partir de SUPA_URL — dependência implícita
   do formato interno da lib, duplicada à parte nos specs de E2E. Agora `db` tem `storageKey` explícito
   (constants/authStorage.js, mesma ideia que `dbCliente` já usava) — este hook só IMPORTA a constante,
   sem reconstruir nada. */
import { useState, useEffect, useCallback } from 'react';
import { db } from '../lib/supabase.js';
import { ADMIN_AUTH_STORAGE_KEY } from '../constants/authStorage.js';
import { setUsuario, limparUsuario, marcarArea } from '../lib/sentry.js'; // REF-OBS-01: no-op sem VITE_SENTRY_DSN

function possivelSessaoAdmin() {
  if (typeof window === 'undefined' || !db) return false;
  try { return !!window.localStorage.getItem(ADMIN_AUTH_STORAGE_KEY); } catch { return false; }
}

/* REF-REGRESSION-01 · P1 (achado de seguranca): uma sessao Supabase valida no client `db` prova
   AUTENTICACAO, nunca AUTORIZACAO — antes deste fix, getSession()/onAuthStateChange promoviam
   mode='admin' so por existir sessao, confiando 100% na RLS (is_admin(), tabela public.admins)
   como UNICA linha de defesa. is_admin() ja e a fonte da verdade real usada por toda RLS do
   projeto desde AUTH-01; aqui so passa a ser consultada TAMBEM no front, antes de renderizar o
   painel. null = indeterminado (erro de rede/RPC) — o chamador nunca deve decidir com null,
   so com true/false explicitos (fail-closed: nunca promove no duvidoso). */
async function verificarIsAdmin() {
  if (!db) return null;
  try {
    const { data, error } = await db.rpc('is_admin');
    if (error) return null;
    return data === true;
  } catch { return null; }
}

export function useAdminSession() {
  const [mode, setMode] = useState(() => {
    /* Acesso por hash #admin-encanto */
    if (typeof window !== 'undefined' && window.location.hash === '#admin-encanto') {
      window.history.replaceState(null, '', window.location.pathname);
      return 'login';
    }
    return possivelSessaoAdmin() ? 'checking' : 'store';
  });
  const [admin, setAdmin] = useState(null);

  useEffect(() => {
    let vivo = true;
    if (!db) return undefined; // modo degradado (offline) — preserva o comportamento anterior

    /* REF-REGRESSION-01 · P1: promove pra 'admin' SÓ depois de confirmar is_admin() — nunca só por
       existir sessão. autorizado===false é fail-safe: uma sessão Supabase válida mas sem privilégio
       (nunca deveria chegar aqui hoje, já que as 2 sessões — cliente/admin — são isoladas por
       storageKey) é deslogada de verdade, não só "voltada pra loja" (evita re-tentar 'checking' pra
       sempre a cada F5). autorizado===null (erro de rede) nunca desloga uma sessão que pode ser
       legítima — só não promove (fail-closed sem falso-negativo agressivo). */
    const promoverSeAutorizado = async (session) => {
      const autorizado = await verificarIsAdmin();
      if (!vivo) return;
      if (autorizado === true) {
        setAdmin({ email: session.user?.email ?? null, session });
        // Só restaura quando ainda não há um destino explícito diferente (evita sobrescrever um logout
        // que já tenha acontecido no meio do caminho, embora improvável nesta janela síncrona).
        setMode((m) => (m === 'store' || m === 'login' || m === 'checking' ? 'admin' : m));
      } else if (autorizado === false) {
        try { await db.auth.signOut(); } catch { /* best-effort — a UI já sai mesmo se a rede falhar */ }
        setAdmin(null);
        setMode((m) => (m === 'checking' ? 'store' : m));
        limparUsuario();
      } else {
        setMode((m) => (m === 'checking' ? 'store' : m));
      }
    };

    db.auth.getSession().then(({ data }) => {
      if (!vivo) return;
      if (data?.session) promoverSeAutorizado(data.session);
      // 'checking' apostou numa sessão que não se confirmou (token expirado/inválido) — libera a Loja.
      else setMode((m) => (m === 'checking' ? 'store' : m));
    });

    const { data: sub } = db.auth.onAuthStateChange((_evento, session) => {
      if (!vivo) return;
      if (session) promoverSeAutorizado(session);
      else {
        setAdmin(null);
        setMode((m) => (m === 'admin' || m === 'checking' ? 'store' : m));
        limparUsuario(); // REF-OBS-01: logout/expiração — some do contexto do Sentry
      }
    });

    return () => { vivo = false; sub?.subscription?.unsubscribe?.(); };
  }, []);

  // REF-OBS-01: contexto do Sentry sincronizado com o estado real — só id (nunca e-mail/senha do admin).
  useEffect(() => {
    marcarArea(mode === 'admin' ? 'admin' : 'loja');
    if (mode === 'admin' && admin?.session?.user?.id) setUsuario(admin.session.user.id, { role: 'admin' });
  }, [mode, admin]);

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
