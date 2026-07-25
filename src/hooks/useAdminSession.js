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
   Admin), que só entra em cena num F5 DENTRO do painel (chave do localStorage do client `db`
   presente E o usuário já tinha entrado no fluxo admin nesta aba — ver REF-AUTH-02 abaixo) — para
   todo o resto dos visitantes (o caso comum), o 1º render continua 'store' de forma síncrona e
   imediata, sem NENHUM atraso adicional.

   STORAGE KEY (REF-ADMIN-03 · Onda 2): antes, este hook precisava ADIVINHAR a chave de localStorage
   de `db` reconstruindo o formato default do supabase-js a partir de SUPA_URL — dependência implícita
   do formato interno da lib, duplicada à parte nos specs de E2E. Agora `db` tem `storageKey` explícito
   (constants/authStorage.js, mesma ideia que `dbCliente` já usava) — este hook só IMPORTA a constante,
   sem reconstruir nada.

   FLUXO ADMIN COMO ESCOLHA EXPLÍCITA (REF-AUTH-02): achado real em produção — o domínio principal
   abria o Admin direto sempre que havia uma sessão salva em localStorage, mesmo sem o usuário nunca ter
   clicado na engrenagem nem navegado para o hash. Causa raiz: a existência da sessão (localStorage)
   decidia sozinha a tela inicial ('checking'→'admin' promovia até a partir de mode='store', assim que
   getSession() resolvia em background). Autenticação (sessão válida) e "o usuário decidiu entrar no
   fluxo admin" são conceitos DIFERENTES — sessão persistida só deve evitar pedir login de novo DEPOIS
   que o usuário já escolheu entrar (engrenagem/hash), nunca decidir a tela inicial por conta própria.
   Fix: `ADMIN_FLOW_SESSION_KEY`, em sessionStorage (não localStorage — precisa "esquecer" sozinho ao
   abrir uma aba/janela nova; sobrevive a um F5 na MESMA aba, preservando "refresh dentro do painel
   continua no painel"). Só é marcado quando o próprio usuário entra no fluxo (hash/engrenagem/login
   bem-sucedido) e só é limpo num logout real (nunca no "← Ver loja", que continua sendo uma prévia).
   A promoção para mode='admin' (promoverSeAutorizado) nunca mais parte de mode='store' — só de
   'login'/'checking', que só existem quando o usuário (ou uma aba já dentro do fluxo) pediu. */
import { useState, useEffect, useCallback } from 'react';
import { db } from '../lib/supabase.js';
import { ADMIN_AUTH_STORAGE_KEY, ADMIN_FLOW_SESSION_KEY } from '../constants/authStorage.js';
import { setUsuario, limparUsuario, marcarArea } from '../lib/sentry.js'; // REF-OBS-01: no-op sem VITE_SENTRY_DSN

function possivelSessaoAdmin() {
  if (typeof window === 'undefined' || !db) return false;
  try { return !!window.localStorage.getItem(ADMIN_AUTH_STORAGE_KEY); } catch { return false; }
}

/* REF-AUTH-02: "o usuário já escolheu entrar no fluxo admin NESTA ABA" — sessionStorage de propósito,
   ver header do arquivo. */
