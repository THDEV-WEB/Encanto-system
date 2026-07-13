/* components/pedidos/PedidoCard.jsx — REF-CLIENTE-02: cartao de um pedido (lista + expandir).
   Onda 1: resumo (numero, data, status, itens, total). Onda 2: timeline ao expandir.
   (Onda 3 enriquece o detalhe de itens; Onda 4 adiciona "Pedir novamente".) */
import { useState } from 'react';
import { fmt, fmtDate } from '../../utils/format.js';
import { statusInfo } from './pedidoStatus.js';
import { PedidoTimeline } from './PedidoTimeline.jsx';

const numeroPedido = (id) => '#' + String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase();
const resumoItens = (items) => {
  const arr = items || [];
  if (!arr.length) return 'Sem itens';
  const n = arr.slice(0, 3).map(i => `${i.quantity}× ${i.nome_produto}`).join(', ');
  return arr.length > 3 ? `${n}…` : n;
};

const card = { border: '1px solid var(--gray-100)', borderRadius: 14, padding: '14px 16px', marginBottom: 12, background: 'var(--white)' };
const badge = (st) => ({ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: st.cor, background: st.bg, borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap' });

export function PedidoCard({ pedido }) {
  const [aberto, setAberto] = useState(false);
  const st = statusInfo(pedido.status);
  const itens = pedido.order_items || [];

  return (
    <div style={card}>
      <button onClick={() => setAberto(a => !a)}
        style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'block', width: '100%' }}
        aria-expanded={aberto}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <strong style={{ fontSize: 14 }}>{numeroPedido(pedido.id)}</strong>
          <span style={badge(st)}>{st.icon} {st.label}</span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--gray-500)', marginTop: 2 }}>{fmtDate(pedido.created_at)}</div>
        <div style={{ fontSize: 13, color: 'var(--gray-700)', marginTop: 6, lineHeight: 1.4 }}>{resumoItens(itens)}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--grape)', fontWeight: 600 }}>
            {aberto ? 'ocultar acompanhamento ▲' : 'ver acompanhamento ▼'}
          </span>
          <strong style={{ fontSize: 16, color: 'var(--grape)' }}>{fmt(pedido.total)}</strong>
        </div>
      </button>

      {aberto && <PedidoTimeline orderId={pedido.id} status={pedido.status} />}
    </div>
  );
}
