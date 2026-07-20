/* components/admin/PedidoHistorico.jsx — REF-ORDER-01 · Parte 2 (Historico de status no admin).
   Le os order_events de UM pedido (DS.getEventos) e mostra a trilha de transicoes: status, data/hora e
   quem realizou (ator). SOMENTE LEITURA. Os eventos sao gravados por TRIGGER no banco (fonte unica) —
   ver migration REF-ORDER-01. Antes da migration aplicada, mostra apenas o evento de criacao (ou vazio).
   Reusa STATUS_INFO (fonte unica de rotulo/cor de status) para nao duplicar copy. */
import { useEffect, useState } from 'react';
import { DS } from '../../services/DataService.js';
import { fmtDataHoraLoja } from '../../utils/format.js';
import { statusInfo } from '../pedidos/pedidoStatus.js';

const TIPO_LABEL = {
  PEDIDO_CRIADO: 'Pedido recebido',
  STATUS_ALTERADO: 'Status alterado',
  CLIENTE_ATUALIZADO: 'Cliente atualizado',
};

/* Rotulo de UM evento: transicao de status vence (mais informativo); senao usa o tipo. */
function rotuloEvento(ev) {
  if (ev?.status_novo) return statusInfo(ev.status_novo).label;
  return TIPO_LABEL[ev?.tipo] || ev?.tipo || 'Evento';
}
function corEvento(ev) {
  return ev?.status_novo ? statusInfo(ev.status_novo).cor : '#6B7280';
}

export function PedidoHistorico({ orderId }) {
  const [eventos, setEventos] = useState(null);   // null = carregando
  useEffect(() => {
    let vivo = true;
    setEventos(null);
    DS.getEventos(orderId).then((e) => { if (vivo) setEventos(Array.isArray(e) ? e : []); });
    return () => { vivo = false; };
  }, [orderId]);

  if (eventos === null) {
    return <div style={{ fontSize: 12, color: 'var(--gray-500)', padding: '8px 4px' }}>Carregando histórico…</div>;
  }
  if (eventos.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--gray-500)', padding: '8px 4px' }}>Sem histórico registrado ainda.</div>;
  }

  return (
    <div style={{ padding: '6px 4px 2px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--gray-400)', marginBottom: 8 }}>
        Histórico de status
      </div>
      {eventos.map((ev, i) => {
        const cor = corEvento(ev);
        const ultimo = i === eventos.length - 1;
        return (
          <div key={ev.id ?? i} style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', flexShrink: 0, background: cor, marginTop: 3 }} />
              {!ultimo && <span style={{ width: 2, flex: 1, minHeight: 14, background: 'var(--gray-200)' }} />}
            </div>
            <div style={{ paddingBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-800)' }}>{rotuloEvento(ev)}</div>
              <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 1 }}>
                {fmtDataHoraLoja(ev.created_at)}{ev.ator ? ` · ${ev.ator}` : ''}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
