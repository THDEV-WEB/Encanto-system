/* ConviteApp.jsx — REF-STORE-ONBOARD-01 · Onda 2.
   Página de 1 USO SÓ: o link de convite (auth.admin.inviteUserByEmail, disparado pela Edge Function
   invite-store-admin) traz o token de sessão no fragmento da URL (#access_token=...&type=invite).
   Esta página consome esse token e deixa o administrador recém-convidado definir a senha inicial.

   ISOLAMENTO DE PROPÓSITO — cliente Supabase PRÓPRIO, nunca importa lib/supabase.js:
     - `db` (Admin) tem detectSessionInUrl:false por decisão deliberada (LOGIN-ARCH-02.2: não pode
       capturar/queimar o ?code= do OAuth do cliente) — mudar isso pro Admin inteiro reabriria o problema
       que aquela ref fechou.
     - useAdminSession.js (REF-STABILITY-02, "decisão do dono") proíbe qualquer coisa decidir a tela
       sozinha no boot do Admin — só o clique em "Entrar" consulta sessão.
   Esta página fica fora dessas duas árvores por construção: bundle próprio (convite.html), cliente
   próprio (detectSessionInUrl:true, persistSession:false — sessão só dura esta aba, nunca grava
   localStorage), zero import de AdminApp/useAdminSession/AdminStoreProvider. Depois de definir a senha,
   desloga deste cliente temporário e manda o administrador pro login normal (signInWithPassword, mesmo
   fluxo de sempre) — nunca tenta "herdar" a sessão pro bundle do Admin. */
import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const TEM_VITE_ENV = typeof import.meta.env !== 'undefined';
const SUPA_URL = TEM_VITE_ENV ? import.meta.env.VITE_SUPABASE_URL : undefined;
const SUPA_KEY = TEM_VITE_ENV ? import.meta.env.VITE_SUPABASE_KEY : undefined;

function criarClienteConvite() {
  try {
    return createClient(SUPA_URL, SUPA_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: true },
    });
  } catch {
    return null;
  }
}

export function ConviteApp() {
  const clienteRef = useRef(null);
  if (!clienteRef.current) clienteRef.current = criarClienteConvite();
  const client = clienteRef.current;

  const [status, setStatus] = useState('resolvendo'); // 'resolvendo' | 'pronto' | 'invalido' | 'salvo'
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmSenha, setConfirmSenha] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!client) { setStatus('invalido'); return; }
    let vivo = true;
    // detectSessionInUrl processa o #access_token=... na inicialização do client; onAuthStateChange
    // dispara assim que resolver (com sessão) OU se não havia token nenhum na URL (sem sessão).
    const { data: sub } = client.auth.onAuthStateChange((_evento, session) => {
      if (!vivo) return;
      if (session?.user) {
        // Limpa o token da URL/histórico assim que consumido — mesmo cuidado de qualquer fluxo de
        // magic-link: nunca deixar o token reaproveitável num F5 ou num "voltar" do navegador.
        try { window.history.replaceState({}, '', window.location.pathname); } catch { /* noop */ }
        setEmail(session.user.email || '');
        setStatus('pronto');
      }
    });
    // Sem token válido na URL: onAuthStateChange nunca dispara com sessão. Timeout cobre esse caso (link
    // direto sem token, token já consumido antes, ou expirado) sem depender de um evento que não vem.
    // 6000ms (não 2500ms) de propósito -- mesma margem de TIMEOUT_MS em routeDistanceService.js -- pra
    // nunca mostrar "link inválido" cedo demais numa rede lenta, num fluxo de 1a impressão só.
    const timer = setTimeout(() => { if (vivo) setStatus((s) => (s === 'resolvendo' ? 'invalido' : s)); }, 6000);
    return () => { vivo = false; clearTimeout(timer); sub?.subscription?.unsubscribe?.(); };
  }, [client]);

  const salvar = async () => {
    if (salvando) return;
    if (senha.length < 6) { setErro('A senha deve ter ao menos 6 caracteres.'); return; }
    if (senha !== confirmSenha) { setErro('As senhas não coincidem.'); return; }
    setSalvando(true); setErro('');
    const { error } = await client.auth.updateUser({ password: senha });
    setSalvando(false);
    if (error) { setErro(error.message || 'Não foi possível salvar. Tente novamente.'); return; }
    await client.auth.signOut().catch(() => {}); // sessão temporária desta aba só — nunca herdada pelo bundle do Admin
    setStatus('salvo');
  };

  if (status === 'resolvendo') {
    return (
      <div className="admin-login">
        <div className="admin-login-card">
          <div style={{ fontSize: 42, textAlign: 'center', marginBottom: 8 }}>🔐</div>
          <p style={{ textAlign: 'center' }}>Confirmando seu convite…</p>
        </div>
      </div>
    );
  }

  if (status === 'invalido') {
    return (
      <div className="admin-login">
        <div className="admin-login-card">
          <div style={{ fontSize: 42, textAlign: 'center', marginBottom: 8 }}>⚠️</div>
          <h2>Link inválido ou expirado</h2>
          <p style={{ fontSize: 13, color: 'var(--gray-700)' }}>
            Peça ao administrador da plataforma para enviar um novo convite.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'salvo') {
    return (
      <div className="admin-login">
        <div className="admin-login-card">
          <div style={{ fontSize: 42, textAlign: 'center', marginBottom: 8 }}>✅</div>
          <h2>Senha definida</h2>
          <p style={{ fontSize: 13, color: 'var(--gray-700)', marginBottom: 20 }}>
            Sua conta está pronta. Entre com seu e-mail e a senha que você acabou de definir.
          </p>
          <button className="login-btn" onClick={() => { window.location.href = '/'; }}>
            Ir para o login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-login">
      <div className="admin-login-card">
        <div style={{ fontSize: 42, textAlign: 'center', marginBottom: 8 }}>🔐</div>
        <h2>Defina sua senha</h2>
        <p style={{ fontSize: 13, color: 'var(--gray-700)', marginBottom: 4 }}>{email}</p>
        <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 18 }}>
          Escolha a senha que você vai usar para acessar o painel administrativo.
        </p>
        <div className="form-group">
          <label className="form-label" htmlFor="convite-senha-input">Nova senha</label>
          <input id="convite-senha-input" data-testid="convite-senha" className="form-input" type="password"
            value={senha} onChange={(e) => { setSenha(e.target.value); setErro(''); }} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="convite-confirmar-input">Confirmar senha</label>
          <input id="convite-confirmar-input" data-testid="convite-confirmar-senha" className="form-input" type="password"
            value={confirmSenha} onChange={(e) => { setConfirmSenha(e.target.value); setErro(''); }}
            onKeyDown={(e) => e.key === 'Enter' && salvar()} />
        </div>
        {erro && <p data-testid="convite-erro" role="alert" style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>{erro}</p>}
        <button className="login-btn" data-testid="convite-salvar" onClick={salvar} disabled={salvando}>
          {salvando ? 'Salvando…' : 'Definir senha e continuar'}
        </button>
      </div>
    </div>
  );
}
