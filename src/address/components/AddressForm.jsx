/* address/components/AddressForm.jsx — REF-ADDRESS-01.
   Aba "Buscar por CEP" (apresentacional): campo de CEP + estados (loading/encontrado/não encontrado).
   Extraído VERBATIM do bloco `tab==='cep'` do AddressModal. A máscara/consulta do CEP e a confirmação
   vêm por props do motor useAddressSearch. Compõe AddressPreview (cartão do CEP encontrado) e
   AddressActions (botão de confirmar). Markup BYTE-IGUAL ao original. */
import { AddressPreview } from './AddressPreview.jsx';
import { AddressActions } from './AddressActions.jsx';

export function AddressForm({ cepQuery, onCepChange, status, cepData, cepNumero, onNumeroChange, complemento, onComplementoChange, onConfirm }) {
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
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-600)', display: 'block', marginBottom: 4 }}>
            Número da residência <span style={{ color: 'var(--orange)' }}>*</span>
          </label>
          <input className="addr-search-input" style={{ marginBottom: 8 }}
            placeholder="Ex: 77" value={cepNumero}
            onChange={e => onNumeroChange(e.target.value)} />
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-600)', display: 'block', marginBottom: 4 }}>
            Complemento (opcional)
          </label>
          <input className="addr-search-input" style={{ marginBottom: 12 }}
            placeholder="Ex: Casa 02, Ap 301" value={complemento}
            onChange={e => onComplementoChange(e.target.value)} />
          <AddressActions onConfirm={onConfirm} label="✅ Confirmar endereço" />
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
