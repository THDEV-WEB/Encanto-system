/* components/menu/ScreenModal.jsx — moldura de tela/modal centralizado do menu (LOGIN-ARCH-02). */
const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 3200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 };
const sheet = { background: 'var(--white)', width: '100%', maxWidth: 440, borderRadius: 18, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)' };
const head = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid var(--gray-100)', position: 'sticky', top: 0, background: 'var(--white)', borderRadius: '18px 18px 0 0' };
const ico = { border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--gray-500)', width: 28 };

export function ScreenModal({ title, onClose, onBack, children }) {
  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={sheet}>
        <div style={head}>
          {onBack ? <button style={ico} onClick={onBack}>←</button> : <span style={{ width: 28 }} />}
          <strong style={{ fontSize: 16 }}>{title}</strong>
          <button style={ico} onClick={onClose} aria-label="Fechar">✕</button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>
  );
}
