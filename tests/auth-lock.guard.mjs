/* tests/auth-lock.guard.mjs — REF-CLIENTE-03. GUARD do fix de restauracao de perfil pos-login.
   BUG: o callback do dbCliente.auth.onAuthStateChange roda DENTRO do lock de auth do gotrue-js
   (_notifyAllSubscribers faz `await cb()` dentro do _acquireLock de verifyOtp/OAuth). Se o callback
   AWAIT-ar uma query .from() (carregarCustomer -> getMeuCustomer), o request re-entra no lock p/ pegar
   o token (getSession) e fica enfileirado no MESMO lock -> DEADLOCK: o customer so carrega apos F5.
   Este guard falha se o anti-padrao voltar: (a) callback async no onAuthStateChange; ou (b) `await`
   de carga do customer dentro do callback; e exige (c) a carga DEFERIDA (setTimeout) p/ fora do lock. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'src', 'providers', 'AuthProvider.jsx'), 'utf8');

let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ✓ ' + m); } catch (e) { fail++; console.error('  ✗ ' + m + ' — ' + (e?.message ?? e)); } };

// Recorta a regiao do listener (do onAuthStateChange ate o cleanup do effect).
const iOn = src.indexOf('onAuthStateChange(');
assert.ok(iOn !== -1, 'AuthProvider deve registrar onAuthStateChange');
const iEnd = src.indexOf('return () =>', iOn);
const listener = src.slice(iOn, iEnd === -1 ? undefined : iEnd);

check('callback do onAuthStateChange NAO e async (nao roda await dentro do lock de auth)', () => {
  assert.ok(!/onAuthStateChange\(\s*async/.test(src), 'callback async re-introduz o deadlock do lock de auth');
});
check('NAO ha `await carregarCustomer` dentro do callback (anti-padrao que trava)', () => {
  assert.ok(!/await\s+carregarCustomer/.test(listener), 'await da carga do customer dentro do callback = deadlock');
});
check('a carga do customer e DEFERIDA (setTimeout) p/ fora do lock', () => {
  assert.ok(/setTimeout\([\s\S]*?carregarCustomer/.test(listener), 'deve deferir carregarCustomer via setTimeout');
});

console.log(fail === 0 ? '\n✅ auth-lock.guard OK — perfil carrega fora do lock (sem deadlock/F5)' : `\n❌ ${fail} falha(s)`);
process.exit(fail === 0 ? 0 : 1);
