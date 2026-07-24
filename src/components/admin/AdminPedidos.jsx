/* components/admin/AdminPedidos.jsx — REF-ORDER-01 (integracao operacional).
   Painel de pedidos como TABLEIRO OPERACIONAL (cards), nao mais tabela: cada pedido mostra o status atual,
   a TRILHA visual, e AÇOES SEMPRE VISIVEIS (avancar status conforme o tipo, comanda/reimprimir, historico,
   mensagens). Estilos inline (nao dependem do index.css). Dados via useOrders/DS; dominio puro p/ comanda. */
import { useState } from 'react';
import { useOrders } from '../../hooks/useOrders.js';
import { DS } from '../../services/DataService.js';
import { fmt, fmtDataHoraLoja } from '../../utils/format.js';
import { Spinner } from '../ui/Spinner.jsx';
import { statusInfo, fluxoDoTipo, proximoStatus } from '../pedidos/pedidoStatus.js';
import { ComandaModal } from './comanda/ComandaModal.jsx';
import { tipoDoPedido } from './comanda/comandaModel.js';
import { PedidoHistorico } from './PedidoHistorico.jsx';
import { PedidoNotificacoes } from './PedidoNotificacoes.jsx';
import { deburr, textMatches } from '../../utils/searchText.js';

/* cartoes-resumo (contadores por status) — a mesma trilha operacional + cancelado */
const RESUMO = ['recebido', 'preparo', 'pronto', 'entrega', 'entregue', 'cancelado'];

const chip = (info, on) => ({
  fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap',
  color: on ? '#fff' : info.cor, background: on ? info.cor : info.bg, opacity: on ? 1 : 0.85,
});
const act = (bg, fg, bd) => ({
  border: bd || 'none', borderRadius: 9, padding: '8px 12px', fontSize: 13, fontWeight: 700,
  cursor: 'pointer', background: bg, color: fg, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6,
});

function OrderCard({ order, numero, onChanged, onComanda }) {
  const [aba, setAba] = useState(null);   // 'hist' | 'msg' | null
  const [salvando, setSalvando] = useState(false);
  const tipo = tipoDoPedido(order);
  const status = order.status || 'recebido';
  const fluxo = fluxoDoTipo(tipo);
  const idxAtual = fluxo.indexOf(status);
  const prox = proximoStatus(status, tipo);
  const cancelado = status === 'cancelado';

  const mudar = async (novo) => {
    if (salvando) return;
    setSalvando(true);
    await DS.setStatus(order.id, novo);
    setSalvando(false);
    onChanged();
  };
  const infoAtual = statusInfo(status);

  return (
    <div data-testid={`pedido-card-${order.id}`} style={{ border: '1px solid var(--gray-200,#E8DCC8)', borderRadius: 14, padding: 14, marginBottom: 12, background: 'var(--white,#fff)' }}>
      {/* topo: numero + ref + tipo + status atual */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 800, fontSize: 16, color: 'var(--grape,#A62786)' }}>#{numero}</span>
          <span style={{ fontSize: 11, color: 'var(--gray-500,#6B5D50)' }}>Ref. {('#' + String(order.id || '').replace(/-/g, '').slice(0, 8)).toUpperCase()}</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: tipo === 'retirada' ? '#0F766E' : '#1D4ED8' }}>
            {tipo === 'retirada' ? '🏪 Retirada' : '🛵 Entrega'}
          </span>
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: infoAtual.cor, background: infoAtual.bg, borderRadius: 999, padding: '4px 12px' }}>
          {infoAtual.icon} {infoAtual.label}
        </span>
      </div>

      {/* cliente + total + horario */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{order.customers?.name || '—'}</div>
          <div style={{ fontSize: 12, color: 'var(--gray-500,#6B5D50)' }}>{order.customers?.phone || ''}</div>
          {order.address && <div style={{ fontSize: 12, color: 'var(--gray-500,#6B5D50)' }}>{String(order.address).slice(0, 48)}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{fmt(order.total)}</div>
          <div style={{ fontSize: 11.5, color: 'var(--gray-500,#6B5D50)' }}>{fmtDataHoraLoja(order.created_at)}</div>
        </div>
      </div>

      {/* TRILHA visual do fluxo (por tipo) */}
      {!cancelado && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {fluxo.map((s, i) => <span key={s} style={chip(statusInfo(s), i <= idxAtual)}>{statusInfo(s).label}</span>)}
        </div>
      )}

      {/* AÇOES sempre visiveis */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
        {prox
          ? <button style={act('var(--grape,#A62786)', '#fff')} disabled={salvando} onClick={() => mudar(prox)}>
              ▶ Avançar: {statusInfo(prox).label}
            </button>
          : !cancelado && <span style={{ fontSize: 12.5, fontWeight: 700, color: '#15803D' }}>✅ Pedido concluído</span>}

        <button style={act('#F1EADF', '#6B5D50')} onClick={() => onComanda(order, numero)}>🧾 Comanda</button>
        <button style={act('#F1EADF', '#6B5D50')} aria-expanded={aba === 'hist'} onClick={() => setAba(aba === 'hist' ? null : 'hist')}>🕑 Histórico</button>
        <button style={act('#F1EADF', '#6B5D50')} aria-expanded={aba === 'msg'} onClick={() => setAba(aba === 'msg' ? null : 'msg')}>💬 Mensagens</button>

        {!cancelado && status !== 'entregue' && (
          <button style={{ ...act('transparent', '#B91C1C', '1px solid #FECACA'), marginLeft: 'auto' }}
            disabled={salvando}
            onClick={() => { if (window.confirm('Cancelar este pedido?')) mudar('cancelado'); }}>
            Cancelar
          </button>
        )}
        {cancelado && (
          <button style={{ ...act('#F1EADF', '#6B5D50'), marginLeft: 'auto' }} disabled={salvando} onClick={() => mudar('recebido')}>
            Reabrir
          </button>
        )}
      </div>

      {aba === 'hist' && <div style={{ marginTop: 6, borderTop: '1px dashed var(--gray-200,#E8DCC8)', paddingTop: 8 }}><PedidoHistorico orderId={order.id} /></div>}
      {aba === 'msg' && <div style={{ marginTop: 6, borderTop: '1px dashed var(--gray-200,#E8DCC8)', paddingTop: 8 }}><PedidoNotificacoes order={order} /></div>}
    </div>
  );
}

