/* utils/guestIdentity.js — REF-CUSTOMER-01.
   Cache LOCAL e TEMPORARIO do nome/telefone do visitante (guest): melhora a experiencia evitando
   redigitar em pedidos seguintes, mas NUNCA e fonte de verdade. A fonte oficial passa a ser sempre o
   Supabase (customers) assim que existir conta vinculada com telefone — o unico ponto que LIMPA este
   cache e AuthProvider.carregarCustomer, no exato momento em que um customer com telefone carrega de
   verdade (nunca merge: a transicao e "encerra o cache local, o Supabase manda dai em diante"). Sem
   isso existiriam DUAS fontes permanentes para o mesmo dado (localStorage vs Supabase), o que este
   modulo existe para evitar. Folha pura (sem React), mesmo padrao de constants/storage.js. */
import { STORAGE_KEYS } from '../constants/storage.js';

export function lerGuestIdentity() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.GUEST_IDENTITY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o?.nome && !o?.telefone) return null;
    return { nome: o.nome || '', telefone: o.telefone || '' };
  } catch { return null; }
}

export function salvarGuestIdentity(nome, telefone) {
  try { localStorage.setItem(STORAGE_KEYS.GUEST_IDENTITY, JSON.stringify({ nome: nome || '', telefone: telefone || '' })); } catch { /* segue sem cache */ }
}

export function limparGuestIdentity() {
  try { localStorage.removeItem(STORAGE_KEYS.GUEST_IDENTITY); } catch { /* noop */ }
}
