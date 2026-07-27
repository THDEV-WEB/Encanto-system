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

check('render recebido substitui cliente/numero/tempo/empresa', () => {
  const txt = renderTemplate('recebido', { cliente: 'Ana', numero: 'A1B2C', tempo: TEMPO_ESTIMADO.entrega, empresa: 'Encanto' });
  assert.ok(txt.startsWith('🍽️ Encanto'));
  assert.ok(txt.includes('Olá, Ana.'));
  assert.ok(txt.includes('pedido #A1B2C'));
  assert.ok(txt.includes('35 a 45 min'));
  assert.ok(!/\{\{/.test(txt), 'sobrou placeholder cru');
});
check('render preparo/pronto/entrega usam numero/empresa', () => {
  for (const s of ['preparo', 'pronto', 'entrega']) {
    const txt = renderTemplate(s, { numero: 'X9', empresa: 'Empório Teste' });
    assert.ok(txt.includes('#X9'), `${s} sem numero`);
    assert.ok(txt.includes('Empório Teste'), `${s} nao refletiu o nome custom`);
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

/* PARIDADE JS (canonico) x SQL (enc_render_message, dispatcher SQL-nativo agendado via pg_cron — o
   caminho de envio provavelmente ativo em producao). REF-COMPANY-02: esta checagem NAO existia antes
   (a 3a copia das mensagens tinha ficado fora do golden desde a REF-ORDER-01b) — fecha essa lacuna.
   So confere a migration NOVA (REF-COMPANY-02-notify-empresa.sql); a antiga (REF-ORDER-01b) fica
   congelada como registro historico, nunca editada em vigor. */
check('enc_render_message (SQL, migrations/REF-COMPANY-02-notify-empresa.sql) em sincronia com o canonico', () => {
  const sqlPath = fileURLToPath(new URL('../migrations/REF-COMPANY-02-notify-empresa.sql', import.meta.url));
  const sql = readFileSync(sqlPath, 'utf8');
  for (const s of COM_TEMPLATE) {
    assert.ok(sql.includes(NOTIFY_TEMPLATES[s]), `template '${s}' divergente entre .js e enc_render_message`);
  }
});

console.log(fail === 0 ? '\nOK whatsapp-templates.golden — copy canonica + paridade com a Edge Function' : `\nFALHA whatsapp-templates.golden — ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
