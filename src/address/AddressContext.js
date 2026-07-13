/* address/AddressContext.js — REF-CHECKOUT-ADDRESS-01. Contexto React do endereco de entrega.
   Apenas o objeto de contexto; o estado (fonte unica) vive no AddressProvider e o consumo no hook
   useAddress. Mesmo padrao do AuthContext (AUTH-01). */
import { createContext } from 'react';

export const AddressContext = createContext(null);
