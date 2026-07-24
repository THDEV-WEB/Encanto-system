/* hooks/useAdminSession.js — REF-ADMIN-01 · Onda 2 (sessão do Admin).
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
     loja para sempre (até logar de novo), fechando o gap "logout que não desloga". */
import { useState, useEffect, useCallback } from 'react';
import { db } from '../lib/supabase.js';

export function useAdminSession() {
  const [mode, setMode] = useState(() => {
    /* Acesso por hash #admin-encanto */
    if (typeof window !== 'undefined' && window.location.hash === '#admin-encanto') {
      window.history.replaceState(null, '', window.location.pathname);
      return 'login';
    }
    return 'store';
  });
  const [admin, setAdmin] = useState(null);

  useEffect(() => {
    let vivo = true;
    if (!db) return undefined; // modo degradado (offline) — preserva o comportamento anterior

    db.auth.getSession().then(({ data }) => {
      if (!vivo || !data?.session) return;
      setAdmin({ email: data.session.user?.email ?? null, session: data.session });
      // Só restaura quando ainda não há um destino explícito diferente (evita sobrescrever um logout
      // que já tenha acontecido no meio do caminho, embora improvável nesta janela síncrona).
      setMode((m) => (m === 'store' || m === 'login' ? 'admin' : m));
    });

    const { data: sub } = db.auth.onAuthStateChange((_evento, session) => {
      if (!vivo) return;
      if (session) {
        setAdmin({ email: session.user?.email ?? null, session });
      } else {
        setAdmin(null);
        setMode((m) => (m === 'admin' ? 'store' : m));
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
