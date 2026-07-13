/* tests/loyalty.golden.mjs — REF-LOYALTY-01. Roda: node tests/loyalty.golden.mjs (npm run test:loyalty)
   Golden do NUCLEO PURO da fidelidade (services/loyalty/loyalty.js) — normalizacao/derivacao
   deterministica do payload dos RPCs. Importa o engine PURO DIRETO (nao o barrel index.js, que
   carrega lib/supabase -> import.meta.env quebra em Node). Sem banco/rede. */
import assert from 'node:assert/strict';
import { ESTADO_VAZIO, normalizarEstado, progressoPct, faltam } from '../src/services/loyalty/loyalty.js';

let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

check('ESTADO_VAZIO: defaults seguros (zeros, enabled, required 10, discount 50)', () => {
  assert.equal(ESTADO_VAZIO.stamps, 0);
  assert.equal(ESTADO_VAZIO.required, 10);
  assert.equal(ESTADO_VAZIO.discount, 50);
  assert.equal(ESTADO_VAZIO.enabled, true);
  assert.equal(ESTADO_VAZIO.rewardAvailable, false);
  assert.equal(ESTADO_VAZIO.hasAccount, false);
});

check('normalizarEstado(null/undefined/lixo) -> copia de ESTADO_VAZIO', () => {
  for (const v of [null, undefined, 42, 'x', []]) {
    const e = normalizarEstado(v);
    assert.equal(e.stamps, 0); assert.equal(e.required, 10); assert.equal(e.hasAccount, false);
  }
});

check('normalizarEstado converte snake_case do RPC -> camelCase', () => {
  const e = normalizarEstado({ enabled: true, stamps: 3, required: 10, discount: 50, reward_available: false, rewards_redeemed: 2, has_account: true });
  assert.equal(e.stamps, 3); assert.equal(e.required, 10); assert.equal(e.discount, 50);
  assert.equal(e.rewardAvailable, false); assert.equal(e.rewardsRedeemed, 2); assert.equal(e.hasAccount, true);
});

check('normalizarEstado deriva reward_available quando ausente (stamps>=required)', () => {
  assert.equal(normalizarEstado({ stamps: 10, required: 10 }).rewardAvailable, true);
  assert.equal(normalizarEstado({ stamps: 9,  required: 10 }).rewardAvailable, false);
});

check('normalizarEstado respeita reward_available explicito do servidor', () => {
  // servidor manda reward_available=true mesmo com stamps<required -> confia no servidor
  assert.equal(normalizarEstado({ stamps: 0, required: 10, reward_available: true }).rewardAvailable, true);
});

check('normalizarEstado: enabled=false so quando explicitamente false', () => {
  assert.equal(normalizarEstado({ enabled: false }).enabled, false);
  assert.equal(normalizarEstado({}).enabled, true);
});

check('normalizarEstado: valores negativos/invalidos saneados', () => {
  const e = normalizarEstado({ stamps: -5, required: 0, discount: -1, rewards_redeemed: -2 });
  assert.equal(e.stamps, 0); assert.ok(e.required >= 1); assert.equal(e.discount, 0); assert.equal(e.rewardsRedeemed, 0);
});

check('progressoPct: 0..100, arredondado, seguro p/ required 0', () => {
  assert.equal(progressoPct(0, 10), 0);
  assert.equal(progressoPct(5, 10), 50);
  assert.equal(progressoPct(10, 10), 100);
  assert.equal(progressoPct(99, 10), 100);   // clamp
  assert.equal(progressoPct(1, 0), 0);        // sem divisao por zero
});

check('faltam: nunca negativo', () => {
  assert.equal(faltam(3, 10), 7);
  assert.equal(faltam(10, 10), 0);
  assert.equal(faltam(12, 10), 0);
});

console.log(fail === 0
  ? '\nOK loyalty.golden — nucleo puro (normalizacao/derivacao) estavel'
  : `\nFALHA loyalty.golden — ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
