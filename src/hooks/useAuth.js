/* hooks/useAuth.js — consumo ergonomico do contexto de autenticacao do cliente (AUTH-01). */
import { useContext } from 'react';
import { AuthContext } from '../contexts/AuthContext.js';

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return ctx;
}
