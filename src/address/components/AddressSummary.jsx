/* address/components/AddressSummary.jsx — REF-CHECKOUT-ADDRESS-01.
   Resumo EDITAVEL do endereco de entrega (apresentacional, sem estado/IO). Substitui o <textarea> livre
   do checkout: mostra exatamente o endereco da fonte unica (dominio Address) e delega a edicao ao mesmo
   AddressModal via onEditar (abrirModal). Tres estados: (1) retirada -> endereco da loja, so leitura;
   (2) entrega sem endereco -> chamada para selecionar; (3) entrega com endereco -> cartao + "Alterar".
   Assim o endereco EXIBIDO e sempre o mesmo que sera CONFIRMADO e PERSISTIDO no pedido. */

const cardStyle = {
  display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between',
  background: 'var(--grape-pale)', border: '1px solid #DDD6FE', borderRadius: 12, padding: '12px 14px',
};
const labelStyle = { fontWeight: 700, fontSize: 14, color: 'var(--gray-700)', lineHeight: 1.4 };
const subStyle = { fontSize: 12, color: 'var(--gray-500)', marginTop: 2, lineHeight: 1.5 };
const alterarStyle = {
  flexShrink: 0, border: '1px solid var(--grape)', background: 'none', color: 'var(--grape)',
  fontWeight: 700, fontSize: 12, borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontFamily: 'var(--font-body)',
};
const emptyStyle = {
  background: 'var(--gray-50)', border: '1px dashed var(--gray-200, #E5E7EB)', borderRadius: 12, padding: '14px',
  textAlign: 'center',
};

export function AddressSummary({ endereco, retirada, retiradaLabel, onEditar }) {
  if (retirada) {
    return (
      <div style={cardStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={labelStyle}>🏪 {retiradaLabel}</div>
          <div style={subStyle}>Você retira o pedido no balcão da loja.</div>
        </div>
      </div>
    );
  }
  if (!endereco || !endereco.label) {
    return (
      <div style={emptyStyle}>
        <div style={{ ...subStyle, marginTop: 0 }}>Você ainda não escolheu um endereço de entrega.</div>
        <button type="button" className="addr-confirm-btn" style={{ marginTop: 10 }} onClick={onEditar}>
          📍 Selecionar endereço
        </button>
      </div>
    );
  }
  /* REF-CHECKOUT-ADDRESS-01: o cartao mostra EXATAMENTE o label persistido (order.address = endereco.label).
     Nada de sublinhas — complemento/bairro ja estao dentro do label e cidade nao e persistida; qualquer
     sublinha ou duplicaria o label ou exibiria dado que nao vai ao pedido. Assim EXIBIDO == CONFIRMADO ==
     PERSISTIDO, byte a byte. (Os campos estruturados seguem no objeto, reservados p/ evolucao futura.) */
  return (
    <div style={cardStyle}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={labelStyle}>📍 {endereco.label}</div>
      </div>
      <button type="button" style={alterarStyle} onClick={onEditar}>Alterar</button>
    </div>
  );
}
