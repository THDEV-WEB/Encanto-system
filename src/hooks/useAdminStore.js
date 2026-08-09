/* hooks/useAdminStore.js — consumo ergonomico do contexto de loja ativa do Admin (REF-SAAS-01 · Onda 5). */
import { useContext } from 'react';
import { AdminStoreContext } from '../contexts/AdminStoreContext.js';

export function useAdminStore() {
  const ctx = useContext(AdminStoreContext);
  if (!ctx) throw new Error('useAdminStore deve ser usado dentro de <AdminStoreProvider>');
  return ctx;
}
