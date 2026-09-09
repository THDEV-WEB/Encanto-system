// REF-PAGAMENTO-01 · Onda 3 -- teste REAL (nao simulado) da Edge Function mp-criar-cobranca contra
// o SANDBOX do Mercado Pago (projeto E2E, credenciais de TESTE -- nunca producao).
//
// TRANSPARENCIA (pedida explicitamente pelo dono): este script faz uma chamada HTTP de verdade pra
// https://bgzcrovskjbktdxkhemd.supabase.co/functions/v1/mp-criar-cobranca, que por sua vez chama de
// verdade a API do Mercado Pago (api.mercadopago.com/v1/payments) usando o MP_ACCESS_TOKEN de teste
// configurado via `supabase secrets set`. NAO e' um mock, NAO assina nada localmente -- e' a 1a
// prova real de ponta a ponta desta REF. Usa metodo Pix (nao exige tokenizacao de cartao, so'
// payer.email + payer.identification) -- CPF de teste gerado localmente com o algoritmo OFICIAL de
// digito verificador (sintaticamente valido, mas nao e' o CPF de ninguem -- pratica padrao de teste
// de integracao, o Mercado Pago valida o FORMATO, nao a existencia real da pessoa em ambiente de
// sandbox).
//
// Como NAO envolve dados de cartao, este script nao depende de nenhum numero de cartao de teste
// "de cor" -- reduz risco de erro por memoria imprecisa de digitos.
//
// Sem rollback automatico (a Edge Function usa sua PROPRIA conexao/service_role, fora da transacao
// deste script) -- setup e limpeza sao passos EXPLICITOS, autocommit.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

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

const FUNCTION_URL = 'https://bgzcrovskjbktdxkhemd.supabase.co/functions/v1/mp-criar-cobranca';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnemNyb3Zza2pia3RkeGtoZW1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4Mjc1OTEsImV4cCI6MjEwMDQwMzU5MX0.BVZCAZd1kOkFJoCrPVmM3B7Xm0UgsHvF1yILhOlwfDg';

let pass = 0, fail = 0;
function check(label, cond, extra = '') { if (cond) { pass++; console.log(`PASS  ${label}`); } else { fail++; console.log(`FAIL  ${label}  ${extra}`); } }

