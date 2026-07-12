/* components/menu/ScreenModal.jsx — moldura de tela/modal centralizado do menu (LOGIN-ARCH-02.1).
   Entrada suave (fade + leve scale); rolagem interna; respeita safe-area (iPhone). */
import { useState, useEffect } from 'react';

const overlay = (shown) => ({ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 3200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, opacity: shown ? 1 : 0, transition: 'opacity .18s ease' });
const sheet = (shown) => ({ background: 'var(--white)', width: '100%', maxWidth: 440, borderRadius: 18, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)', transform: shown ? 'translateY(0) scale(1)' : 'translateY(10px) scale(.985)', opacity: shown ? 1 : 0, transition: 'transform .22s cubic-bezier(.2,.8,.2,1), opacity .2s ease' });
const head = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid var(--gray-100)', position: 'sticky', top: 0, background: 'var(--white)', borderRadius: '18px 18px 0 0' };
const ico = { border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--gray-500)', width: 28 };

export function ScreenModal({ title, onClose, onBack, children }) {
  const [shown, setShown] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(id); }, []);
  return (
    <div style={overlay(shown)} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={sheet(shown)}>
        <div style={head}>
          {onBack ? <button style={ico} onClick={onBack} aria-label="Voltar">←</button> : <span style={{ width: 28 }} />}
          <strong style={{ fontSize: 16 }}>{title}</strong>
          <button style={ico} onClick={onClose} aria-label="Fechar">✕</button>
        </div>
        <div style={{ padding: 18, paddingBottom: 'max(18px, env(safe-area-inset-bottom))' }}>{children}</div>
      </div>
    </div>
  );
}
