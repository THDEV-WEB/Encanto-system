/* hooks/useAdminSession.js — REF-ADMIN-01 · Onda 2 (sessão do Admin) + REF-STABILITY-02 (acesso ao
   Admin como escolha EXPLÍCITA — sessão nunca mais promove sozinha) + REF-ADMIN-04 · Onda 4
   (simplificado: único consumidor agora é src/AdminApp.jsx, bundle próprio do admin — o mode-switch
   'store'/hash que existia quando este hook vivia dentro do App.jsx da loja não faz mais sentido, já
   que este bundle nunca tem uma loja pra mostrar). Fix do achado real (ADR/memória REF-E2E-03 Onda 1):
   não existia logout de verdade — "Sair" só trocava de tela, nunca chamava db.auth.signOut(). Espelha
   o padrão já usado por AuthProvider/AuthService (sessão do CLIENTE, via `dbCliente`) só na PARTE de
   detectar encerramento de sessão (onAuthStateChange) — sem "carregarCustomer" (Admin não tem perfil
   de cliente) e sem provider próprio, porque só AdminApp.jsx consome isto.

   STORAGE KEY (REF-ADMIN-03 · Onda 2): `db` tem storageKey explícito (constants/authStorage.js, mesma
   ideia que `dbCliente` já usava) — nunca reconstrói o formato default do supabase-js a partir da URL.

   REF-STABILITY-02 — MUDANÇA DE COMPORTAMENTO (decisão do dono, substitui REF-AUTH-02/REF-ADMIN-02/
   REF-STABILITY-01 nesta parte específica), preservada integralmente na Onda 4: a persistência de
   sessão do Supabase continua normal (um login válido sobrevive a um F5), mas ela NUNCA decide sozinha
   qual tela aparece. O único gatilho que consulta/reaproveita a sessão salva é o clique explícito em
   "Entrar" (AdminLogin.jsx): se houver uma sessão válida E autorizada (is_admin()), entra direto, sem
   pedir credencial de novo; caso contrário, segue o login normal por e-mail/senha. Por isso este hook
   não tem um 3º estado 'checking' nem `verificandoSessao` — nenhuma verificação em background, a
   sessão só é CONSULTADA no momento do clique em "Entrar".
   `onAuthStateChange` permanece, mas só para REAGIR (nunca promover): se a sessão cair enquanto o
   Admin está aberto (logout em outra aba, refresh token revogado), volta pro login; se um token for
   renovado enquanto já em 'admin', só atualiza os dados da sessão guardada — nunca promove mode. */
import { useState, useEffect, useCallback } from 'react';
import { db } from '../lib/supabase.js';
import { setUsuario, limparUsuario, marcarArea } from '../lib/sentry.js'; // REF-OBS-01: no-op sem VITE_SENTRY_DSN
import { setActiveStoreId } from '../services/adminStore.js'; // REF-LGPD-01 · Onda 3 (LGPD-R12)

export function useAdminSession() {
  const [mode, setMode] = useState('login'); // REF-ADMIN-04: sempre abre no login — nao ha' mais 'store' pra defaultar
  const [admin, setAdmin] = useState(null);

  /* Só REAGE a mudanças de sessão — nunca decide a tela inicial nem promove implicitamente. Sessão
     encerrada (logout real em qualquer aba, refresh token revogado) enquanto o Admin está aberto:
     volta pro login. Sessão presente enquanto já em 'admin' (ex.: token renovado em background): só
     atualiza os dados guardados, nunca muda `mode`. Fora de 'admin', uma sessão aparecendo (ex.: outra
     aba logou) é ignorada de propósito — só "Entrar" decide entrar. */
  useEffect(() => {
    if (!db) return undefined; // modo degradado (offline) — preserva o comportamento anterior
    const { data: sub } = db.auth.onAuthStateChange((_evento, session) => {
      if (!session) {
        setAdmin(null);
        setMode((m) => (m === 'admin' ? 'login' : m));
        limparUsuario(); // REF-OBS-01: logout/expiração — some do contexto do Sentry
        setActiveStoreId(null); // REF-LGPD-01 · Onda 3 (LGPD-R12): nao deixa loja ativa orfa no localStorage
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
     em ambos os casos só depois de is_admin()===true) é a ÚNICA ação que muda `mode` para 'admin'.
     sair() é o único logout real.

     REF-UX-SESSION-01 (UX, não mexe aqui): no branch de reaproveitamento, `entrar` só é chamado depois
     de um clique EXTRA de confirmação em AdminLogin.jsx ("Continuar como Administrador") — para deixar
     explícito que nenhuma senha foi validada. O gatilho que CONSULTA a sessão continua sendo só o
     clique em "Entrar" (invariante da REF-STABILITY-02, acima); a confirmação é só mais uma decisão do
     usuário antes de chamar esta função, que em si não mudou. */
  const entrar = useCallback((u) => { setAdmin(u); setMode('admin'); }, []);
  const sair = useCallback(async () => {
    if (db) { try { await db.auth.signOut(); } catch { /* best-effort — a UI já sai mesmo se a rede falhar */ } }
    setAdmin(null);
    setMode('login');
  }, []);

  return { mode, admin, entrar, sair };
}
