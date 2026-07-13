/* address/index.js — Barrel publico do dominio Address.
   Fronteira UNICA de consumo do dominio: quem esta fora (StoreApp, Checkout) importa daqui, nunca dos
   arquivos internos. REF-ADDRESS-01 criou o dominio; REF-CHECKOUT-ADDRESS-01 promoveu-o a FONTE UNICA do
   endereco (AddressProvider/contexto) consumida por Header, Checkout e Pedido. */
export { AddressProvider } from './AddressProvider.jsx';
export { AddressModal } from './components/AddressModal.jsx';
export { AddressSummary } from './components/AddressSummary.jsx';
export { useAddress } from './hooks/useAddress.js';
export { useAddressSearch } from './hooks/useAddressSearch.js';
export { montarEndereco, enderecoPreenchido, ENDERECO_VAZIO } from './utils/addressModel.js';
export { geocoding } from './services/geocodingService.js';
