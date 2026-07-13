/* components/ui/Toast.jsx — REF-CLIENTE-03. Toast leve, auto-contido e reutilizavel (sucesso | erro).
   Fixo na base, auto-dismiss, acima dos modais (zIndex > ScreenModal). aria-live p/ acessibilidade.
   Sem dependencias externas; nao toca a arquitetura. */
import { useEffect } from 'react';

export function Toast({ tipo = 'sucesso', children, onClose, duracao = 3600 }) {
  useEffect(() => {
    if (!duracao) return undefined;
    const id = setTimeout(() => onClose?.(), duracao);
    return () => clearTimeout(id);
  }, [duracao, onClose]);

  const erro = tipo === 'erro';
  const cor = erro ? 'var(--red)' : 'var(--grape)';
  return (
    <div role="status" aria-live="polite"
      style={{
        position: 'fixed', left: '50%', bottom: 'max(24px, env(safe-area-inset-bottom))',
        transform: 'translateX(-50%)', zIndex: 4000, background: 'var(--white)',
        border: `1px solid ${cor}`, color: 'var(--gray-800)', borderRadius: 12,
        padding: '12px 15px', boxShadow: '0 14px 44px rgba(0,0,0,.24)', maxWidth: 'min(92vw, 440px)',
        display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13.5, lineHeight: 1.45,
      }}>
      <span style={{ fontSize: 16, lineHeight: 1.2 }}>{erro ? '⚠️' : '✅'}</span>
      <span style={{ flex: 1 }}>{children}</span>
      <button onClick={() => onClose?.()} aria-label="Fechar"
        style={{ border: 'none', background: 'none', color: 'var(--gray-400)', cursor: 'pointer', fontSize: 15, padding: 0, lineHeight: 1 }}>✕</button>
    </div>
  );
}
