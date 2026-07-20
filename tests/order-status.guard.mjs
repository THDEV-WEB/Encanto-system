/* tests/order-status.guard.mjs — REF-ORDER-01 · Parte 2.  node tests/order-status.guard.mjs (npm run test:order-status).
   Trava o modelo de status do pedido (components/pedidos/pedidoStatus.js) apos a insercao de 'pronto':
   ordem canonica da timeline, presenca dos 6 estados em STATUS_INFO, fallback do statusInfo. Puro/Node. */
import assert from 'node:assert/strict';
import { STATUS_INFO, statusInfo, TIMELINE } from '../src/components/pedidos/pedidoStatus.js';

let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

check('TIMELINE canonica: recebido -> preparo -> pronto -> entrega -> entregue', () => {
  assert.deepEqual(TIMELINE, ['recebido', 'preparo', 'pronto', 'entrega', 'entregue']);
});
check("'pronto' fica ENTRE preparo e entrega", () => {
  assert.equal(TIMELINE.indexOf('pronto'), TIMELINE.indexOf('preparo') + 1);
  assert.equal(TIMELINE.indexOf('entrega'), TIMELINE.indexOf('pronto') + 1);
});
check('STATUS_INFO cobre os 6 estados (5 da trilha + cancelado)', () => {
  for (const s of [...TIMELINE, 'cancelado']) {
    assert.ok(STATUS_INFO[s], `faltou STATUS_INFO[${s}]`);
    assert.ok(STATUS_INFO[s].label && STATUS_INFO[s].cor && STATUS_INFO[s].bg, `campos incompletos em ${s}`);
  }
});
check('statusInfo tem fallback para status desconhecido', () => {
  const f = statusInfo('inexistente');
  assert.ok(f.label && f.cor && f.bg);
});
check("'pronto' e 'entregue' sao visualmente distintos (icone e cor)", () => {
  assert.notEqual(STATUS_INFO.pronto.icon, STATUS_INFO.entregue.icon);
  assert.notEqual(STATUS_INFO.pronto.cor, STATUS_INFO.entregue.cor);
});

console.log(fail === 0 ? '\nOK order-status.guard — modelo de status estavel (com pronto)' : `\nFALHA order-status.guard — ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
