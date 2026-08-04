/* components/menu/SobreScreen.jsx — tela Sobre nós (LOGIN-ARCH-02).
   REF-COMPANY-03: texto institucional vem de company_info.sobre (Supabase, administravel em Dados da
   Empresa) — nao mais de constants/storeInfo.js (SOBRE_TEXTO, removido). String unica com paragrafos
   separados por linha em branco ("\n\n"); o split so acontece aqui, na hora de renderizar.
   REF-BUSINESS-HOURS-01/04: exibe também a grade de horário de funcionamento — fonte única, derivada do
   cronograma OFICIAL do Supabase (useBusinessHoursSchedule -> horarioSemanal), nada de horário hardcoded
   aqui. Reativo: se o Admin salvar um novo cronograma/texto, a tela aqui converge sozinha (mesmo mecanismo
   do status da loja). */
import { ScreenModal } from './ScreenModal.jsx';
import { useCompanyInfo } from '../../hooks/useCompanyInfo.js';
import { horarioSemanal, semanaFromSchedule } from '../../services/businessHours/index.js';
import { useBusinessHoursSchedule } from '../../hooks/useBusinessHoursSchedule.js';

const linha = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', fontSize: 13.5, borderBottom: '1px solid var(--gray-100)' };

export function SobreScreen({ onClose }) {
  const companyInfo = useCompanyInfo();
  const cronograma = useBusinessHoursSchedule();
  const grade = horarioSemanal(semanaFromSchedule(cronograma) ?? undefined);
  const paragrafos = (companyInfo.sobre || '').split('\n\n').map((p) => p.trim()).filter(Boolean);
  return (
    <ScreenModal title="Sobre nós" onClose={onClose}>
      {paragrafos.map((p, i) => (
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
