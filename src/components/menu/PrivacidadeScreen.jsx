/* components/menu/PrivacidadeScreen.jsx — tela Política de Privacidade (REF-LGPD-01 · Onda 1 · LGPD-R02).
   Conteudo FIXO (constants/privacyPolicy.js) -- ao contrario de TermosScreen (company_info.termosSecoes,
   editavel por loja), esta tela descreve o funcionamento tecnico real da PLATAFORMA, igual pra todas as
   lojas, com versao e data visiveis (o achado original era exatamente a ausencia disso). */
import { ScreenModal } from './ScreenModal.jsx';
import {
  PRIVACY_POLICY_SECTIONS,
  PRIVACY_POLICY_VERSION,
  PRIVACY_POLICY_UPDATED_AT_HUMANO,
} from '../../constants/privacyPolicy.js';

export function PrivacidadeScreen({ onClose }) {
  return (
    <ScreenModal title="Política de Privacidade" onClose={onClose}>
      <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 16 }}>
        Versão {PRIVACY_POLICY_VERSION} · atualizada em {PRIVACY_POLICY_UPDATED_AT_HUMANO}
      </div>
      {PRIVACY_POLICY_SECTIONS.map((s, i) => (
        <div key={i} style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{s.titulo}</div>
          {s.paragrafos.map((p, j) => (
            <p key={j} style={{ fontSize: 13, color: 'var(--gray-600)', lineHeight: 1.6, margin: '0 0 6px' }}>{p}</p>
          ))}
        </div>
      ))}
    </ScreenModal>
  );
}
