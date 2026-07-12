/* components/menu/userDisplay.js — helpers PUROS de exibicao do usuario logado (LOGIN-ARCH-02.2).
   Camada de UI (nao e dominio/servico): so formata o que exibir; nao chama IO nem toca a arquitetura.
   Regra de nome (prioridade): customers.name -> user_metadata.full_name -> user_metadata.name ->
   parte antes do @ do e-mail -> 'Cliente'. NUNCA expoe IDs/UUID/valores parciais. */

export function nomeExibicao(customer, user) {
  const c = (customer?.name || '').trim();
  if (c) return c;
  const meta = user?.user_metadata || {};
  const full = (meta.full_name || '').trim();
  if (full) return full;
  const nm = (meta.name || '').trim();
  if (nm) return nm;
  const email = (user?.email || customer?.email || '').trim();
  const local = email.includes('@') ? email.split('@')[0].trim() : '';
  if (local) return local;
  return 'Cliente';
}

export function inicialExibicao(nome) {
  const s = (nome || 'Cliente').trim();
  return (s.charAt(0) || 'C').toUpperCase();
}

export function avatarUrlDe(user) {
  const meta = user?.user_metadata || {};
  return meta.avatar_url || meta.picture || '';
}

/* Formata telefone BR: (DD) 9XXXX-XXXX / (DD) XXXX-XXXX. Aceita E.164 (55+DDD).
   Qualquer coisa fora de 10-11 digitos validos -> 'Telefone nao informado' (nunca valor parcial). */
export function telefoneExibicao(customer) {
  let d = (customer?.phone || '').replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return 'Telefone não informado';
}
