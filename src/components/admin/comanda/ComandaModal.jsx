/* components/admin/comanda/ComandaModal.jsx — REF-ORDER-01 · Parte 1.
   Modal do painel admin: PREVIEW fiel (iframe srcDoc com o MESMO HTML da impressao — WYSIWYG) + selecao
   de largura (80mm/58mm) + Imprimir/Reimprimir. Chrome do modal em estilo inline (nao depende do index.css).
   Sem estado de dados: deriva tudo do pedido via o dominio puro (buildComanda -> comandaHTML).
   `endereco` (REF-COMANDA-ENDERECO-01): endereco estruturado do pedido (DS.getPedidoEndereco), buscado
   pelo pai (AdminPedidos) — chega null enquanto carrega ou quando o pedido nao tem vinculo (comandaModel
   cai no texto livre nesse caso). */
import { useMemo, useState } from 'react';
import { useCompanyInfo } from '../../../hooks/useCompanyInfo.js';   // REF-COMPANY-02: nome curto na comanda
import { buildComanda } from './comandaModel.js';
import { comandaHTML } from './comandaHtml.js';
import { comandaTexto } from './comandaTexto.js';
import { printComanda } from './printComanda.js';

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(20,14,10,.55)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
};
const card = {
  background: '#fff', borderRadius: 16, width: 'min(430px, 96vw)', maxHeight: '92vh',
  display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 18px 50px rgba(0,0,0,.35)',
};
const head = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '14px 16px', borderBottom: '1px solid #E8DCC8',
};
const btn = (bg, fg) => ({
  border: 'none', borderRadius: 10, padding: '10px 16px', fontSize: 14, fontWeight: 700,
  cursor: 'pointer', background: bg, color: fg, fontFamily: 'inherit',
});
const paperBtn = (on) => ({
  border: on ? '2px solid #A62786' : '1.5px solid #E8DCC8', borderRadius: 8, padding: '5px 12px',
  fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  background: on ? '#f9edf6' : '#fff', color: on ? '#A62786' : '#6B5D50',
});

export function ComandaModal({ order, numero, totalPedidos, endereco, onClose }) {
  const companyInfo = useCompanyInfo();
  const [paper, setPaper] = useState('80mm');
  const [copiado, setCopiado] = useState(false);
  const vm = useMemo(
    () => buildComanda(order, { numero, totalPedidosCliente: totalPedidos, companyInfo, enderecoEstruturado: endereco }),
    [order, numero, totalPedidos, companyInfo, endereco],
  );
  const html  = useMemo(() => comandaHTML(vm, { paper }), [vm, paper]);
  const texto = useMemo(() => comandaTexto(vm), [vm]);
  if (!order) return null;

  /* FIX (achado REF-REGRESSION-01 · P5): faltava "copiar"/"compartilhar via WhatsApp" — a comanda só
     podia ser vista/impressa, nunca encaminhada de outro jeito (ex.: repassar pro entregador ou pro
     grupo da cozinha sem imprimir). navigator.clipboard exige contexto seguro (https/localhost) —
     já é a realidade do app (Vercel + dev local); sem suporte, falha graciosamente (sem crash). */
  const copiar = async () => {
    try { await navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }
    catch { /* clipboard indisponível (permissão/navegador antigo) — botão só não dá o feedback de sucesso */ }
  };
  const compartilharWhatsapp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
  };
  return (
    <div style={overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Comanda do pedido">
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={head}>
          <strong style={{ fontSize: 15 }}>🧾 Comanda</strong>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#9C8870', marginRight: 2 }}>Largura</span>
            <button style={paperBtn(paper === '80mm')} onClick={() => setPaper('80mm')}>80mm</button>
            <button style={paperBtn(paper === '58mm')} onClick={() => setPaper('58mm')}>58mm</button>
          </div>
        </div>
        <div style={{ background: '#EFE7DA', padding: 14, overflow: 'auto', flex: 1 }}>
          <iframe
            title="Pré-visualização da comanda"
            srcDoc={html}
            style={{ width: '100%', height: 560, border: 'none', background: '#fff', borderRadius: 8, boxShadow: '0 2px 10px rgba(0,0,0,.12)' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap', padding: '12px 16px', borderTop: '1px solid #E8DCC8' }}>
          <button style={btn('#F1EADF', '#6B5D50')} onClick={onClose}>Fechar</button>
          <button style={btn('#F1EADF', '#6B5D50')} onClick={copiar}>{copiado ? '✅ Copiado!' : '📋 Copiar'}</button>
          <button style={btn('#25D366', '#fff')} onClick={compartilharWhatsapp}>📤 WhatsApp</button>
          <button style={btn('#A62786', '#fff')} onClick={() => printComanda(html)}>🖨️ Imprimir / Reimprimir</button>
        </div>
      </div>
    </div>
  );
}