function estaNoFluxoAdmin() {
  if (typeof window === 'undefined') return false;
  try { return window.sessionStorage.getItem(ADMIN_FLOW_SESSION_KEY) === '1'; } catch { return false; }
}
function marcarFluxoAdmin() {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.setItem(ADMIN_FLOW_SESSION_KEY, '1'); } catch { /* noop */ }
}
function limparFluxoAdmin() {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(ADMIN_FLOW_SESSION_KEY); } catch { /* noop */ }
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
    /* Acesso por hash #admin-encanto — entrada EXPLÍCITA no fluxo administrativo (equivalente a
       clicar na engrenagem, mas via link/favorito). Sempre 'login': se a sessão salva não se
       confirmar (expirada/inválida), o usuário pediu Admin e deve ver a tela de Login, nunca a Loja
       silenciosamente (ver validação #8 da REF-AUTH-02). */
    if (typeof window !== 'undefined' && window.location.hash === '#admin-encanto') {
      window.history.replaceState(null, '', window.location.pathname);
      marcarFluxoAdmin();
      return 'login';
    }
    /* REF-AUTH-02: 'checking' só quando o PRÓPRIO usuário já tinha entrado no fluxo admin nesta aba
       (F5 dentro do painel) — nunca pela mera existência de uma sessão salva. Essa era a causa raiz
       do bug relatado: o domínio principal abria o Admin direto só porque uma sessão existia em
       localStorage, mesmo sem o usuário nunca ter escolhido entrar no fluxo. Persistência de sessão
       ≠ definição da tela inicial: sem ter entrado no fluxo nesta aba, o domínio principal É SEMPRE
       a Loja, mesmo com sessão de Admin válida salva. */
    return (estaNoFluxoAdmin() && possivelSessaoAdmin()) ? 'checking' : 'store';
  });
  const [admin, setAdmin] = useState(null);

  /* REF-REGRESSION-01 · P1: promove pra 'admin' SÓ depois de confirmar is_admin() — nunca só por
     existir sessão. autorizado===false é fail-safe: uma sessão Supabase válida mas sem privilégio
     (nunca deveria chegar aqui hoje, já que as 2 sessões — cliente/admin — são isoladas por
     storageKey) é deslogada de verdade, não só "voltada pra loja" (evita re-tentar 'checking' pra
     sempre a cada F5). autorizado===null (erro de rede) nunca desloga uma sessão que pode ser
     legítima — só não promove (fail-closed sem falso-negativo agressivo).
     REF-AUTH-02: a promoção para 'admin' nunca mais parte de mode==='store' — só de 'login'/'checking',
     que só existem quando o usuário (ou uma aba já dentro do fluxo) pediu Admin. Uma sessão válida
     pode ser confirmada em background o quanto for, mas isso sozinho nunca tira o usuário da Loja. */
  const promoverSeAutorizado = useCallback(async (session) => {
    const autorizado = await verificarIsAdmin();
    if (autorizado === true) {
      setAdmin({ email: session.user?.email ?? null, session });
      setMode((m) => (m === 'login' || m === 'checking' ? 'admin' : m));
    } else if (autorizado === false) {
      try { await db.auth.signOut(); } catch { /* best-effort — a UI já sai mesmo se a rede falhar */ }
      limparFluxoAdmin();
      setAdmin(null);
      setMode((m) => (m === 'checking' ? 'store' : m));
      limparUsuario();
    } else {
      setMode((m) => (m === 'checking' ? 'store' : m));
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    if (!db) return undefined; // modo degradado (offline) — preserva o comportamento anterior

    const promoverSeVivo = (session) => { if (vivo) promoverSeAutorizado(session); };

    db.auth.getSession().then(({ data }) => {
      if (!vivo) return;
      if (data?.session) promoverSeVivo(data.session);
      // 'checking' apostou numa sessão que não se confirmou (token expirado/inválido) — libera a Loja.
      else setMode((m) => (m === 'checking' ? 'store' : m));
    });

    const { data: sub } = db.auth.onAuthStateChange((_evento, session) => {
      if (!vivo) return;
      if (session) promoverSeVivo(session);
      else {
        setAdmin(null);
        limparFluxoAdmin();
        setMode((m) => (m === 'admin' || m === 'checking' ? 'store' : m));
        limparUsuario(); // REF-OBS-01: logout/expiração — some do contexto do Sentry
      }
    });

    return () => { vivo = false; sub?.subscription?.unsubscribe?.(); };
  }, [promoverSeAutorizado]);

  /* REF-AUTH-02: reconfirma a sessão sempre que o usuário ENTRA no fluxo admin em runtime (clique na
     engrenagem, abrirLogin() → mode='login'). O efeito acima já pode ter resolvido a checagem ANTES
     deste clique (aba aberta há tempo, sessão válida, usuário só decidiu entrar agora) — naquele
     momento mode ainda era 'store' e a promoção foi bloqueada de propósito. Sem isto, uma sessão
     genuinamente válida forçaria login de novo ao entrar no fluxo, quebrando "engrenagem → Painel
     direto" quando já autenticado (validação #3). Cobre 'checking' também (reentrância inofensiva
     com o efeito acima, mesmo padrão de dupla checagem já usado no resto do hook). */
  useEffect(() => {
    if ((mode !== 'login' && mode !== 'checking') || !db) return undefined;
    let vivo = true;
    db.auth.getSession().then(({ data }) => {
      if (!vivo) return;
      if (data?.session) promoverSeAutorizado(data.session);
      else setMode((m) => (m === 'checking' ? 'store' : m));
    });
    return () => { vivo = false; };
  }, [mode, promoverSeAutorizado]);

  // REF-OBS-01: contexto do Sentry sincronizado com o estado real — só id (nunca e-mail/senha do admin).
  useEffect(() => {
    marcarArea(mode === 'admin' ? 'admin' : 'loja');
    if (mode === 'admin' && admin?.session?.user?.id) setUsuario(admin.session.user.id, { role: 'admin' });
  }, [mode, admin]);

  /* entrar/abrirLogin marcam o fluxo (REF-AUTH-02): entrada explícita do usuário no Admin.
     verLoja NÃO marca nem limpa — é uma prévia (sessão permanece válida, F5 depois volta pro Admin,
     comportamento pré-existente preservado). sair() é o único logout real — limpa o fluxo também. */
  const entrar = useCallback((u) => { marcarFluxoAdmin(); setAdmin(u); setMode('admin'); }, []);
  const abrirLogin = useCallback(() => { marcarFluxoAdmin(); setMode('login'); }, []);
  const verLoja = useCallback(() => { setMode('store'); }, []);
  const sair = useCallback(async () => {
    if (db) { try { await db.auth.signOut(); } catch { /* best-effort — a UI já sai mesmo se a rede falhar */ } }
    limparFluxoAdmin();
    setAdmin(null);
    setMode('store');
  }, []);

  return { mode, admin, entrar, abrirLogin, verLoja, sair };
}
