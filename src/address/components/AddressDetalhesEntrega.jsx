/* address/components/AddressDetalhesEntrega.jsx — REF-ADDRESS-02 · Onda 5.
   Sub-formulário compartilhado pelas 3 abas depois de resolver o endereço-base (busca/CEP/mapa): número
   (obrigatório onde a aba já exige), complemento e referência (opcionais). Unifica o que antes só
   existia, parcial e duplicado, nas abas CEP e Mapa — a aba de busca nunca tinha esses campos (ADR §6:
   "somente depois solicita: Número, Complemento, Referência"). Markup idêntico ao que já existia pros
   campos número/complemento (mesmas classes/estilos); referência é o único campo genuinamente novo. */
import { AddressActions } from './AddressActions.jsx';

export function AddressDetalhesEntrega({
  numero, onNumeroChange, complemento, onComplementoChange, referencia, onReferenciaChange,
  onConfirm, confirmLabel, numeroObrigatorio = true,
}) {
  return (
    <>
      <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-600)', display: 'block', marginBottom: 4 }}>
        Número da residência {numeroObrigatorio && <span style={{ color: 'var(--orange)' }}>*</span>}
      </label>
      <input className="addr-search-input" style={{ marginBottom: 8 }}
        placeholder="Ex: 77" value={numero}
        onChange={e => onNumeroChange(e.target.value)} />
      <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-600)', display: 'block', marginBottom: 4 }}>
        Complemento (opcional)
      </label>
      <input className="addr-search-input" style={{ marginBottom: 8 }}
        placeholder="Ex: Casa 02, Ap 301" value={complemento}
        onChange={e => onComplementoChange(e.target.value)} />
      <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-600)', display: 'block', marginBottom: 4 }}>
        Ponto de referência (opcional)
      </label>
      <input className="addr-search-input" style={{ marginBottom: 12 }}
        placeholder="Ex: Perto do mercado" value={referencia}
        onChange={e => onReferenciaChange(e.target.value)} />
      <AddressActions onConfirm={onConfirm} label={confirmLabel} />
    </>
  );
}