// Algoritmo OFICIAL de digito verificador de CPF -- gera um CPF sintaticamente valido para teste
// (nao pertence a nenhuma pessoa real, e' so' aritmetica).
function gerarCpfTeste() {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 9));
  const calcDv = (nums, pesoInicial) => {
    let soma = 0;
    for (let i = 0; i < nums.length; i++) soma += nums[i] * (pesoInicial - i);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const dv1 = calcDv(base, 10);
  const dv2 = calcDv([...base, dv1], 11);
  return [...base, dv1, dv2].join('');
}

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-PAGAMENTO-01 · Onda 3 -- CHAMADA REAL ao sandbox do Mercado Pago');
  console.log('==========================================================================\n');

  const STORE_A = randomUUID();
  const custId = randomUUID();
  const orderId = randomUUID();
  let paymentIntentId;

  try {
    // ── Setup (autocommit, sem transacao aberta -- a Edge Function precisa ENXERGAR estes dados) ──
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste PAGAMENTO-01 Onda3 REAL','ativo')`, [STORE_A, `pagamento01-onda3-real-${STORE_A}`]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'pagamento_online_habilitada','true')`, [STORE_A]);
    await client.query(`INSERT INTO public.customers (id, name, phone, store_id) VALUES ($1,'Cliente Onda3 Real','37688888888',$2)`, [custId, STORE_A]);
    await client.query(`INSERT INTO public.orders (id, customer_id, total, status, payment_method, address, store_id, tipo_pedido, origem_pedido) VALUES ($1,$2,5.00,'aguardando_pagamento','pix_online','Rua Teste Onda3 Real',$3,'entrega','storefront')`, [orderId, custId, STORE_A]);

    const rpcRes = await client.query(`SELECT public.iniciar_pagamento_pedido($1, $2) AS r`, [orderId, STORE_A]);
    const rpc = rpcRes.rows[0].r;
    check('setup: iniciar_pagamento_pedido criou o payment_intent', rpc.ok === true, JSON.stringify(rpc));
    paymentIntentId = rpc.payment_intent_id;

    // ── Chamada REAL a Edge Function -> Mercado Pago sandbox, metodo Pix ────────────────────────
    const cpfTeste = gerarCpfTeste();
    console.log(`\n>>> Chamando ${FUNCTION_URL} (Pix, payment_intent_id=${paymentIntentId})...\n`);
    const resp = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}`, 'apikey': ANON_KEY },
      body: JSON.stringify({
        payment_intent_id: paymentIntentId,
        payment_method_id: 'pix',
        payer: { email: `teste-onda3-${Date.now()}@gmail.com`, identification: { type: 'CPF', number: cpfTeste } },
      }),
    });
    const respJson = await resp.json().catch(() => null);
    console.log('Resposta HTTP', resp.status, ':', JSON.stringify(respJson, null, 2));

    check('C1 Edge Function respondeu 200', resp.status === 200, `status=${resp.status}`);
    check('C2 resposta tem ok:true', respJson && respJson.ok === true, JSON.stringify(respJson));
    check('C3 resposta tem mp_payment_id (numero real do Mercado Pago)', respJson && typeof respJson.mp_payment_id === 'string' && /^[0-9]+$/.test(respJson.mp_payment_id), JSON.stringify(respJson));
    check('C4 status devolvido no vocabulario interno (pendente/aprovado/recusado)', respJson && ['pendente', 'aprovado', 'recusado'].includes(respJson.status), JSON.stringify(respJson));

    if (respJson?.mp_payment_id) {
      const row = (await client.query(`SELECT mp_payment_id, status, status_detail, raw_payload->>'status' AS mp_status_cru FROM public.payment_intents WHERE id = $1`, [paymentIntentId])).rows[0];
      check('C5 payment_intents gravado no banco com o mp_payment_id REAL devolvido pela API', row.mp_payment_id === respJson.mp_payment_id, JSON.stringify(row));
      check('C6 raw_payload contem o status CRU do Mercado Pago (nao so o mapeado)', typeof row.mp_status_cru === 'string' && row.mp_status_cru.length > 0, JSON.stringify(row));
      console.log(`\nPagamento Pix REAL criado no sandbox do Mercado Pago: id=${respJson.mp_payment_id}, status_mp_cru=${row.mp_status_cru}, status_interno=${respJson.status}`);
    }

    // ── Idempotencia: repetir a MESMA chamada (mesmo payment_intent_id, Pix ainda 'pendente' ate
    // ser efetivamente pago) -- achado REAL ao rodar isso pela 1a vez: o Mercado Pago dedupe pela
    // MESMA X-Idempotency-Key (a do payment_intent, nunca gerada de novo) e devolve o MESMO
    // mp_payment_id em vez de criar um 2o cobranca -- comportamento correto e mais seguro do que um
    // erro 409 (retry de rede do cliente apos o Brick nunca duplica a cobranca). Verifica isso, nao
    // um 409 (expectativa inicial errada, corrigida apos ver a resposta real).
    const resp2 = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}`, 'apikey': ANON_KEY },
      body: JSON.stringify({ payment_intent_id: paymentIntentId, payment_method_id: 'pix', payer: { email: 'outro.teste@gmail.com', identification: { type: 'CPF', number: cpfTeste } } }),
    });
    const resp2Json = await resp2.json().catch(() => null);
    check('C7 2a chamada com o MESMO payment_intent_id -> MESMO mp_payment_id (dedupe real da API do MP pela X-Idempotency-Key, nunca cria 2o pagamento)',
      resp2.status === 200 && respJson && resp2Json && resp2Json.mp_payment_id === respJson.mp_payment_id, `status=${resp2.status} body=${JSON.stringify(resp2Json)}`);

  } finally {
    console.log('\n>>> Limpeza (delete explicito, sem rollback disponivel para chamada HTTP externa)...');
    await client.query(`DELETE FROM public.payment_intents WHERE order_id = $1`, [orderId]).catch(() => {});
    await client.query(`DELETE FROM public.orders WHERE id = $1`, [orderId]).catch(() => {});
    await client.query(`DELETE FROM public.customers WHERE id = $1`, [custId]).catch(() => {});
    await client.query(`DELETE FROM public.store_settings WHERE store_id = $1`, [STORE_A]).catch(() => {});
    await client.query(`DELETE FROM public.stores WHERE id = $1`, [STORE_A]).catch(() => {});
    console.log('Limpeza concluida.');

    console.log(`\n${'='.repeat(74)}\nTOTAL: ${pass} passaram, ${fail} falharam\n${'='.repeat(74)}`);
    await client.end();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

main().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
