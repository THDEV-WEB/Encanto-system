/* tests/guestIdentity.golden.mjs — REF-CUSTOMER-01. Roda: node tests/guestIdentity.golden.mjs
   (npm run test:guest-identity). Prova o contrato do cache LOCAL de visitante: le/grava/limpa, tolera
   corrupcao, e nunca "inventa" dado (so nome OU telefone presentes ainda conta como cache valido, mas
   nenhum dos dois -> null). Polyfill minimo de localStorage (Node puro, sem browser/jsdom) — mesmo
   padrao de objeto que o modulo real consome (getItem/setItem/removeItem). */
import assert from 'node:assert/strict';

function criarLocalStorageFake() {
  const mapa = new Map();
  return {
    getItem: (k) => (mapa.has(k) ? mapa.get(k) : null),
    setItem: (k, v) => { mapa.set(k, String(v)); },
    removeItem: (k) => { mapa.delete(k); },
  };
}
globalThis.localStorage = criarLocalStorageFake();

const { lerGuestIdentity, salvarGuestIdentity, limparGuestIdentity } = await import('../src/utils/guestIdentity.js');
const { STORAGE_KEYS } = await import('../src/constants/storage.js');

let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

check('sem cache -> le null', () => {
  globalThis.localStorage.removeItem(STORAGE_KEYS.GUEST_IDENTITY);
  assert.equal(lerGuestIdentity(), null);
});

check('salvar + ler devolve exatamente nome/telefone gravados', () => {
  salvarGuestIdentity('Maria Silva', '38999998888');
  assert.deepEqual(lerGuestIdentity(), { nome: 'Maria Silva', telefone: '38999998888' });
});

check('limpar remove o cache (fonte unica: Supabase encerra o local)', () => {
  salvarGuestIdentity('Joao', '38988887777');
  limparGuestIdentity();
  assert.equal(lerGuestIdentity(), null);
});

check('JSON corrompido no localStorage -> le null (nunca lanca)', () => {
  globalThis.localStorage.setItem(STORAGE_KEYS.GUEST_IDENTITY, '{not-json');
  assert.equal(lerGuestIdentity(), null);
});

check('objeto sem nome nem telefone -> null (nao "inventa" cache vazio)', () => {
  globalThis.localStorage.setItem(STORAGE_KEYS.GUEST_IDENTITY, JSON.stringify({}));
  assert.equal(lerGuestIdentity(), null);
});

check('so nome (sem telefone) ainda conta como cache valido', () => {
  salvarGuestIdentity('Ana', '');
  assert.deepEqual(lerGuestIdentity(), { nome: 'Ana', telefone: '' });
});

check('localStorage indisponivel (throw) -> nunca lanca, degrada em silencio', () => {
  const real = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); }, removeItem() { throw new Error('bloqueado'); } };
  assert.doesNotThrow(() => lerGuestIdentity());
  assert.doesNotThrow(() => salvarGuestIdentity('x', 'y'));
  assert.doesNotThrow(() => limparGuestIdentity());
  globalThis.localStorage = real;
});

if (fail) { console.error(`\nFALHOU: ${fail}`); process.exit(1); }
console.log('\nOK guestIdentity.golden — cache local de visitante: contrato le/grava/limpa, fonte unica preservada');
