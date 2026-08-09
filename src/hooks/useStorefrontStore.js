import { useContext } from 'react';
import { StorefrontContext } from '../contexts/StorefrontContext.js';

/* REF-SAAS-01 · Onda 6.1 — { store } | { store: null } enquanto get_store_by_domain ainda não
   resolveu (ver StorefrontProvider.jsx). `store.status !== 'ativo'` é quem decide a tela de "loja
   indisponível" em StoreApp.jsx. */
export function useStorefrontStore() {
  const ctx = useContext(StorefrontContext);
  if (!ctx) throw new Error('useStorefrontStore deve ser usado dentro de StorefrontProvider');
  return ctx;
}
