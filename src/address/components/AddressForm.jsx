/* address/components/AddressForm.jsx — REF-ADDRESS-01 (+ REF-ADDRESS-02 · Onda 5).
   Aba "Buscar por CEP" (apresentacional): campo de CEP + estados (loading/encontrado/não encontrado).
   Extraído VERBATIM do bloco `tab==='cep'` do AddressModal. A máscara/consulta do CEP e a confirmação
   vêm por props do motor useAddressSearch. Compõe AddressPreview (cartão do CEP encontrado) e, desde a
   Onda 5, AddressDetalhesEntrega (número/complemento + referência, novo campo — mesmo sub-formulário
   compartilhado com as outras 2 abas). */
import { AddressPreview } from './AddressPreview.jsx';
import { AddressDetalhesEntrega } from './AddressDetalhesEntrega.jsx';

export function AddressForm({ cepQuery, onCepChange, status, cepData, cepNumero, onNumeroChange, complemento, onComplementoChange, referencia, onReferenciaChange, onConfirm }) {
  return (
    <>
      <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-600)', display: 'block', marginBottom: 6 }}>
        CEP
      </label>
      <input className="addr-search-input"
        placeholder="00000-000"
        value={cepQuery}
        maxLength={9}
        onChange={e => onCepChange(e.target.value)} />
      {status === 'loading' && (
        <div style={{ textAlign: 'center', padding: '16px', color: 'var(--gray-400)' }}>
          <div className="spinner" style={{ margin: '0 auto 8px' }} /><p style={{ fontSize: 13 }}>Buscando CEP...</p>
        </div>
      )}
      {status === 'found' && cepData && (
        <div style={{ marginTop: 12 }}>
          <AddressPreview cepData={cepData} />
          <AddressDetalhesEntrega
            numero={cepNumero} onNumeroChange={onNumeroChange}
            complemento={complemento} onComplementoChange={onComplementoChange}
            referencia={referencia} onReferenciaChange={onReferenciaChange}
            onConfirm={onConfirm} confirmLabel="✅ Confirmar endereço" />
        </div>
      )}
      {status === 'notfound' && (
        <div className="addr-not-found" style={{ marginTop: 16 }}>
          <p>CEP não encontrado. Verifique e tente novamente.</p>
        </div>
      )}
    </>
  );
}
