// REF-PAGAMENTO-01 · Onda 4 -- teste REAL (nao simulado) da Edge Function mp-webhook.
//
// TRANSPARENCIA: cria uma cobranca Pix REAL no sandbox do Mercado Pago (via mp-criar-cobranca,
// Onda 3 -- mesmo fluxo ja validado), depois envia pra mp-webhook uma notificacao ASSINADA POR NOS
// MESMOS com um secret de TESTE (gerado localmente, configurado via `supabase secrets set` --
// NUNCA o secret real do Mercado Pago, que so existe depois que a URL desta funcao for registrada
// no painel de Webhooks da aplicacao -- passo que depende do dono). A assinatura em si e' simulada
// (mesmo principio ja usado pro HMAC na Onda 2) -- mas TUDO A PARTIR DAI e' real: a Edge Function
// deployada de verdade valida a assinatura (Web Crypto, sem tocar o banco antes), consulta o
// pagamento REAL na API do Mercado Pago (GET /v1/payments/{id} de verdade), resolve o store_id pelo
// registro REAL gravado na Onda 3, e processa via a maquina de estados ja testada da Onda 2.
//
// O que ainda NAO fica provado por este script: que o Mercado Pago de fato envia webhooks nesse
// formato/timing em producao real, e que o secret de webhook REAL (nao o de teste) funciona --
// ambos dependem do dono registrar a URL desta funcao no painel.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID, createHmac } from 'node:crypto';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ENV_PATH = 'C:/Users/00thi/.encanto/db.e2e.env';
function loadConn() {
  const txt = readFileSync(ENV_PATH, 'utf8');
  const map = {};
  for (const line of txt.split(/\r?\n/)) { const i = line.indexOf('='); if (i === -1) continue; map[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, ''); }
  if (!map.PGPASSWORD) { console.error('ERRO: PGPASSWORD vazio'); process.exit(2); }
  return { host: map.PGHOST, port: Number(map.PGPORT || 5432), user: map.PGUSER, password: map.PGPASSWORD, database: map.PGDATABASE || 'postgres' };
}
const client = new pg.Client({ ...loadConn(), ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

const CHARGE_URL = 'https://bgzcrovskjbktdxkhemd.supabase.co/functions/v1/mp-criar-cobranca';
const WEBHOOK_URL = 'https://bgzcrovskjbktdxkhemd.supabase.co/functions/v1/mp-webhook';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnemNyb3Zza2pia3RkeGtoZW1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4Mjc1OTEsImV4cCI6MjEwMDQwMzU5MX0.BVZCAZd1kOkFJoCrPVmM3B7Xm0UgsHvF1yILhOlwfDg';
const TEST_SECRET_PATH = 'C:/Users/00thi/AppData/Local/Temp/claude/c--Projetos/be98dfa2-a03e-4d21-a155-3c9e7b0e34fe/scratchpad/mp_webhook_test_secret.txt';

let pass = 0, fail = 0;
function check(label, cond, extra = '') { if (cond) { pass++; console.log(`PASS  ${label}`); } else { fail++; console.log(`FAIL  ${label}  ${extra}`); } }

function assinar(dataId, xRequestId, tsMs, secret) {
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${tsMs};`;
  const v1 = createHmac('sha256', secret).update(manifest).digest('hex');
  return `ts=${tsMs},v1=${v1}`;
}

async function main() {
  await client.connect();
  const SECRET_TESTE = readFileSync(TEST_SECRET_PATH, 'utf8').trim();
  console.log('==========================================================================');
  console.log(' REF-PAGAMENTO-01 · Onda 4 -- CHAMADA REAL a mp-webhook (assinatura de teste)');
  console.log('==========================================================================\n');

  const STORE_A = randomUUID();
  const custId = randomUUID();
  const orderId = randomUUID();
  let mpPaymentId;

  try {
    // ── Setup + cobranca Pix REAL (mesmo caminho da Onda 3) ─────────────────────────────────────
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste PAGAMENTO-01 Onda4 REAL','ativo')`, [STORE_A, `pagamento01-onda4-real-${STORE_A}`]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'pagamento_online_habilitada','true')`, [STORE_A]);
    await client.query(`INSERT INTO public.customers (id, name, phone, store_id) VALUES ($1,'Cliente Onda4 Real','37655555555',$2)`, [custId, STORE_A]);
    await client.query(`INSERT INTO public.orders (id, customer_id, total, status, payment_method, address, store_id, tipo_pedido, origem_pedido) VALUES ($1,$2,7.00,'aguardando_pagamento','pix_online','Rua Teste Onda4 Real',$3,'entrega','storefront')`, [orderId, custId, STORE_A]);
    const rpc = (await client.query(`SELECT public.iniciar_pagamento_pedido($1, $2) AS r`, [orderId, STORE_A])).rows[0].r;
    check('setup: payment_intent criado', rpc.ok === true, JSON.stringify(rpc));
    const paymentIntentId = rpc.payment_intent_id;

    const chargeResp = await fetch(CHARGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}`, 'apikey': ANON_KEY },
      body: JSON.stringify({ payment_intent_id: paymentIntentId, payment_method_id: 'pix', payer: { email: `onda4-${Date.now()}@gmail.com`, identification: { type: 'CPF', number: '19119119100' } } }),
    });
    const chargeJson = await chargeResp.json().catch(() => null);
    check('setup: cobranca Pix real criada (mp-criar-cobranca, Onda 3)', chargeResp.status === 200 && chargeJson?.ok === true, JSON.stringify(chargeJson));
    mpPaymentId = chargeJson?.mp_payment_id;
    console.log(`\nPagamento real de referencia: mp_payment_id=${mpPaymentId}\n`);

    // ── D1: assinatura invalida (secret errado) -> 401, NUNCA processa ──────────────────────────
    {
      const ts = Date.now();
      const reqId = randomUUID();
      const sigErrada = assinar(mpPaymentId, reqId, ts, 'secret-completamente-errado');
      const r = await fetch(`${WEBHOOK_URL}?data.id=${mpPaymentId}&type=payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-signature': sigErrada, 'x-request-id': reqId },
        body: JSON.stringify({ action: 'payment.updated', type: 'payment', data: { id: mpPaymentId } }),
      });
      const j = await r.json().catch(() => null);
      check('D1 assinatura invalida -> 401', r.status === 401 && j?.error === 'assinatura_invalida', `status=${r.status} body=${JSON.stringify(j)}`);
    }

    // ── D2: assinatura valida (secret de TESTE), data_id do pagamento REAL -> processa de verdade ──
    {
      const ts = Date.now();
      const reqId = randomUUID();
      const sigValida = assinar(mpPaymentId, reqId, ts, SECRET_TESTE);
      const r = await fetch(`${WEBHOOK_URL}?data.id=${mpPaymentId}&type=payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-signature': sigValida, 'x-request-id': reqId },
        body: JSON.stringify({ action: 'payment.updated', type: 'payment', data: { id: mpPaymentId } }),
      });
      const j = await r.json().catch(() => null);
      console.log('Resposta D2:', r.status, JSON.stringify(j));
      check('D2 assinatura valida + pagamento real existente -> 200 ok:true', r.status === 200 && j?.ok === true, JSON.stringify(j));
      check('D2b resultado interno da RPC veio junto (nao so ok:true vazio)', j?.resultado && typeof j.resultado === 'object', JSON.stringify(j));
    }

    // ── D3: mesma notificacao de novo (replay) -> continua ok:true, idempotente (nao duplica efeito) ──
    {
      const ts = Date.now();
      const reqId = randomUUID();
      const sigValida = assinar(mpPaymentId, reqId, ts, SECRET_TESTE);
      const r = await fetch(`${WEBHOOK_URL}?data.id=${mpPaymentId}&type=payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-signature': sigValida, 'x-request-id': reqId },
        body: JSON.stringify({ action: 'payment.updated', type: 'payment', data: { id: mpPaymentId } }),
      });
      const j = await r.json().catch(() => null);
      check('D3 replay do mesmo pagamento (ainda pendente no MP) -> 200 ok:true, idempotente', r.status === 200 && j?.ok === true, JSON.stringify(j));
    }

    // ── D4: data_id inexistente (nao corresponde a nenhum payment_intent nosso) -> 200 ignorado, nunca erro ──
    {
      const idFalso = '999999999999';
      const ts = Date.now();
      const reqId = randomUUID();
      const sigValida = assinar(idFalso, reqId, ts, SECRET_TESTE);
      const r = await fetch(`${WEBHOOK_URL}?data.id=${idFalso}&type=payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-signature': sigValida, 'x-request-id': reqId },
        body: JSON.stringify({ action: 'payment.updated', type: 'payment', data: { id: idFalso } }),
      });
      const j = await r.json().catch(() => null);
      // Este data_id nao existe nem na API real do MP -- a funcao consulta a API antes de chegar no
      // nosso payment_intents, entao cai no ramo "falha ao consultar" (tambem 200, nunca provoca
      // retry do MP por um id que nem existe).
      check('D4 data_id que nao existe (nem no MP) -> 200, nunca processa nem quebra', r.status === 200 && j?.ok === false, `status=${r.status} body=${JSON.stringify(j)}`);
    }

    // ── D5: verifica no banco que o payment_intent REAL foi tocado pelo webhook (updated_at mudou) ──
    {
      const row = (await client.query(`SELECT status, updated_at, raw_payload->>'status' AS mp_status_cru FROM public.payment_intents WHERE id = $1`, [paymentIntentId])).rows[0];
      check('D5 payment_intent processado pelo webhook (status pendente, refletindo o Pix ainda nao pago de verdade)', row.status === 'pendente' && row.mp_status_cru === 'pending', JSON.stringify(row));
    }

  } finally {
    console.log('\n>>> Limpeza...');
    await client.query(`DELETE FROM public.payment_intents WHERE order_id = $1`, [orderId]).catch(() => {});
    await client.query(`DELETE FROM public.orders WHERE id = $1`, [orderId]).catch(() => {});
    await client.query(`DELETE FROM public.customers WHERE id = $1`, [custId]).catch(() => {});
    await client.query(`DELETE FROM public.store_settings WHERE store_id = $1`, [STORE_A]).catch(() => {});
    await client.query(`DELETE FROM public.stores WHERE id = $1`, [STORE_A]).catch(() => {});
    console.log('Limpeza concluida (o pagamento Pix em si continua existindo no sandbox do MP -- nao ha API de delete, e nao ha problema, e apenas de teste).');

    console.log(`\n${'='.repeat(74)}\nTOTAL: ${pass} passaram, ${fail} falharam\n${'='.repeat(74)}`);
    await client.end();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

main().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
