/* contexts/AdminStoreContext.js — contexto React da loja ativa na sessao do Admin (REF-SAAS-01 · Onda
   5). Apenas o objeto de contexto; o estado vive no AdminStoreProvider e o consumo no hook
   useAdminStore. */
import { createContext } from 'react';

export const AdminStoreContext = createContext(null);
