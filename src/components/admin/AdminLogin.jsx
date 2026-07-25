import { useState } from 'react';
import { db } from '../../lib/supabase.js';
import { registrarBreadcrumb } from '../../lib/sentry.js'; // REF-OBS-01: no-op sem VITE_SENTRY_DSN
import { AdminSessionChecking } from './AdminSessionChecking.jsx'; // REF-CUSTOMER-01 · Parte 2: mesmo estado visual do F5 no painel

export function AdminLogin({ onLogin, verificandoSessao }) {
  const [email,   setEmail]   = useState('as992203620@gmail.com');
  const [pass,    setPass]    = useState('');
  const [err,     setErr]     = useState('');
  const [loading, setLoading] = useState(false);
  /* REF-CUSTOMER-01 · Parte 2: enquanto o hook confirma uma sessão salva plausível, mostra o mesmo
     estado neutro do F5-dentro-do-painel em vez do formulário — elimina o "flash" de login para quem
     já está autenticado. `mode` continua 'login' o tempo todo (nenhuma mudança na máquina de estados
     da REF-AUTH-02); isto é só a apresentação. Sem sessão salva, verificandoSessao nunca liga. */
  if (verificandoSessao) return <AdminSessionChecking/>;
  const login = async () => {
    if (!pass) { setErr('Digite a senha'); return; }
    if (!db)   { setErr('Supabase indisponível. Recarregue a página.'); return; }
    setLoading(true); setErr('');
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
  return (
    <div className="admin-login">
      <div className="admin-login-card">
        <div style={{fontSize:42,textAlign:'center',marginBottom:8}}>🔐</div>
        <h2>Encanto Admin</h2>
        <p>Painel administrativo da loja</p>
        <div className="form-group">
          <label className="form-label">E-mail</label>
          <input data-testid="admin-login-email" className="form-input" value={email} onChange={e=>setEmail(e.target.value)}/>
        </div>
        <div className="form-group">
          <label className="form-label">Senha</label>
          <input data-testid="admin-login-senha" className="form-input" type="password" placeholder="Sua senha"
            value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==='Enter'&&login()}/>
        </div>
        {err&&<p data-testid="admin-login-erro" style={{color:'var(--red)',fontSize:13,marginBottom:8}}>{err}</p>}
        <button className="login-btn" onClick={login} disabled={loading}>
          {loading?'Entrando...':'Entrar'}
        </button>
        <p style={{fontSize:12,color:'var(--gray-400)',marginTop:14,textAlign:'center'}}>Acesso restrito ao administrador</p>
      </div>
    </div>
  );
}
