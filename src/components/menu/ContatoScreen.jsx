/* components/menu/ContatoScreen.jsx — tela de Contato (LOGIN-ARCH-02). WhatsApp abre conversa. */
import { ScreenModal } from './ScreenModal.jsx';
import { STORE_INFO } from '../../constants/storeInfo.js';
import { WHATSAPP } from '../../lib/supabase.js';

const row = { display: 'flex', gap: 12, alignItems: 'center', padding: '14px 0', borderBottom: '1px solid var(--gray-100)', textDecoration: 'none', color: 'inherit' };

export function ContatoScreen({ onClose }) {
  const { telefoneDisplay, telefoneDigits, email, endereco } = STORE_INFO;
  const item = (icone, titulo, sub) => (<><span style={{ fontSize: 22 }}>{icone}</span><div><div style={{ fontWeight: 700 }}>{titulo}</div><div style={{ fontSize: 13, color: 'var(--gray-500)' }}>{sub}</div></div></>);
  return (
    <ScreenModal title="Contato" onClose={onClose}>
      <a style={row} href={`https://wa.me/${WHATSAPP}`} target="_blank" rel="noreferrer">{item('💬', 'WhatsApp', 'Abrir conversa')}</a>
      <a style={row} href={`tel:+${telefoneDigits}`}>{item('📞', 'Telefone', telefoneDisplay)}</a>
      <a style={row} href={`mailto:${email}`}>{item('✉️', 'E-mail', email)}</a>
      <div style={{ ...row, borderBottom: 'none' }}>{item('📍', 'Endereço', (endereco.linha1 || 'A definir') + ' · ' + endereco.cidade)}</div>
    </ScreenModal>
  );
}