/* REF-ADMIN-02 · Onda 3 — busca/filtro nunca existiram aqui (causa raiz: ausência de funcionalidade,
   não um bug de comportamento). Client-side sobre a lista já carregada por useOrders (mesmo padrão do
   breakdown por status acima e do Dashboard): zero consulta nova. Busca tolerante a acento/caixa/
   parcial (utils/searchText, mesmo motor da busca da loja) contra nome/telefone do cliente, uuid
   completo, ref curta (8 primeiros chars, igual à exibida no card) e o número sequencial do pedido. */
function pedidoCasaBusca(order, numero, dq) {
  if (!dq) return true;
  const refCurta = String(order.id || '').replace(/-/g, '').slice(0, 8);
  return textMatches(order.customers?.name, dq)
      || textMatches(order.customers?.phone, dq)
      || textMatches(order.id, dq)
      || textMatches(refCurta, dq)
      || textMatches(String(numero), dq);
}

export function AdminPedidos() {
  const { orders, loading, refresh } = useOrders();
  const [comanda, setComanda] = useState(null);   // { order, numero, count }
  const [busca, setBusca] = useState('');
  const [statusFiltro, setStatusFiltro] = useState('todos');

  const abrirComanda = async (order, numero) => {
    setComanda({ order, numero, count: null });
    const count = await DS.countPedidosByCustomer(order.customer_id);
    setComanda((c) => (c && c.order?.id === order.id ? { ...c, count } : c));
  };

  /* numero = posição no pedido dentro da lista TOTAL (não da filtrada) — preserva a numeração de
     sempre (#1 = mais antigo) mesmo com busca/filtro ativos. */
  const numeroPorId = new Map(orders.map((o, i) => [o.id, orders.length - i]));
  const dq = deburr(busca.trim());
  const filtrados = orders.filter((o) => {
    const status = o.status || 'recebido';
    if (statusFiltro !== 'todos' && status !== statusFiltro) return false;
    return pedidoCasaBusca(o, numeroPorId.get(o.id), dq);
  });

  return (
    <div>
      <div className="stat-cards">
        {RESUMO.map((k) => (
          <div key={k} className="stat-card">
            <div className="stat-val">{orders.filter((o) => (o.status || 'recebido') === k).length}</div>
            <div className="stat-label">{statusInfo(k).label}</div>
          </div>
        ))}
      </div>
      <div className="admin-card">
        <div className="admin-card-header">
          <h3>Pedidos ({filtrados.length})</h3>
          <button className="btn-secondary" onClick={refresh}>🔄 Atualizar</button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '12px 16px 0' }}>
          <input
            data-testid="pedidos-busca"
            className="form-input"
            style={{ flex: '1 1 240px' }}
            type="text"
            placeholder="Buscar por cliente, telefone ou nº do pedido"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <select
            data-testid="pedidos-filtro-status"
            className="form-select"
            style={{ width: 'auto', minWidth: 160 }}
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value)}
          >
            <option value="todos">Todos os status</option>
            {RESUMO.map((k) => <option key={k} value={k}>{statusInfo(k).label}</option>)}
          </select>
        </div>
        <div style={{ padding: 16 }}>
          {loading ? <Spinner /> : orders.length === 0 ? (
            <div className="empty-state"><div className="icon">📋</div><p>Nenhum pedido ainda</p></div>
          ) : filtrados.length === 0 ? (
            <div className="empty-state"><div className="icon">🔍</div><p>Nenhum pedido encontrado com esses filtros</p></div>
          ) : (
            filtrados.map((o) => (
              <OrderCard key={o.id} order={o} numero={numeroPorId.get(o.id)} onChanged={refresh} onComanda={abrirComanda} />
            ))
          )}
        </div>
      </div>
      {comanda && (
        <ComandaModal order={comanda.order} numero={comanda.numero} totalPedidos={comanda.count} onClose={() => setComanda(null)} />
      )}
    </div>
  );
}
