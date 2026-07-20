/* components/admin/PedidoHistorico.jsx — REF-ORDER-01 · Parte 2 (Historico de status no admin).
   Le os order_events de UM pedido (DS.getEventos) e mostra a TRILHA DE STATUS com horarios reais e o ator.
   Os eventos ja sao gravados pelo audit do banco (trg_order_audit): PEDIDO_CRIADO/STATUS_ALTERADO/
   PEDIDO_ENTREGUE/PEDIDO_CANCELADO (todos com status_novo) + a coluna `usuario` (ator). Filtramos para a
   trilha de STATUS (status_novo != null) — eventos de edicao de dados (CLIENTE_ATUALIZADO/ITEM_ALTERADO)
   nao poluem a trilha. SOMENTE LEITURA. Reusa STATUS_INFO (fonte unica de rotulo/cor). */
import { useEffect, useState } from 'react';
import { DS } from '../../services/DataService.js';
import { fmtDataHoraLoja } from '../../utils/format.js';
import { statusInfo } from '../pedidos/pedidoStatus.js';

/* Rotulo de UM evento de status: usa o rotulo do status_novo (sempre presente na trilha). */
const rotuloEvento = (ev) => statusInfo(ev?.status_novo).label;
const corEvento = (ev) => statusInfo(ev?.status_novo).cor;
/* Ator: a coluna real e `usuario` (o audit grava 'postgres'/etc; null nas transicoes de status). */
const atorEvento = (ev) => ev?.usuario || ev?.ator || null;

export function PedidoHistorico({ orderId }) {
  const [eventos, setEventos] = useState(null);   // null = carregando
  useEffect(() => {
    let vivo = true;
    setEventos(null);
    DS.getEventos(orderId).then((e) => {
      // trilha de STATUS = eventos com status_novo (PEDIDO_CRIADO/STATUS_ALTERADO/ENTREGUE/CANCELADO)
      const trilha = (Array.isArray(e) ? e : []).filter((x) => x && x.status_novo);
      if (vivo) setEventos(trilha);
    });
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
                {fmtDataHoraLoja(ev.created_at)}{atorEvento(ev) ? ` · ${atorEvento(ev)}` : ''}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
