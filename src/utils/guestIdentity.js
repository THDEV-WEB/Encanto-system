/* utils/guestIdentity.js — REF-CUSTOMER-01.
   Cache LOCAL e TEMPORARIO do nome/telefone do visitante (guest): melhora a experiencia evitando
   redigitar em pedidos seguintes, mas NUNCA e fonte de verdade. A fonte oficial passa a ser sempre o
   Supabase (customers) assim que existir conta vinculada com telefone — o ponto que LIMPA este cache
   nesse caso e AuthProvider.carregarCustomer, no exato momento em que um customer com telefone carrega
   de verdade (nunca merge: a transicao e "encerra o cache local, o Supabase manda dai em diante"). Sem
   isso existiriam DUAS fontes permanentes para o mesmo dado (localStorage vs Supabase), o que este
   modulo existe para evitar. Folha pura (sem React), mesmo padrao de constants/storage.js.

   POLITICA DE LIMPEZA (revisao pos-implantacao — dispositivo compartilhado):
   - Logout do cliente (AuthProvider.sair) tambem limpa — sem isso, a proxima pessoa a usar o MESMO
     navegador sem nunca logar (2 visitantes diferentes) herdava nome/telefone de quem usou antes.
   - TTL de 30 dias (`TTL_MS`), validado na LEITURA (`lerGuestIdentity`): cache mais velho que isso e
     tratado como ausente e descartado — nunca fica "vivo pra sempre" num navegador esquecido/publico.
     `savedAt` ausente (formato desconhecido/futuro) e tratado como expirado — falha pro lado seguro,
     nunca assume validade indefinida de um payload que nao sabe descrever sua propria idade.
   - `version` gravado no payload (nao interpretado ainda) só para permitir uma migração/rejeição
     deliberada se o formato mudar numa REF futura, sem precisar adivinhar payloads antigos.
   NAO implementado de proposito (fora do escopo desta REF): affordance de UI tipo "Não sou eu?" para
   o caso de 2 visitantes no MESMO navegador SEM nenhum login entre eles — TTL reduz a janela de
   exposição, mas não fecha esse caso por completo; ver docs/ref/REF-CUSTOMER-01-progress.md. */
import { STORAGE_KEYS } from '../constants/storage.js';

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const VERSION = 1;

export function lerGuestIdentity() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.GUEST_IDENTITY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o?.nome && !o?.telefone) return null;
    if (typeof o.savedAt !== 'number' || (Date.now() - o.savedAt) > TTL_MS) {
      limparGuestIdentity(); // ausente/expirado -> descarta e nao devolve (falha pro lado seguro)
      return null;
    }
    return { nome: o.nome || '', telefone: o.telefone || '' };
  } catch { return null; }
}

export function salvarGuestIdentity(nome, telefone) {
  try {
    localStorage.setItem(STORAGE_KEYS.GUEST_IDENTITY, JSON.stringify({
      version: VERSION,
      nome: nome || '',
      telefone: telefone || '',
      savedAt: Date.now(),
    }));
  } catch { /* segue sem cache */ }
}

export function limparGuestIdentity() {
  try { localStorage.removeItem(STORAGE_KEYS.GUEST_IDENTITY); } catch { /* noop */ }
}
