/* services/businessHours/override.js — REF-BUSINESS-HOURS-02.
   Camada de IO do OVERRIDE do Admin (localStorage). Le/grava o MODO (AUTO/OPEN/CLOSED) e notifica a app
   (evento) p/ a MESMA aba reagir na hora. A DECISAO (prioridade OPEN>CLOSED>AUTO) NAO mora aqui — mora em
   resolverOverride (businessHours.js). Aqui e apenas persistencia + notificacao; o cronograma nunca muda.

   Chave nova STORE_MODE ('AUTO'|'OPEN'|'CLOSED'). Compat 1-shot: quem tinha o valor legado STORE_STATUS do
   HB-01 continua fiel ao comportamento ANTERIOR — 'closed' seguia FORCADO fechado (-> CLOSED); 'open' apenas
   seguia o cronograma (-> AUTO, NAO forca aberto). Ao gravar qualquer modo, a chave legada e limpa (o
   fallback vale so p/ o estado pre-HB-02). */
import { MODOS } from './businessHours.js';
import { STORAGE_KEYS } from '../../constants/storage.js';

export { MODOS };
export const MODE_EVENT = 'encanto:store-mode';

const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

/* Modo atual. Preferencia: STORE_MODE explicito; senao, fallback fiel ao legado (so 'closed' persiste). */
export function lerModo() {
  const modo = get(STORAGE_KEYS.STORE_MODE);
  if (modo === MODOS.OPEN || modo === MODOS.CLOSED || modo === MODOS.AUTO) return modo;
  // Fallback 1-shot ao estado pre-HB-02: 'closed' = fechamento forcado; 'open'/ausente = automatico.
  if (get(STORAGE_KEYS.STORE_STATUS) === 'closed') return MODOS.CLOSED;
  return MODOS.AUTO;
}

/* Define o modo (grava STORE_MODE explicito e limpa a chave legada). Dispara MODE_EVENT p/ a aba corrente
   atualizar na hora (o evento 'storage' nativo so cobre OUTRAS abas). */
export function definirModo(modo) {
  const valido = modo === MODOS.OPEN || modo === MODOS.CLOSED ? modo : MODOS.AUTO;
  try {
    localStorage.setItem(STORAGE_KEYS.STORE_MODE, valido);
    localStorage.removeItem(STORAGE_KEYS.STORE_STATUS); // encerra o fallback legado
  } catch { /* ambiente sem localStorage: ignora */ }
  try { window.dispatchEvent(new Event(MODE_EVENT)); } catch { /* ambiente sem window: ignora */ }
}
