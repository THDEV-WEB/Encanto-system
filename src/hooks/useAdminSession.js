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
   'login'/'checking', que só existem quando o usuário (ou uma aba já dentro do fluxo) pediu.

   REFINO VISUAL DO LOGIN (REF-CUSTOMER-01 · Parte 2): a máquina de estados acima (mode/gate/flow-flag)
   NÃO MUDA NESTA REF — só a APRESENTAÇÃO durante 'login'. Achado: engrenagem/hash com sessão já válida
   mostrava o FORMULÁRIO de login por uma fração de segundo antes de promover pra 'admin' (network
   round-trip do getSession()+is_admin()) — sensação de "pisca"/glitch. Fix: `verificandoSessao`, um
   sinal PURAMENTE de UI (não é um novo mode, não afeta nenhuma regra de promoção) — true só quando
   mode==='login' E há evidência de sessão salva (possivelSessaoAdmin()); AdminLogin.jsx troca o
   formulário por um "Verificando sessão..." (reaproveita AdminSessionChecking) enquanto for true. Sem
   sessão salva, verificandoSessao nunca liga — formulário aparece imediato, sem nenhum atraso. */
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
  /* FIX (achado REF-STABILITY-01 — "vulto" da tela de login ao entrar no Admin): calculado FORA dos
     useState abaixo, e não dentro do useEffect (que só roda DEPOIS do 1º paint) — ver
     verificandoSessao logo abaixo. Puro/sem efeito colateral (o efeito colateral de fato, limpar o
     hash + marcarFluxoAdmin, mora só dentro do useState(mode), que roda 1x no mount); reler em
     renders seguintes é inofensivo pois os dois initializers só executam na 1ª chamada de cada um. */
  const veioPorHashAdmin = typeof window !== 'undefined' && window.location.hash === '#admin-encanto';
  const [mode, setMode] = useState(() => {
    /* Acesso por hash #admin-encanto — entrada EXPLÍCITA no fluxo administrativo (equivalente a
       clicar na engrenagem, mas via link/favorito). Sempre 'login': se a sessão salva não se
       confirmar (expirada/inválida), o usuário pediu Admin e deve ver a tela de Login, nunca a Loja
       silenciosamente (ver validação #8 da REF-AUTH-02). */
    if (veioPorHashAdmin) {
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
  /* REF-CUSTOMER-01 · Parte 2 criou este sinal, mas ligava via useEffect — sempre 1 frame TARDE
     DEMAIS (efeitos rodam DEPOIS do commit/paint), deixando escapar exatamente 1 pintura do
     formulário de login antes de trocar pro "Verificando sessão..." (o "vulto" do achado
     REF-STABILITY-01). FIX: valor inicial calculado de forma SÍNCRONA, no mesmo instante/render em
     que mode passa a 'login' (aqui no mount-via-hash; em abrirLogin() logo abaixo, no clique da
     engrenagem) — a 1ª pintura já nasce correta, sem frame intermediário. */
  const [verificandoSessao, setVerificandoSessao] = useState(() => veioPorHashAdmin && possivelSessaoAdmin());

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
    /* FIX (REF-STABILITY-01, achado 1/2): NÃO liga mais verificandoSessao aqui (useEffect roda depois
       do 1º paint — sempre 1 frame tarde demais, causava o "vulto" do login). Ligar já é
       responsabilidade SÍNCRONA de quem muda mode para 'login' (useState(mode) no mount-via-hash;
       abrirLogin() no clique da engrenagem).
       FIX (REF-STABILITY-01, achado 2/2 — pego pelo teste novo com MutationObserver, não pelas
       asserções por polling já existentes): desligar verificandoSessao já no callback de
       getSession() (ANTES de promoverSeAutorizado ter terminado) reabria uma janela real — o
       formulário de verdade ficava visível durante TODO o round-trip da RPC is_admin() (não é "1
       frame", é a rede inteira). Await promoverSeAutorizado ANTES de desligar: só some da tela de
       "Verificando sessão..." quando o desfecho (promovido para admin, recusado, ou mantido em
       'login' para digitar credencial) já está decidido — nunca no meio do caminho. */
    db.auth.getSession().then(async ({ data }) => {
      if (!vivo) return;
      if (data?.session) await promoverSeAutorizado(data.session);
      else setMode((m) => (m === 'checking' ? 'store' : m));
      if (vivo) setVerificandoSessao(false);
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
  /* FIX (REF-STABILITY-01): verificandoSessao setado SÍNCRONO, na mesma chamada que muda mode para
     'login' (React 18 agrupa os dois setStates deste handler num único render) — a 1ª pintura de
     AdminLogin já nasce sabendo se deve mostrar o formulário ou "Verificando sessão...", sem
     depender do useEffect (que só resolveria 1 frame depois). */
  const abrirLogin = useCallback(() => { marcarFluxoAdmin(); setVerificandoSessao(possivelSessaoAdmin()); setMode('login'); }, []);
  const verLoja = useCallback(() => { setMode('store'); }, []);
  const sair = useCallback(async () => {
    if (db) { try { await db.auth.signOut(); } catch { /* best-effort — a UI já sai mesmo se a rede falhar */ } }
    limparFluxoAdmin();
    setAdmin(null);
    setMode('store');
  }, []);

  return { mode, admin, entrar, abrirLogin, verLoja, sair, verificandoSessao };
}
