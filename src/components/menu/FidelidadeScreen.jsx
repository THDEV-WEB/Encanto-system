/* components/menu/FidelidadeScreen.jsx — tela Programa de Fidelidade (LOGIN-ARCH-02, descritiva). */
import { ScreenModal } from './ScreenModal.jsx';
import { FIDELIDADE_TEXTO } from '../../constants/storeInfo.js';

export function FidelidadeScreen({ onClose }) {
  return (
    <ScreenModal title="Programa de Fidelidade" onClose={onClose}>
      <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }}>💜</div>
      {FIDELIDADE_TEXTO.map((p, i) => (
        <p key={i} style={{ fontSize: 14, color: 'var(--gray-700)', lineHeight: 1.7, marginBottom: 12 }}>{p}</p>
      ))}
    </ScreenModal>
  );
}
