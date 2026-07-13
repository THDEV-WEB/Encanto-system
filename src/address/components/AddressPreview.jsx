/* address/components/AddressPreview.jsx — REF-ADDRESS-01.
   Cartão de pré-visualização do endereço encontrado por CEP (apresentacional). Extraído do bloco inline
   "✅ CEP encontrado" da aba CEP do AddressModal. Markup BYTE-IGUAL ao original. */
export function AddressPreview({ cepData }) {
  return (
    <div style={{
      background: 'var(--grape-pale)', borderRadius: 10, padding: '12px 14px',
      border: '1px solid #DDD6FE', marginBottom: 12,
    }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--amarelo)', marginBottom: 4 }}>
        ✅ CEP encontrado
      </div>
      <div style={{ fontSize: 13, color: 'var(--gray-700)', lineHeight: 1.7 }}>
        <b>{cepData.logradouro}</b><br />
        {cepData.bairro} · {cepData.localidade}/{cepData.uf}
      </div>
    </div>
  );
}
