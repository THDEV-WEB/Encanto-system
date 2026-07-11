/* components/auth/LoginSheet.jsx — folha de login opcional (AUTH-01). Fluxo: telefone -> SMS -> OTP.
   NUNCA bloqueia navegacao/carrinho/checkout: sempre oferece "Continuar como visitante". */
import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import { OtpForm } from './OtpForm.jsx';

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 3000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' };
const sheet = { background: 'var(--white)', width: '100%', maxWidth: 460, borderRadius: '18px 18px 0 0', padding: 20, boxShadow: '0 -8px 30px rgba(0,0,0,.2)' };
const hint = { fontSize: 13, color: 'var(--gray-500)', marginBottom: 10 };
const erroStyle = { color: 'var(--red)', fontSize: 13, marginTop: 6 };

export function LoginSheet({ onClose }) {
  const { entrar } = useAuth();
  const [fase, setFase] = useState('telefone'); // telefone | codigo
  const [phone, setPhone] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const e164 = () => '+55' + phone.replace(/\D/g, ''); // E.164 BR; ajustavel se atender outros paises

  const enviarCodigo = async () => {
    setErro('');
    if (phone.replace(/\D/g, '').length < 10) { setErro('Informe um telefone com DDD (mínimo 10 dígitos).'); return; }
    setEnviando(true);
    const { error } = await entrar(e164());
    setEnviando(false);
    if (error) { setErro(error.message || 'Não foi possível enviar o código.'); return; }
    setFase('codigo');
  };

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={sheet}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong style={{ fontSize: 16 }}>{fase === 'telefone' ? 'Entrar / Criar conta' : 'Confirme o código'}</strong>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        {fase === 'telefone' ? (
          <>
            <p style={hint}>Login é opcional — você pode comprar como visitante e criar conta quando quiser.</p>
            <input className="form-input" type="tel" placeholder="(38) 99999-9999"
              value={phone} onChange={e => setPhone(e.target.value)} />
            {erro && <p style={erroStyle}>{erro}</p>}
            <button className="btn-primary" disabled={enviando} onClick={enviarCodigo} style={{ width: '100%', marginTop: 10 }}>
              {enviando ? 'Enviando...' : 'Receber código por SMS'}
            </button>
          </>
        ) : (
          <OtpForm phone={e164()} onDone={onClose} onVoltar={() => setFase('telefone')} />
        )}

        <button onClick={onClose} style={{ width: '100%', marginTop: 12, background: 'none', border: 'none', color: 'var(--gray-500)', cursor: 'pointer', fontSize: 13 }}>
          Continuar como visitante
        </button>
      </div>
    </div>
  );
}
