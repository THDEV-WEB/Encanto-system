/* components/auth/OtpForm.jsx — passo do codigo OTP (AUTH-01). Isolado/testavel. */
import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth.js';

export function OtpForm({ phone, onDone, onVoltar }) {
  const { confirmarCodigo } = useAuth();
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState('');
  const [verificando, setVerificando] = useState(false);

  const confirmar = async () => {
    setErro('');
    const c = codigo.replace(/\D/g, '');
    if (c.length < 4) { setErro('Digite o código recebido por SMS.'); return; }
    setVerificando(true);
    const { error } = await confirmarCodigo(phone, c);
    setVerificando(false);
    if (error) { setErro(error.message || 'Código inválido ou expirado.'); return; }
    onDone && onDone();
  };

  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 8 }}>Enviamos um código para {phone}.</p>
      <input className="form-input" type="text" inputMode="numeric" placeholder="Código"
        value={codigo} onChange={e => setCodigo(e.target.value)} />
      {erro && <p style={{ color: 'var(--red)', fontSize: 13, marginTop: 6 }}>{erro}</p>}
      <button className="btn-primary" disabled={verificando} onClick={confirmar} style={{ width: '100%', marginTop: 10 }}>
        {verificando ? 'Verificando...' : 'Confirmar'}
      </button>
      <button onClick={onVoltar} style={{ width: '100%', marginTop: 6, background: 'none', border: 'none', color: 'var(--gray-500)', cursor: 'pointer', fontSize: 13 }}>
        ← Trocar telefone
      </button>
    </>
  );
}
