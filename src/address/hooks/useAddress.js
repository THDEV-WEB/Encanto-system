/* address/hooks/useAddress.js — REF-CHECKOUT-ADDRESS-01.
   Consumo ergonomico do endereco de entrega (FONTE UNICA = AddressContext/AddressProvider). Antes este
   hook tinha estado PROPRIO (useState + localStorage) — o que, consumido por dois componentes, criava
   dois estados. Agora e um consumidor de contexto: Header e Checkout leem/editam exatamente o MESMO
   objeto. Retorna { endereco (objeto canonico|null), temEndereco, selecionar(label,meta), limpar,
   abrirModal }. `limpar` (REF-UI-HEADER-02) volta ao estado inicial (sem endereco). */
import { useContext } from 'react';
import { AddressContext } from '../AddressContext.js';

export function useAddress() {
  const ctx = useContext(AddressContext);
  if (!ctx) throw new Error('useAddress deve ser usado dentro de <AddressProvider>');
  return ctx;
}
