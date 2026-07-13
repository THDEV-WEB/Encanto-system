/* components/menu/SobreScreen.jsx — tela Sobre nós (LOGIN-ARCH-02). Texto vem de constants/storeInfo.
   REF-BUSINESS-HOURS-01: exibe também a grade de horário de funcionamento — fonte única, derivada do
   módulo services/businessHours (nada de horário hardcoded aqui). */
import { ScreenModal } from './ScreenModal.jsx';
import { SOBRE_TEXTO } from '../../constants/storeInfo.js';
import { horarioSemanal } from '../../services/businessHours/index.js';

const linha = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', fontSize: 13.5, borderBottom: '1px solid var(--gray-100)' };

export function SobreScreen({ onClose }) {
  const grade = horarioSemanal();
  return (
    <ScreenModal title="Sobre nós" onClose={onClose}>
      {SOBRE_TEXTO.map((p, i) => (
        <p key={i} style={{ fontSize: 14, color: 'var(--gray-700)', lineHeight: 1.7, marginBottom: 12 }}>{p}</p>
      ))}

      <div style={{ borderTop: '1px solid var(--gray-100)', paddingTop: 16, marginTop: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--gray-800)', marginBottom: 10 }}>🕒 Horário de funcionamento</div>
        {grade.map((d) => (
          <div key={d.dia} style={{ ...linha, ...(d.dia === 6 ? { borderBottom: 'none' } : null) }}>
            <span style={{ color: 'var(--gray-600)' }}>{d.nome}</span>
            <strong style={{ color: d.fechado ? 'var(--gray-400)' : 'var(--gray-800)', textAlign: 'right' }}>
              {d.fechado ? 'Fechado' : d.periodos.map((p) => `${p.inicio}–${p.fim}`).join('  ·  ')}
            </strong>
          </div>
        ))}
      </div>
    </ScreenModal>
  );
}
