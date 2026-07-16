/* components/pedidos/PedidoTimeline.jsx — REF-CLIENTE-02 Onda 2: acompanhamento visual do pedido.
   Trilha: Recebido -> Em preparo -> Saiu para entrega -> Entregue. Usa order_events (timestamp de
   cada transicao) + orders.status (estado atual). 'cancelado' e mostrado a parte. So leitura. */
import { useState, useEffect } from 'react';
import { PedidosClienteService } from '../../services/PedidosClienteService.js';
import { fmtDataHoraLoja } from '../../utils/format.js';
import { TIMELINE, statusInfo, STATUS_INFO } from './pedidoStatus.js';

export function PedidoTimeline({ orderId, status }) {
  const [eventos, setEventos] = useState(null);
  useEffect(() => {
    let vivo = true;
    PedidosClienteService.eventos(orderId).then(e => { if (vivo) setEventos(e); });
    return () => { vivo = false; };
  }, [orderId]);

  if (status === 'cancelado') {
    const st = STATUS_INFO.cancelado;
    return (
      <div style={{ marginTop: 12, padding: '10px 12px', background: st.bg, color: st.cor, borderRadius: 10, fontSize: 13, fontWeight: 700 }}>
        {st.icon} Pedido cancelado
      </div>
    );
  }

  const tsDe = (st) => {
    if (!eventos) return null;
    const e = st === 'recebido'
      ? eventos.find(x => x.tipo === 'PEDIDO_CRIADO' || x.status_novo === 'recebido')
      : eventos.find(x => x.status_novo === st);
    return e?.created_at || null;
  };
  const atualIdx = TIMELINE.indexOf(status);

  return (
    <div style={{ marginTop: 12, paddingTop: 4 }}>
      {TIMELINE.map((st, i) => {
        const info = statusInfo(st);
        const atingido = atualIdx >= 0 && i <= atualIdx;
        const atual = i === atualIdx;
        const ts = tsDe(st);
        return (
          <div key={st} style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0, background: atingido ? info.cor : 'var(--gray-100)', color: atingido ? '#fff' : 'var(--gray-400)', boxShadow: atual ? `0 0 0 3px ${info.bg}` : 'none' }}>
                {atingido ? '✓' : i + 1}
              </span>
              {i < TIMELINE.length - 1 && <span style={{ width: 2, flex: 1, minHeight: 18, background: atualIdx > i ? info.cor : 'var(--gray-100)' }} />}
            </div>
            <div style={{ paddingBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: atual ? 800 : 600, color: atingido ? 'var(--gray-800)' : 'var(--gray-400)' }}>{info.icon} {info.label}</div>
              {ts && <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 1 }}>{fmtDataHoraLoja(ts)}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
