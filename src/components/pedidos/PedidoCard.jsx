/* components/pedidos/PedidoCard.jsx — REF-CLIENTE-02: cartao de um pedido (lista + expandir).
   Onda 1: resumo. Onda 2: timeline. Onda 3: detalhe de itens. Onda 4: "Pedir novamente" (recompra).
   A recompra usa o catalogo ATUAL (preco atual; nunca o antigo) e abre o carrinho para revisao. */
import { useState } from 'react';
import { fmt, fmtDate } from '../../utils/format.js';
import { statusInfo } from './pedidoStatus.js';
import { PedidoTimeline } from './PedidoTimeline.jsx';
import { PedidoItens } from './PedidoItens.jsx';

const numeroPedido = (id) => '#' + String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase();
const resumoItens = (items) => {
  const arr = items || [];
  if (!arr.length) return 'Sem itens';
  const n = arr.slice(0, 3).map((i) => `${i.quantity}× ${i.nome_produto}`).join(', ');
  return arr.length > 3 ? `${n}…` : n;
};

const card = { border: '1px solid var(--gray-100)', borderRadius: 14, padding: '14px 16px', marginBottom: 12, background: 'var(--white)' };
const badge = (st) => ({ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: st.cor, background: st.bg, borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap' });
const btnRecomprar = { width: '100%', marginTop: 12, padding: '11px', borderRadius: 12, border: 'none', background: 'var(--grape)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' };

export function PedidoCard({ pedido, onRecomprar, onFechar }) {
  const [aberto, setAberto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const st = statusInfo(pedido.status);
  const itens = pedido.order_items || [];

  const pedirNovamente = async () => {
    if (!onRecomprar || busy) return;
    setBusy(true); setRes(null);
    const r = await onRecomprar(pedido).catch(() => ({ erro: true }));
    setBusy(false);
    setRes(r || { erro: true });
  };

  return (
    <div style={card}>
      <button onClick={() => setAberto((a) => !a)}
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

      {aberto && (
        <>
          <PedidoTimeline orderId={pedido.id} status={pedido.status} />
          <PedidoItens itens={itens} />

          {onRecomprar && (
            <>
              <button style={{ ...btnRecomprar, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={pedirNovamente}>
                {busy ? 'Adicionando…' : '🔁 Pedir novamente'}
              </button>

              {res?.erro && (
                <p style={{ fontSize: 12.5, color: 'var(--red)', marginTop: 8 }}>
                  Não foi possível carregar o cardápio agora. Tente novamente.
                </p>
              )}
              {res && !res.erro && res.add === 0 && (
                <p style={{ fontSize: 12.5, color: 'var(--gray-500)', marginTop: 8, lineHeight: 1.4 }}>
                  Nenhum item pôde ser re-adicionado automaticamente (indisponível ou precisa escolher
                  tamanho/opção). Personalize na loja. 🙂
                </p>
              )}
              {res && !res.erro && res.add > 0 && (
                <div style={{ marginTop: 8 }}>
                  <p style={{ fontSize: 12.5, color: 'var(--grape)', fontWeight: 600, lineHeight: 1.4 }}>
                    {res.add} {res.add === 1 ? 'item adicionado' : 'itens adicionados'} ao carrinho com preços atuais.
                    {res.pulados?.length ? ` ${res.pulados.length} não incluído(s) — personalize na loja.` : ''}
                  </p>
                  <button onClick={() => onFechar?.()}
                    style={{ marginTop: 6, background: 'none', border: 'none', color: 'var(--grape)', fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: 0 }}>
                    Ver carrinho →
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
