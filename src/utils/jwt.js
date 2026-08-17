/* utils/jwt.js — REF-AUTH-TENANT-01 · Onda 4.
   Decodifica o payload de um JWT (sem verificar assinatura — a verificação real é feita pelo Postgres/
   PostgREST no servidor; aqui só lemos o claim `tenant_id` já assinado para decidir se precisa chamar
   activate_tenant() de novo). Nunca lança — payload malformado devolve null. */
export function decodeJwtPayload(token) {
  if (typeof token !== 'string') return null;
  const parte = token.split('.')[1];
  if (!parte) return null;
  try {
    const base64 = parte.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
    return JSON.parse(atob(base64 + pad));
  } catch {
    return null;
  }
}
