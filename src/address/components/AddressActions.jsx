/* address/components/AddressActions.jsx — REF-ADDRESS-01.
   Botão de confirmação do endereço (apresentacional). Reutilizado pela aba CEP e pela aba Mapa — antes
   eram dois <button className="addr-confirm-btn"> idênticos inline. Markup BYTE-IGUAL ao original. */
export function AddressActions({ onConfirm, label }) {
  return (
    <button className="addr-confirm-btn" onClick={onConfirm}>{label}</button>
  );
}
