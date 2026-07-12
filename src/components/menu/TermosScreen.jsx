/* components/menu/TermosScreen.jsx — tela Termos e Políticas (LOGIN-ARCH-02). Placeholder organizado. */
import { ScreenModal } from './ScreenModal.jsx';
import { TERMOS_SECOES } from '../../constants/storeInfo.js';

export function TermosScreen({ onClose }) {
  return (
    <ScreenModal title="Termos e Políticas" onClose={onClose}>
      {TERMOS_SECOES.map((s, i) => (
        <div key={i} style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{s.titulo}</div>
          <p style={{ fontSize: 13, color: 'var(--gray-600)', lineHeight: 1.6, margin: 0 }}>{s.corpo}</p>
        </div>
      ))}
    </ScreenModal>
  );
}
