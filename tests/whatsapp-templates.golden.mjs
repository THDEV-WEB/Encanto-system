/* tests/whatsapp-templates.golden.mjs — REF-ORDER-01 · Parte 3.  node tests/whatsapp-templates.golden.mjs
   (npm run test:whatsapp). Trava a copy CANONICA das notificacoes (messageTemplates.js): renderizacao dos
   placeholders, cobertura dos 5 estados com template, ausencia de template para 'cancelado', e PARIDADE
   com o espelho TS da Edge Function (supabase/functions/whatsapp-notify/templates.ts). Puro/Node-safe. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NOTIFY_TEMPLATES, renderTemplate, temTemplate, TEMPO_ESTIMADO } from '../src/services/notifications/messageTemplates.js';

let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

const COM_TEMPLATE = ['recebido', 'preparo', 'pronto', 'entrega', 'entregue'];

check('ha template para os 5 estados notificaveis', () => {
  for (const s of COM_TEMPLATE) assert.ok(temTemplate(s), `faltou template: ${s}`);
});
check("'cancelado' NAO tem template (nao notifica)", () => {
  assert.equal(temTemplate('cancelado'), false);
  assert.equal(renderTemplate('cancelado', {}), null);
});

check('render recebido substitui cliente/numero/tempo', () => {
  const txt = renderTemplate('recebido', { cliente: 'Ana', numero: 'A1B2C', tempo: TEMPO_ESTIMADO.entrega });
  assert.ok(txt.includes('Olá, Ana.'));
  assert.ok(txt.includes('pedido #A1B2C'));
  assert.ok(txt.includes('35 a 45 min'));
  assert.ok(!/\{\{/.test(txt), 'sobrou placeholder cru');
});
check('render preparo/pronto/entrega usam numero', () => {
  for (const s of ['preparo', 'pronto', 'entrega']) {
    const txt = renderTemplate(s, { numero: 'X9' });
    assert.ok(txt.includes('#X9'), `${s} sem numero`);
    assert.ok(!/\{\{/.test(txt), `${s} deixou placeholder`);
  }
});
check('render entregue nao exige vars', () => {
  const txt = renderTemplate('entregue', {});
  assert.ok(txt.includes('Seu pedido foi entregue.'));
  assert.ok(!/\{\{/.test(txt));
});
check('placeholder sem valor vira vazio (nunca "{{x}}")', () => {
  const txt = renderTemplate('recebido', {});   // sem cliente/numero/tempo
  assert.ok(!/\{\{/.test(txt));
});

/* PARIDADE JS (canonico) x TS (espelho da Edge Function) — cada template canonico aparece verbatim no .ts */
check('espelho TS da Edge Function em sincronia com o canonico', () => {
  const tsPath = fileURLToPath(new URL('../supabase/functions/whatsapp-notify/templates.ts', import.meta.url));
  const ts = readFileSync(tsPath, 'utf8');
  for (const s of COM_TEMPLATE) {
    assert.ok(ts.includes(NOTIFY_TEMPLATES[s]), `template '${s}' divergente entre .js e templates.ts`);
  }
});

console.log(fail === 0 ? '\nOK whatsapp-templates.golden — copy canonica + paridade com a Edge Function' : `\nFALHA whatsapp-templates.golden — ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
