/* components/admin/comanda/ComandaModal.jsx — REF-ORDER-01 · Parte 1.
   Modal do painel admin: PREVIEW fiel (iframe srcDoc com o MESMO HTML da impressao — WYSIWYG) + botao
   Imprimir. Chrome do modal em estilo inline (nao depende do index.css, que esta sob outra frente).
   Sem estado de dados: deriva tudo do pedido via o dominio puro (buildComanda -> comandaHTML). */
import { useMemo } from 'react';
import { buildComanda } from './comandaModel.js';
import { comandaHTML } from './comandaHtml.js';
import { printComanda } from './printComanda.js';

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(20,14,10,.55)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
};
const card = {
  background: '#fff', borderRadius: 16, width: 'min(420px, 96vw)', maxHeight: '92vh',
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

export function ComandaModal({ order, numero, totalPedidos, onClose }) {
  const html = useMemo(
    () => comandaHTML(buildComanda(order, { numero, totalPedidosCliente: totalPedidos })),
    [order, numero, totalPedidos],
  );
  if (!order) return null;
  return (
    <div style={overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Comanda do pedido">
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={head}>
          <strong style={{ fontSize: 15 }}>🧾 Comanda</strong>
          <button style={btn('transparent', '#6B5D50')} onClick={onClose} aria-label="Fechar">✕</button>
        </div>
        <div style={{ background: '#EFE7DA', padding: 14, overflow: 'auto', flex: 1 }}>
          <iframe
            title="Pré-visualização da comanda"
            srcDoc={html}
            style={{ width: '100%', height: 560, border: 'none', background: '#fff', borderRadius: 8, boxShadow: '0 2px 10px rgba(0,0,0,.12)' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', padding: '12px 16px', borderTop: '1px solid #E8DCC8' }}>
          <button style={btn('#F1EADF', '#6B5D50')} onClick={onClose}>Fechar</button>
          <button style={btn('#A62786', '#fff')} onClick={() => printComanda(html)}>🖨️ Imprimir</button>
        </div>
      </div>
    </div>
  );
}
