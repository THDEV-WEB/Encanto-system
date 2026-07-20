/* tests/whatsapp-service.golden.mjs — REF-ORDER-01 · Parte 3 (F6).  node tests/whatsapp-service.golden.mjs
   (npm run test:whatsapp-svc). Trava o contrato CANONICO da WhatsApp Cloud API (WhatsAppService) e a
   PARIDADE com a reimplementacao inline da Edge Function (Deno nao importa o bundle do browser). Puro/Node. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  normalizePhoneBR, isConfigured, buildCloudApiRequest, sendViaCloudApi, WA_API_VERSION_DEFAULT,
} from '../src/services/notifications/WhatsAppService.js';

let fail = 0;
const check = async (m, fn) => { try { await fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

/* ── normalizePhoneBR (E.164 sem '+') ── */
await check('normalizePhoneBR: mascara + sem DDI -> prefixa 55', () => {
  assert.equal(normalizePhoneBR('(38) 99220-3620'), '5538992203620');
});
await check('normalizePhoneBR: ja com DDI 55 -> inalterado', () => {
  assert.equal(normalizePhoneBR('5538992203620'), '5538992203620');
});
await check('normalizePhoneBR: vazio/nulo -> vazio', () => {
  assert.equal(normalizePhoneBR(''), '');
  assert.equal(normalizePhoneBR(null), '');
});

/* ── isConfigured ── */
await check('isConfigured exige token E phoneNumberId', () => {
  assert.equal(isConfigured({ token: 't', phoneNumberId: 'p' }), true);
  assert.equal(isConfigured({ token: 't' }), false);
  assert.equal(isConfigured({}), false);
  assert.equal(isConfigured(null), false);
});

/* ── buildCloudApiRequest (shape exato) ── */
await check('buildCloudApiRequest monta url/headers/body corretos', () => {
  const req = buildCloudApiRequest({ token: 'T', phoneNumberId: 'P', apiVersion: 'v21.0' }, { to: '38992203620', message: 'oi' });
  assert.equal(req.url, 'https://graph.facebook.com/v21.0/P/messages');
  assert.equal(req.method, 'POST');
  assert.equal(req.headers.Authorization, 'Bearer T');
  assert.equal(req.body.messaging_product, 'whatsapp');
  assert.equal(req.body.type, 'text');
  assert.equal(req.body.to, '5538992203620');   // normalizado
  assert.equal(req.body.text.body, 'oi');
  assert.equal(req.body.text.preview_url, false);
});
await check('buildCloudApiRequest usa versao default quando ausente', () => {
  const req = buildCloudApiRequest({ token: 'T', phoneNumberId: 'P' }, { to: '5538992203620', message: 'x' });
  assert.ok(req.url.includes('/' + WA_API_VERSION_DEFAULT + '/'));
});

/* ── sendViaCloudApi: skip/erro/sucesso com fetch INJETADO ── */
await check('sendViaCloudApi sem credenciais -> skipped (nunca envia)', async () => {
  const r = await sendViaCloudApi({}, { to: '5538992203620', message: 'x' }, () => { throw new Error('nao deveria chamar fetch'); });
  assert.deepEqual(r, { ok: false, skipped: true, error: 'whatsapp_not_configured' });
});
await check('sendViaCloudApi configurado mas sem telefone -> skipped phone_missing', async () => {
  const r = await sendViaCloudApi({ token: 'T', phoneNumberId: 'P' }, { to: '', message: 'x' }, () => { throw new Error('nao chama'); });
  assert.equal(r.skipped, true);
  assert.equal(r.error, 'phone_missing');
});
await check('sendViaCloudApi sucesso via fetch injetado', async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.X' }] }) });
  const r = await sendViaCloudApi({ token: 'T', phoneNumberId: 'P' }, { to: '5538992203620', message: 'oi' }, fakeFetch);
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
});

/* ── PARIDADE com a Edge Function (reimplementacao inline) ── */
await check('Edge Function espelha o contrato canonico (url/produto/normalizacao/preview)', () => {
  const idx = readFileSync(fileURLToPath(new URL('../supabase/functions/whatsapp-notify/index.ts', import.meta.url)), 'utf8');
  assert.ok(idx.includes('graph.facebook.com/'), 'endpoint Cloud API divergente');
  assert.ok(idx.includes('/messages'), 'path /messages ausente');
  assert.ok(idx.includes('messaging_product') && idx.includes('whatsapp'), 'messaging_product divergente');
  assert.ok(idx.includes('d.length <= 11') && idx.includes('"55"'), 'normalizacao de telefone divergente');
  assert.ok(idx.includes('preview_url: false'), 'preview_url divergente');
});

console.log(fail === 0 ? '\nOK whatsapp-service.golden — contrato Cloud API + paridade com a Edge Function' : `\nFALHA whatsapp-service.golden — ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
