/* components/menu/LoginScreen.jsx — login GUEST-FIRST (LOGIN-ARCH-02): Google + e-mail, sem conta.
   Phone OTP removido. "Continuar sem uma conta" sempre presente — nunca bloqueia a compra. */
import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import { ScreenModal } from './ScreenModal.jsx';

const amigavel = (e) => /provider|not enabled|unsupported|disabled/i.test(e?.message || '')
  ? 'Este login ainda não está disponível. Você pode continuar como visitante. 🙂'
  : (e?.message || 'Não foi possível continuar.');

const btn = { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px 16px', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 10 };
const erroStyle = { color: 'var(--red)', fontSize: 13, marginTop: 6, marginBottom: 4 };
const semConta = { width: '100%', marginTop: 8, background: 'none', border: 'none', color: 'var(--gray-500)', cursor: 'pointer', fontSize: 13 };

export function LoginScreen({ onClose }) {
  const { entrarComGoogle, enviarEmail, confirmarEmail } = useAuth();
  const [modo, setModo] = useState('opcoes'); // opcoes | email | codigo
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);

  const google = async () => { setErro(''); setBusy(true); const { error } = await entrarComGoogle(); setBusy(false); if (error) setErro(amigavel(error)); /* sucesso -> redirect do OAuth */ };
  const enviar = async () => { setErro(''); if (!/.+@.+\..+/.test(email.trim())) { setErro('Digite um e-mail válido.'); return; } setBusy(true); const { error } = await enviarEmail(email.trim()); setBusy(false); if (error) { setErro(amigavel(error)); return; } setModo('codigo'); };
  const confirmar = async () => { setErro(''); if (codigo.replace(/\D/g, '').length < 4) { setErro('Digite o código enviado ao seu e-mail.'); return; } setBusy(true); const { error } = await confirmarEmail(email.trim(), codigo.replace(/\D/g, '')); setBusy(false); if (error) { setErro('Código inválido ou expirado.'); return; } onClose(); };

  const title = modo === 'opcoes' ? 'Entrar / Criar conta' : (modo === 'email' ? 'Entrar com e-mail' : 'Confirme o código');
  const back = modo === 'opcoes' ? undefined : () => { setErro(''); setModo(modo === 'codigo' ? 'email' : 'opcoes'); };

  return (
    <ScreenModal title={title} onClose={onClose} onBack={back}>
      {modo === 'opcoes' && (
        <>
          <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 14 }}>Login é opcional — você pode comprar como visitante e criar conta quando quiser.</p>
          <button style={{ ...btn, background: 'var(--white)', border: '1px solid var(--gray-300)', color: 'var(--gray-800)' }} disabled={busy} onClick={google}>
            <span style={{ fontWeight: 800, color: '#4285F4', fontSize: 17 }}>G</span> Continuar com Google
          </button>
          <button style={{ ...btn, background: 'var(--grape)', border: 'none', color: '#fff' }} disabled={busy} onClick={() => { setErro(''); setModo('email'); }}>
            ✉️ Continuar com e-mail
          </button>
          {erro && <p style={erroStyle}>{erro}</p>}
          <button style={semConta} onClick={onClose}>Continuar sem uma conta</button>
        </>
      )}
      {modo === 'email' && (
        <>
          <input className="form-input" type="email" inputMode="email" placeholder="seu@email.com" value={email} onChange={e => setEmail(e.target.value)} />
          {erro && <p style={erroStyle}>{erro}</p>}
          <button style={{ ...btn, background: 'var(--grape)', color: '#fff', border: 'none', marginTop: 10 }} disabled={busy} onClick={enviar}>{busy ? 'Enviando...' : 'Enviar código'}</button>
          <button style={semConta} onClick={onClose}>Continuar sem uma conta</button>
        </>
      )}
      {modo === 'codigo' && (
        <>
          <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 8 }}>Enviamos um código para <b>{email}</b>.</p>
          <input className="form-input" type="text" inputMode="numeric" placeholder="Código" value={codigo} onChange={e => setCodigo(e.target.value)} />
          {erro && <p style={erroStyle}>{erro}</p>}
          <button style={{ ...btn, background: 'var(--grape)', color: '#fff', border: 'none', marginTop: 10 }} disabled={busy} onClick={confirmar}>{busy ? 'Verificando...' : 'Confirmar'}</button>
          <button style={semConta} onClick={onClose}>Continuar sem uma conta</button>
        </>
      )}
    </ScreenModal>
  );
}
