/* contexts/AuthContext.js — contexto React da sessao do CLIENTE (AUTH-01). Apenas o objeto de contexto;
   o estado vive no AuthProvider e o consumo no hook useAuth. */
import { createContext } from 'react';

export const AuthContext = createContext(null);
