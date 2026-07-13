/* components/pedidos/PedidoItens.jsx — REF-CLIENTE-02 Onda 3: detalhe dos itens de um pedido.
   Usa o SNAPSHOT de order_items (nome_produto, quantity, preco_unitario, adicionais, observacoes) —
   o historico fica fiel ao que foi pedido, mesmo que o catalogo mude depois.
   NOTA: order_items NAO possui campo proprio de "tamanho"; o preco_unitario ja reflete o tamanho
   escolhido no momento do pedido (quando aplicavel). So leitura. */
import { fmt } from '../../utils/format.js';

const nomesAdicionais = (adc) => Array.isArray(adc) ? adc.map(a => a?.nome || a?.name).filter(Boolean) : [];

export function PedidoItens({ itens }) {
  const arr = itens || [];
  if (!arr.length) return null;
  return (
    <div style={{ marginTop: 12, borderTop: '1px dashed var(--gray-200)', paddingTop: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>Itens do pedido</div>
      {arr.map((i) => {
        const unit = Number(i.preco_unitario ?? i.price) || 0;
        const linha = unit * (i.quantity || 1);
        const adc = nomesAdicionais(i.adicionais);
        return (
          <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, color: 'var(--gray-800)', fontWeight: 600 }}>{i.quantity}× {i.nome_produto}</div>
              {adc.length > 0 && <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>+ {adc.join(', ')}</div>}
              {i.observacoes && <div style={{ fontSize: 12, color: 'var(--gray-400)', fontStyle: 'italic' }}>obs: {i.observacoes}</div>}
            </div>
            <div style={{ fontSize: 13, color: 'var(--gray-700)', whiteSpace: 'nowrap' }}>{fmt(linha)}</div>
          </div>
        );
      })}
    </div>
  );
}
