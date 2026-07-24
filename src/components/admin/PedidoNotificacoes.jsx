/* components/admin/PedidoNotificacoes.jsx — REF-ORDER-01 · Parte 3 (integracao/observabilidade).
   Mostra, POR STATUS da trilha do pedido, a mensagem que o cliente recebe (renderizada dos templates
   canonicos) + o ESTADO REAL de envio (fila notification_outbox). Antes da migration/credenciais: exibe
   as PREVIAS ("sera enviada ao mudar o status"). Depois: ✅ enviado / ⏳ na fila / ⚠️ falhou por status.
   So leitura. Fonte de copy = messageTemplates (unica); estado = DS.getNotificacoes. */
import { useEffect, useState } from 'react';
import { DS } from '../../services/DataService.js';
import { renderTemplate, TEMPO_ESTIMADO } from '../../services/notifications/messageTemplates.js';
import { fluxoDoTipo, statusInfo } from '../pedidos/pedidoStatus.js';
import { tipoDoPedido, refCurtaDoPedido } from './comanda/comandaModel.js';

const ESTADO = {
  sent:    { txt: '✅ enviado',  cor: '#15803D', bg: '#DCFCE7' },
  sending: { txt: '⏳ enviando', cor: '#B45309', bg: '#FEF3C7' },
  pending: { txt: '⏳ na fila',  cor: '#B45309', bg: '#FEF3C7' },
  failed:  { txt: '⚠️ falhou',   cor: '#B91C1C', bg: '#FEE2E2' },
  skipped: { txt: '⏭️ ignorado', cor: '#6B7280', bg: '#F3F4F6' },
  previa:  { txt: 'prévia',      cor: '#6B7280', bg: '#F3F4F6' },
};

export function PedidoNotificacoes({ order }) {
  const [outbox, setOutbox] = useState(null);   // null = carregando
  useEffect(() => {
    let vivo = true;
    setOutbox(null);
    DS.getNotificacoes(order?.id).then((r) => { if (vivo) setOutbox(Array.isArray(r) ? r : []); });
    return () => { vivo = false; };
  }, [order?.id]);

  const tipo = tipoDoPedido(order);
  const cliente = order?.customers?.name || '';
  const numero = refCurtaDoPedido(order?.id).replace(/^#/, '');
  const tempo = TEMPO_ESTIMADO[tipo];
  // por status, o ULTIMO evento de outbox daquele status (estado mais recente)
  const porStatus = {};
  for (const row of outbox || []) porStatus[row.status] = row;
  const passos = fluxoDoTipo(tipo);   // 'recebido' inclusive (notificado na criacao)

  return (
    <div data-testid="pedido-mensagens" style={{ padding: '6px 4px 2px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--gray-400)', marginBottom: 8 }}>
        Mensagens automáticas (WhatsApp)
      </div>
      {outbox === null ? (
        <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>Carregando…</div>
      ) : passos.map((st) => {
        const info = statusInfo(st);
        const msg = renderTemplate(st, { cliente, numero, tempo });
        if (!msg) return null;
        const row = porStatus[st];
        const est = ESTADO[row?.state] || ESTADO.previa;
        return (
          <div key={st} style={{ border: '1px solid var(--gray-100)', borderRadius: 10, padding: '8px 10px', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--gray-800)' }}>{info.icon} {info.label}</span>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: est.cor, background: est.bg, borderRadius: 999, padding: '2px 8px' }}>{est.txt}</span>
              {row?.last_error && <span style={{ fontSize: 10.5, color: '#B91C1C' }}>({row.last_error})</span>}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--gray-600)', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{msg}</div>
          </div>
        );
      })}
      <div style={{ fontSize: 10.5, color: 'var(--gray-400)', marginTop: 2 }}>
        As prévias viram envio automático quando o status muda (requer a migration aplicada + a Edge Function com credenciais).
      </div>
    </div>
  );
}
