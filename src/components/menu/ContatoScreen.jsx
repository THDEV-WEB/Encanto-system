/* components/menu/ContatoScreen.jsx — tela de Contato (LOGIN-ARCH-02). WhatsApp abre conversa.
   REF-COMPANY-01: telefone/whatsapp/e-mail vem do cadastro da empresa (useCompanyInfo, fonte unica
   Supabase) — nunca mais hardcoded. Endereco usa STORE_INFO.retirada (endereco de retirada — ainda
   estatico; preparado para se tornar dinamico numa fase futura, sem exigir mudanca de arquitetura
   aqui). Corrigido nesta subfase: lia STORE_INFO.endereco (chave que nao existe mais desde a
   REF-COMPANY-03 — TypeError garantido em toda renderizacao, achado incidental ao editar este arquivo
   pra Onda 7.1, sem relacao com WhatsApp).
   REF-SAAS-01 · Onda 7.1: telefone/whatsapp/email OCULTAM a propria linha quando vazios (loja ainda
   sem contato configurado) — mesmo padrao "nunca link morto" ja usado pelos campos opcionais de
   company_info (redes sociais). */
import { ScreenModal } from './ScreenModal.jsx';
import { STORE_INFO } from '../../constants/storeInfo.js';
import { useCompanyInfo } from '../../hooks/useCompanyInfo.js';
import { formatarTelefoneBR } from '../../services/company/companyInfo.js';

const row = { display: 'flex', gap: 12, alignItems: 'center', padding: '14px 0', borderBottom: '1px solid var(--gray-100)', textDecoration: 'none', color: 'inherit' };

export function ContatoScreen({ onClose }) {
  const { telefone, whatsapp, email } = useCompanyInfo();
  const item = (icone, titulo, sub) => (<><span style={{ fontSize: 22 }}>{icone}</span><div><div style={{ fontWeight: 700 }}>{titulo}</div><div style={{ fontSize: 13, color: 'var(--gray-500)' }}>{sub}</div></div></>);
  return (
    <ScreenModal title="Contato" onClose={onClose}>
      {whatsapp && <a style={row} href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer">{item('💬', 'WhatsApp', 'Abrir conversa')}</a>}
      {telefone && <a style={row} href={`tel:+${telefone}`}>{item('📞', 'Telefone', formatarTelefoneBR(telefone))}</a>}
      {email && <a style={row} href={`mailto:${email}`}>{item('✉️', 'E-mail', email)}</a>}
      <div style={{ ...row, borderBottom: 'none' }}>{item('📍', 'Endereço', STORE_INFO.retirada)}</div>
    </ScreenModal>
  );
}
