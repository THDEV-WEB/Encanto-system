/* components/menu/FidelidadeScreen.jsx — tela Programa de Fidelidade (LOGIN-ARCH-02, descritiva).
   REF-SAAS-01 · Onda 6.2: conteúdo vem de company_info.fidelidadeTexto (Supabase, administrável na
   Central de Configuração da Empresa) — não mais de constants/storeInfo.js (FIDELIDADE_TEXTO, removido).
   Mesmo padrão já usado por SobreScreen.jsx (company_info.sobre). */
import { ScreenModal } from './ScreenModal.jsx';
import { useCompanyInfo } from '../../hooks/useCompanyInfo.js';

export function FidelidadeScreen({ onClose }) {
  const { fidelidadeTexto } = useCompanyInfo();
  return (
    <ScreenModal title="Programa de Fidelidade" onClose={onClose}>
      <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }}>💜</div>
      {fidelidadeTexto.map((p, i) => (
        <p key={i} style={{ fontSize: 14, color: 'var(--gray-700)', lineHeight: 1.7, marginBottom: 12 }}>{p}</p>
      ))}
    </ScreenModal>
  );
}
