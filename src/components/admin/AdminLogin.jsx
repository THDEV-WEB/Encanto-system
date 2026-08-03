import { useState } from 'react';
import { db } from '../../lib/supabase.js';
import { registrarBreadcrumb } from '../../lib/sentry.js'; // REF-OBS-01: no-op sem VITE_SENTRY_DSN
import { useCompanyInfo } from '../../hooks/useCompanyInfo.js'; // REF-COMPANY-02: get_company_info e publico, funciona pre-auth

export function AdminLogin({ onLogin }) {
  const companyInfo = useCompanyInfo();
  const [email,   setEmail]   = useState('');
  const [pass,    setPass]    = useState('');
  const [err,     setErr]     = useState('');
  const [loading, setLoading] = useState(false);
  // REF-UX-SESSION-01: sessão reaproveitável encontrada no clique em "Entrar" — aguarda confirmação
  // explícita do usuário antes de entrar, para deixar claro que nenhuma senha foi validada agora.
  const [sessaoEncontrada, setSessaoEncontrada] = useState(null);

  const login = async () => {
    if (!db) { setErr('Supabase indisponível. Recarregue a página.'); return; }
    setLoading(true); setErr('');

    /* REF-STABILITY-02: "Entrar" é o ÚNICO momento em que a sessão salva é consultada/reaproveitada —
       nunca antes (nem no boot, nem ao abrir esta tela via engrenagem/hash). Se já existir uma sessão
       válida E autorizada (is_admin()), a REF-UX-SESSION-01 mostra uma tela de confirmação explícita
       (abaixo) em vez de entrar direto — nenhuma mudança em QUANDO a sessão é consultada, só em como o
       resultado é comunicado. Sessão inexistente/expirada ou sem privilégio de admin: cai no login normal
       por credencial (abaixo), sem erro nenhum exibido por essa tentativa silenciosa. */
    const { data: sessaoAtual } = await db.auth.getSession();
    if (sessaoAtual?.session?.access_token) {
      const { data: souAdminSessaoAtual, error: erroSessaoAtual } = await db.rpc('is_admin');
      if (!erroSessaoAtual && souAdminSessaoAtual === true) {
        registrarBreadcrumb('admin: sessao existente encontrada, aguardando confirmacao (Entrar)');
        setSessaoEncontrada({ email: sessaoAtual.session.user?.email ?? email, session: sessaoAtual.session });
        setLoading(false);
        return;
      }
    }

    if (!pass) { setErr('Digite a senha'); setLoading(false); return; }
    // Login real: só entra com sessão autenticada do Supabase. Sem bypass.
    const { data, error } = await db.auth.signInWithPassword({ email, password: pass });
    if (error) {
      setErr(error.message || 'Falha no login.');
      setLoading(false);
      registrarBreadcrumb('admin: falha no login', { motivo: error.message });
      return;
    }
    if (!data?.session?.access_token) {
      // Salvaguarda: sem sessão ativa, não libera o painel.
      setErr('Login sem sessão ativa. Tente novamente.');
      setLoading(false);
      registrarBreadcrumb('admin: login sem sessao ativa');
      return;
    }
    // REF-REGRESSION-01 · P1: signInWithPassword só prova credencial válida no projeto Supabase
    // (autenticação) — nunca que quem logou é o admin (autorização real, tabela public.admins,
    // via is_admin() — a mesma fonte que já protege toda a RLS do projeto). Sem este check, qualquer
    // conta com senha válida no mesmo projeto veria o painel inteiro renderizado no client.
    const { data: souAdmin, error: erroIsAdmin } = await db.rpc('is_admin');
    if (erroIsAdmin || souAdmin !== true) {
      await db.auth.signOut().catch(() => {});
      setErr('Acesso restrito ao administrador.');
      setLoading(false);
      registrarBreadcrumb('admin: login negado (sem privilegio de admin)');
      return;
    }
    registrarBreadcrumb('admin: login bem-sucedido');
    onLogin({ email, session: data.session });
    setLoading(false);
  };

  // REF-UX-SESSION-01: confirma a entrada com a sessão já encontrada — mesma chamada que o branch de
  // reaproveitamento fazia direto antes desta ref, só que agora depende de um clique explícito extra.
  const continuarComoAdmin = () => {
    registrarBreadcrumb('admin: sessao existente reaproveitada (confirmada)');
    onLogin(sessaoEncontrada);
  };

  // REF-UX-SESSION-01: recusa a sessão encontrada — desloga de verdade (mesma chamada de sair() em
  // useAdminSession.js) e volta ao formulário normal para um login por credencial real.
  const usarOutraConta = async () => {
    if (db) { try { await db.auth.signOut(); } catch { /* best-effort */ } }
    registrarBreadcrumb('admin: sessao existente recusada (usar outra conta)');
    setSessaoEncontrada(null);
    setPass('');
    setErr('');
  };

  if (sessaoEncontrada) {
    return (
      <div className="admin-login">
        <div className="admin-login-card" data-testid="admin-login-sessao-encontrada">
          <div style={{fontSize:42,textAlign:'center',marginBottom:8}}>🔐</div>
          <h2>{companyInfo.nomeCurto} Admin</h2>
          <p>Sessão administrativa encontrada</p>
          <p style={{fontSize:13,color:'var(--gray-700)',marginTop:-16,marginBottom:24}}>
            <strong>{sessaoEncontrada.email}</strong> já está autenticado neste navegador.
            Nenhuma senha foi validada agora — você está continuando uma sessão já autenticada.
          </p>
          <button className="login-btn" data-testid="admin-login-continuar" onClick={continuarComoAdmin}>
            Continuar como Administrador
          </button>
          <button className="btn-secondary" data-testid="admin-login-usar-outra-conta" onClick={usarOutraConta}
            style={{width:'100%',marginTop:10,textAlign:'center'}}>
            Usar outra conta
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-login">
      <div className="admin-login-card">
        <div style={{fontSize:42,textAlign:'center',marginBottom:8}}>🔐</div>
        <h2>{companyInfo.nomeCurto} Admin</h2>
        <p>Painel administrativo da loja</p>
        <div className="form-group">
          <label className="form-label" htmlFor="admin-login-email-input">E-mail</label>
          <input id="admin-login-email-input" data-testid="admin-login-email" className="form-input" value={email} onChange={e=>setEmail(e.target.value)}/>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="admin-login-senha-input">Senha</label>
          <input id="admin-login-senha-input" data-testid="admin-login-senha" className="form-input" type="password" placeholder="Sua senha"
            value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==='Enter'&&login()}/>
        </div>
        {err&&<p data-testid="admin-login-erro" role="alert" style={{color:'var(--red)',fontSize:13,marginBottom:8}}>{err}</p>}
        <button className="login-btn" onClick={login} disabled={loading}>
          {loading?'Entrando...':'Entrar'}
        </button>
        <p style={{fontSize:12,color:'var(--gray-400)',marginTop:14,textAlign:'center'}}>Acesso restrito ao administrador</p>
      </div>
    </div>
  );
}
