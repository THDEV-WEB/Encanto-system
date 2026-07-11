/* components/auth/AccountMenu.jsx — painel da conta do cliente logado (AUTH-01).
   Sair + ganchos dos beneficios FUTUROS (historico/favoritos/fidelidade) — ainda nao implementados. */
import { useAuth } from '../../hooks/useAuth.js';

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 3000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' };
const sheet = { background: 'var(--white)', width: '100%', maxWidth: 460, borderRadius: '18px 18px 0 0', padding: 20, boxShadow: '0 -8px 30px rgba(0,0,0,.2)' };

export function AccountMenu({ onClose }) {
  const { user, sair } = useAuth();
  const tel = user?.phone || user?.user_metadata?.phone || '';

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={sheet}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong style={{ fontSize: 16 }}>Minha conta</strong>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        <p style={{ fontSize: 14, color: 'var(--gray-700)', marginBottom: 4 }}>👤 {tel ? '+' + tel : 'Conectado'}</p>
        <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0', fontSize: 13, color: 'var(--gray-400)', lineHeight: 2 }}>
          <li>🧾 Histórico de pedidos <em>(em breve)</em></li>
          <li>⭐ Pedidos favoritos <em>(em breve)</em></li>
          <li>💜 Fidelidade / cashback <em>(em breve)</em></li>
        </ul>
        <button className="btn-secondary" style={{ width: '100%' }} onClick={async () => { await sair(); onClose(); }}>
          Sair
        </button>
      </div>
    </div>
  );
}
