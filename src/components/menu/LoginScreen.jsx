/* components/menu/LoginScreen.jsx — login GUEST-FIRST (LOGIN-ARCH-02.2): Google + e-mail por CODIGO.
   E-mail = OTP de 6 digitos (verifyOtp), sem magic link / sem abrir links externos. Se ja logado,
   vira "Minha conta" (nome/avatar/e-mail/telefone + Sair) e NUNCA repede login. "Continuar sem uma
   conta" sempre disponivel nas opcoes — nunca bloqueia a compra. */
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import { ScreenModal } from './ScreenModal.jsx';
import { nomeExibicao, inicialExibicao, avatarUrlDe, telefoneExibicao } from './userDisplay.js';

const amigavel = (e) => /provider|not enabled|unsupported|disabled|signup/i.test(e?.message || '')
  ? 'Este login ainda não está disponível. Você pode continuar como visitante. 🙂'
  : (e?.message || 'Não foi possível continuar.');

const btn = { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px 16px', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 10 };
const erroStyle = { color: 'var(--red)', fontSize: 13, marginTop: 6, marginBottom: 4 };
const semConta = { width: '100%', marginTop: 8, background: 'none', border: 'none', color: 'var(--gray-500)', cursor: 'pointer', fontSize: 13 };
const linkBtn = { flex: 1, background: 'none', border: 'none', color: 'var(--grape)', cursor: 'pointer', fontSize: 13, fontWeight: 700, padding: '8px 4px' };
const avatarBox = (s) => ({ width: s, height: s, borderRadius: '50%', background: 'var(--grape)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: s * 0.42, flexShrink: 0 });
const oneLine = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

/* Entrada de codigo de 6 digitos (auto-avanço, backspace, colar). Sem link externo. */
function CodigoInput({ valor, onChange, onEnter }) {
  const refs = useRef([]);
  const digs = Array.from({ length: 6 }, (_, i) => valor[i] || '');
  const setAt = (i, ch) => { const a = digs.slice(); a[i] = ch; onChange(a.join('')); };
  const onCh = (i, e) => {
    const v = e.target.value.replace(/\D/g, '');
    if (!v) return setAt(i, '');
    setAt(i, v[v.length - 1]);
    if (i < 5) refs.current[i + 1]?.focus();
  };
  const onKey = (i, e) => {
    if (e.key === 'Backspace' && !digs[i] && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'Enter') onEnter?.();
  };
  const onPaste = (e) => {
    const p = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    if (!p) return; e.preventDefault(); onChange(p); refs.current[Math.min(p.length, 5)]?.focus();
  };
  const cell = { flex: '1 1 0', minWidth: 0, maxWidth: 46, height: 52, textAlign: 'center', fontSize: 22, fontWeight: 700, borderRadius: 12, border: '1.5px solid var(--gray-300)', outline: 'none', padding: 0, background: 'var(--white)', color: 'var(--gray-800)' };
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', margin: '8px 0 4px' }} onPaste={onPaste}>
      {digs.map((d, i) => (
        <input key={i} ref={el => (refs.current[i] = el)} value={d} inputMode="numeric" maxLength={1}
          autoComplete="one-time-code" onChange={e => onCh(i, e)} onKeyDown={e => onKey(i, e)}
          style={cell} aria-label={`Dígito ${i + 1}`} />
      ))}
    </div>
  );
}

export function LoginScreen({ onClose }) {
  const { entrarComGoogle, enviarEmail, confirmarEmail, isLogged, user, customer, precisaTelefone, sair } = useAuth();
  const [modo, setModo] = useState('opcoes'); // opcoes | email | codigo
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => { if (cooldown <= 0) return; const id = setTimeout(() => setCooldown(cooldown - 1), 1000); return () => clearTimeout(id); }, [cooldown]);

  /* Ja autenticado -> mostra a CONTA, nunca pede login de novo (LOGIN-ARCH-02.2). */
  if (isLogged) {
    const nome = nomeExibicao(customer, user);
    const avatarUrl = avatarUrlDe(user);
    return (
      <ScreenModal title="Minha conta" onClose={onClose}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          {avatarUrl
            ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
            : <span style={avatarBox(56)}>{inicialExibicao(nome)}</span>}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 17, ...oneLine }}>{nome}</div>
            {user?.email && <div style={{ fontSize: 13, color: 'var(--gray-500)', ...oneLine }}>{user.email}</div>}
            <div style={{ fontSize: 13, color: 'var(--gray-500)' }}>{telefoneExibicao(customer)}</div>
          </div>
        </div>
        {precisaTelefone && <p style={{ fontSize: 13, color: 'var(--grape)', marginBottom: 12 }}>Complete seu cadastro com telefone para pedidos e benefícios.</p>}
        <button style={{ ...btn, background: 'var(--white)', border: '1px solid var(--gray-300)', color: 'var(--red)', marginBottom: 0 }} onClick={async () => { await sair(); onClose(); }}>
          🚪 Sair da conta
        </button>
      </ScreenModal>
    );
  }

  const google = async () => { setErro(''); setBusy(true); const { error } = await entrarComGoogle(); setBusy(false); if (error) setErro(amigavel(error)); /* sucesso -> redirect do OAuth */ };
  const enviar = async () => {
    setErro('');
    if (!/.+@.+\..+/.test(email.trim())) { setErro('Digite um e-mail válido.'); return; }
    setBusy(true); const { error } = await enviarEmail(email.trim()); setBusy(false);
    if (error) { setErro(amigavel(error)); return; }
    setCodigo(''); setCooldown(30); setModo('codigo');
  };
  const reenviar = async () => {
    if (cooldown > 0 || busy) return;
    setErro(''); setBusy(true); const { error } = await enviarEmail(email.trim()); setBusy(false);
    if (error) { setErro(amigavel(error)); return; }
    setCodigo(''); setCooldown(30);
  };
  const confirmar = async () => {
    setErro('');
    if (codigo.replace(/\D/g, '').length < 6) { setErro('Digite os 6 dígitos do código.'); return; }
    setBusy(true); const { error } = await confirmarEmail(email.trim(), codigo.replace(/\D/g, '')); setBusy(false);
    if (error) { setErro('Código inválido ou expirado.'); return; }
    onClose();
  };

  const title = modo === 'opcoes' ? 'Entrar / Criar conta' : (modo === 'email' ? 'Entrar com e-mail' : 'Confirme o código');
  const back = modo === 'opcoes' ? undefined : () => { setErro(''); setModo(modo === 'codigo' ? 'email' : 'opcoes'); };

  return (
    <ScreenModal title={title} onClose={onClose} onBack={back}>
      {modo === 'opcoes' && (
        <>
          <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 14 }}>Login é opcional — você pode comprar como visitante e criar conta quando quiser.</p>
          <button data-testid="login-google-btn" style={{ ...btn, background: 'var(--white)', border: '1px solid var(--gray-300)', color: 'var(--gray-800)' }} disabled={busy} onClick={google}>
            <span style={{ fontWeight: 800, color: '#4285F4', fontSize: 17 }}>G</span> Continuar com Google
          </button>
          <button data-testid="login-email-btn" style={{ ...btn, background: 'var(--grape)', border: 'none', color: '#fff' }} disabled={busy} onClick={() => { setErro(''); setModo('email'); }}>
            ✉️ Continuar com e-mail
          </button>
          {erro && <p style={erroStyle}>{erro}</p>}
          <button style={semConta} onClick={onClose}>Continuar sem uma conta</button>
        </>
      )}

      {modo === 'email' && (
        <>
          <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 10 }}>Digite seu e-mail — enviaremos um código de 6 dígitos.</p>
          <input className="form-input" type="email" inputMode="email" autoFocus placeholder="seu@email.com"
            value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && enviar()} />
          {erro && <p style={erroStyle}>{erro}</p>}
          <button data-testid="login-send-code-btn" style={{ ...btn, background: 'var(--grape)', color: '#fff', border: 'none', marginTop: 10 }} disabled={busy} onClick={enviar}>{busy ? 'Enviando...' : 'Enviar código'}</button>
          <button style={semConta} onClick={onClose}>Continuar sem uma conta</button>
        </>
      )}

      {modo === 'codigo' && (
        <>
          <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 2 }}>Código enviado para:</p>
          <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, ...oneLine }}>{email}</p>
          <CodigoInput valor={codigo} onChange={setCodigo} onEnter={confirmar} />
          {erro && <p style={erroStyle}>{erro}</p>}
          <button data-testid="login-confirm-code-btn" style={{ ...btn, background: 'var(--grape)', color: '#fff', border: 'none', marginTop: 10 }} disabled={busy} onClick={confirmar}>{busy ? 'Verificando...' : 'Confirmar'}</button>
          <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
            <button style={{ ...linkBtn, opacity: cooldown > 0 || busy ? 0.5 : 1, cursor: cooldown > 0 || busy ? 'default' : 'pointer' }} disabled={cooldown > 0 || busy} onClick={reenviar}>
              {cooldown > 0 ? `Reenviar em ${cooldown}s` : 'Reenviar código'}
            </button>
            <button style={linkBtn} onClick={() => { setErro(''); setCodigo(''); setModo('email'); }}>Voltar</button>
          </div>
        </>
      )}
    </ScreenModal>
  );
}
