/* components/menu/SobreScreen.jsx — tela Sobre nós (LOGIN-ARCH-02). Texto vem de constants/storeInfo. */
import { ScreenModal } from './ScreenModal.jsx';
import { SOBRE_TEXTO } from '../../constants/storeInfo.js';

export function SobreScreen({ onClose }) {
  return (
    <ScreenModal title="Sobre nós" onClose={onClose}>
      {SOBRE_TEXTO.map((p, i) => (
        <p key={i} style={{ fontSize: 14, color: 'var(--gray-700)', lineHeight: 1.7, marginBottom: 12 }}>{p}</p>
      ))}
    </ScreenModal>
  );
}
