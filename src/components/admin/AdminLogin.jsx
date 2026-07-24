import { useState } from 'react';
import { db } from '../../lib/supabase.js';

export function AdminLogin({ onLogin }) {
  const [email,   setEmail]   = useState('as992203620@gmail.com');
  const [pass,    setPass]    = useState('');
  const [err,     setErr]     = useState('');
  const [loading, setLoading] = useState(false);
  const login = async () => {
    if (!pass) { setErr('Digite a senha'); return; }
    if (!db)   { setErr('Supabase indisponível. Recarregue a página.'); return; }
    setLoading(true); setErr('');
    // Login real: só entra com sessão autenticada do Supabase. Sem bypass.
    const { data, error } = await db.auth.signInWithPassword({ email, password: pass });
    if (error) {
      setErr(error.message || 'Falha no login.');
      setLoading(false);
      return;
    }
    if (!data?.session?.access_token) {
      // Salvaguarda: sem sessão ativa, não libera o painel.
      setErr('Login sem sessão ativa. Tente novamente.');
      setLoading(false);
      return;
    }
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
