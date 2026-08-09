/* components/menu/TermosScreen.jsx — tela Termos e Políticas (LOGIN-ARCH-02).
   REF-SAAS-01 · Onda 6.2: conteúdo vem de company_info.termosSecoes (Supabase, administrável na Central
   de Configuração da Empresa) — não mais de constants/storeInfo.js (TERMOS_SECOES, removido). Mesmo
   padrão já usado por SobreScreen.jsx (company_info.sobre). */
import { ScreenModal } from './ScreenModal.jsx';
import { useCompanyInfo } from '../../hooks/useCompanyInfo.js';

export function TermosScreen({ onClose }) {
  const { termosSecoes } = useCompanyInfo();
  return (
    <ScreenModal title="Termos e Políticas" onClose={onClose}>
      {termosSecoes.map((s, i) => (
        <div key={i} style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{s.titulo}</div>
          <p style={{ fontSize: 13, color: 'var(--gray-600)', lineHeight: 1.6, margin: 0 }}>{s.corpo}</p>
        </div>
      ))}
    </ScreenModal>
  );
}
