/* components/menu/SideDrawer.jsx — drawer lateral da loja (LOGIN-ARCH-02.1). Guest-first.
   Topo: entrar/conta · Fidelidade · Contato · Sobre · Termos · redes. Entrada com slide suave; safe-area. */
import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import { STORE_INFO } from '../../constants/storeInfo.js';

const overlay = (shown) => ({ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 3100, display: 'flex', justifyContent: 'flex-end', opacity: shown ? 1 : 0, transition: 'opacity .2s ease' });
const drawer = (shown) => ({ width: '86%', maxWidth: 340, height: '100%', background: 'var(--white)', boxShadow: '-8px 0 30px rgba(0,0,0,.2)', display: 'flex', flexDirection: 'column', overflowY: 'auto', transform: shown ? 'translateX(0)' : 'translateX(100%)', transition: 'transform .26s cubic-bezier(.2,.8,.2,1)', paddingBottom: 'env(safe-area-inset-bottom)' });
const item = { display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', border: 'none', background: 'none', width: '100%', textAlign: 'left', cursor: 'pointer', fontSize: 15, color: 'var(--gray-800)', borderBottom: '1px solid var(--gray-100)' };
const socialBtn = { width: 44, height: 44, borderRadius: '50%', background: 'var(--grape-pale)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, textDecoration: 'none' };

export function SideDrawer({ onClose, onNavigate }) {
  const { isLogged, user, customer, sair } = useAuth();
  const { social } = STORE_INFO;
  const [shown, setShown] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(id); }, []);

  const nome = customer?.name || user?.user_metadata?.full_name || user?.user_metadata?.name || (user?.email ? user.email.split('@')[0] : '');
  const inicial = (nome || 'U').trim().charAt(0).toUpperCase();
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || '';

  return (
    <div style={overlay(shown)} onClick={e => e.target === e.currentTarget && onClose()}>
      <aside style={drawer(shown)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 20px', borderBottom: '1px solid var(--gray-100)' }}>
          <strong style={{ fontSize: 16 }}>Menu</strong>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--gray-500)' }} aria-label="Fechar">✕</button>
        </div>

        {/* Topo — entrar / conta */}
        <button style={{ ...item, background: 'var(--grape-pale)' }} onClick={() => onNavigate('login')}>
          {isLogged
            ? (avatarUrl
                ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                : <span style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--grape)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18, flexShrink: 0 }}>{inicial}</span>)
            : <span style={{ fontSize: 22, width: 40, textAlign: 'center', flexShrink: 0 }}>🔑</span>}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{isLogged ? (nome || 'Minha conta') : 'Entre ou cadastre-se'}</div>
            <div style={{ fontSize: 12, color: 'var(--gray-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{isLogged ? (user?.email || 'Conectado') : 'Acesse pedidos e benefícios'}</div>
          </div>
        </button>

        <button style={item} onClick={() => onNavigate('fidelidade')}><span style={{ fontSize: 18 }}>🎁</span> Programa de Fidelidade</button>
        <button style={item} onClick={() => onNavigate('contato')}><span style={{ fontSize: 18 }}>📞</span> Contato</button>
        <button style={item} onClick={() => onNavigate('sobre')}><span style={{ fontSize: 18 }}>🏪</span> Sobre nós</button>
        <button style={item} onClick={() => onNavigate('termos')}><span style={{ fontSize: 18 }}>📄</span> Termos e Políticas</button>

        <div style={{ display: 'flex', gap: 14, padding: '20px', marginTop: 'auto' }}>
          <a href={social.instagram} target="_blank" rel="noreferrer" aria-label="Instagram" style={socialBtn}>📷</a>
          <a href={social.facebook} target="_blank" rel="noreferrer" aria-label="Facebook" style={socialBtn}>📘</a>
        </div>

        {isLogged && (
          <button style={{ ...item, color: 'var(--red)', borderTop: '1px solid var(--gray-100)', borderBottom: 'none' }} onClick={async () => { await sair(); onClose(); }}>
            <span style={{ fontSize: 18 }}>🚪</span> Sair
          </button>
        )}
      </aside>
    </div>
  );
}
