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
   chave), o 1º render continua 'store' de forma síncrona e imediata, sem NENHUM atraso adicional. */
import { useState, useEffect, useCallback } from 'react';
import { db, SUPA_URL } from '../lib/supabase.js';

/* Chave de storage default do supabase-js v2 (nenhum storageKey explícito foi passado ao criar
   `db`, ao contrário de `dbCliente`) — mesmo formato usado internamente pela lib: sb-<ref>-auth-token. */
function chaveSessaoAdmin() {
  try { return `sb-${new URL(SUPA_URL).hostname.split('.')[0]}-auth-token`; } catch { return null; }
}

function possivelSessaoAdmin() {
  if (typeof window === 'undefined' || !db) return false;
  try {
    const chave = chaveSessaoAdmin();
    return !!(chave && window.localStorage.getItem(chave));
  } catch { return false; }
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

    db.auth.getSession().then(({ data }) => {
      if (!vivo) return;
      if (data?.session) {
        setAdmin({ email: data.session.user?.email ?? null, session: data.session });
        // Só restaura quando ainda não há um destino explícito diferente (evita sobrescrever um logout
        // que já tenha acontecido no meio do caminho, embora improvável nesta janela síncrona).
        setMode((m) => (m === 'store' || m === 'login' || m === 'checking' ? 'admin' : m));
      } else {
        // 'checking' apostou numa sessão que não se confirmou (token expirado/inválido) — libera a Loja.
        setMode((m) => (m === 'checking' ? 'store' : m));
      }
    });

    const { data: sub } = db.auth.onAuthStateChange((_evento, session) => {
      if (!vivo) return;
      if (session) {
        setAdmin({ email: session.user?.email ?? null, session });
        setMode((m) => (m === 'store' || m === 'login' || m === 'checking' ? 'admin' : m));
      } else {
        setAdmin(null);
        setMode((m) => (m === 'admin' || m === 'checking' ? 'store' : m));
      }
    });

    return () => { vivo = false; sub?.subscription?.unsubscribe?.(); };
  }, []);

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
