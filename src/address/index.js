/* address/index.js — REF-ADDRESS-01. Barrel público do domínio Address.
   Fronteira ÚNICA de consumo do domínio: quem está fora (StoreApp) importa daqui, nunca dos arquivos
   internos. Expõe o componente de UI (AddressModal), o hook app-level (useAddress) e a fachada de
   geocoding (para reuso/evolução futura sem acoplar ao provedor). */
export { AddressModal } from './components/AddressModal.jsx';
export { useAddress } from './hooks/useAddress.js';
export { useAddressSearch } from './hooks/useAddressSearch.js';
export { geocoding } from './services/geocodingService.js';
