// REF-PAYMENT-SEC-02 · Onda 1 -- valida contra o banco (E2E dedicado, NUNCA producao) o achado
// HIGH-01: selo de fidelidade so' e' concedido para pedido ONLINE depois do pagamento CONFIRMADO.
// Cobre os testes obrigatorios 1-5, 9, 10 da secao "Testes obrigatorios" da REF-PAYMENT-SEC-02:
//   1. pagamento recusado nao gera selo
//   2. pagamento expirado nao gera selo
//   3. pagamento aprovado gera selo
//   4. pagamento aprovado repetido (webhook duplicado) gera somente UM selo
//   5. webhook repetido nao duplica efeito (mesmo teste que 4, ponto de vista do lado do webhook)
//   9. retry (mesmo mp_payment_id, 1a associacao chamada 2x) nao gera duplicidade
//  10. concorrencia real (2 conexoes pg distintas) nao gera duplicidade
// + cenario de abuso: multiplos pedidos NAO PAGOS -> nenhuma acumulacao indevida de selo
// + regressao: metodos fisicos (dinheiro/pix-entrega/cartao-entrega) continuam ganhando o selo NA
//   CRIACAO, exatamente como antes (nunca dependem de confirmacao online)
// + regressao: resgate de recompensa (usar_recompensa_fidelidade) continua mutuamente exclusivo
//   com a concessao de selo (nenhuma mudanca de comportamento)
// Exit 0 = SUCCESS.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ENV_PATH = process.argv.includes('--prod')
  ? 'C:/Users/00thi/.encanto/db.env'
  : 'C:/Users/00thi/.encanto/db.e2e.env';
if (process.argv.includes('--prod')) { console.error('ABORTADO: este script nunca roda contra producao.'); process.exit(2); }

const envGet = (txt, k) => { const m = txt.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
function loadConn() {
  const txt = readFileSync(ENV_PATH, 'utf8');
  const password = envGet(txt, 'PGPASSWORD');
  if (!password) { console.error('ERRO: PGPASSWORD vazio'); process.exit(2); }
  return { host: envGet(txt, 'PGHOST'), port: Number(envGet(txt, 'PGPORT') || 5432), user: envGet(txt, 'PGUSER'), password, database: envGet(txt, 'PGDATABASE') || 'postgres' };
}
const conn = loadConn();
console.log(`Ambiente confirmado: ${conn.host} (${ENV_PATH})`);
const client = new pg.Client({ ...conn, ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

let pass = 0, fail = 0, n = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  ${extra}`); }
}
async function withTx(fn) {
  await client.query('BEGIN');
  try { return await fn(); } finally { await client.query('ROLLBACK'); }
}
async function comoLoja(storeId) {
  await client.query(`SET LOCAL role authenticated`);
  await client.query(`SET LOCAL request.jwt.claims = '${JSON.stringify({ sub: randomUUID(), tenant_id: storeId, role: 'authenticated' })}'`);
}
function callCreateOrder(customer, order, items, storeId, requestId = null) {
  return client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, $5::uuid, $4::uuid) AS res`,
    [JSON.stringify(customer), JSON.stringify(order), JSON.stringify(items), storeId, requestId]
  );
}
async function processarWebhook(mpPaymentId, novoStatus, storeId, statusDetail = null, payload = {}) {
  const r = await client.query(
    `SELECT public._processar_webhook_payment_intent($1::text, $2::text, $3::text, $4::uuid, $5::jsonb) AS res`,
    [mpPaymentId, novoStatus, statusDetail, storeId, JSON.stringify(payload)]
  );
  return r.rows[0].res;
}
async function selosDoCliente(customerId) {
  const r = await client.query(`SELECT coalesce(stamps,0) AS s FROM public.loyalty_accounts WHERE customer_id = $1`, [customerId]);
  return r.rows[0]?.s ?? 0;
}
async function eventosEarned(orderId) {
  const r = await client.query(`SELECT count(*)::int n FROM public.loyalty_events WHERE order_id = $1 AND tipo = 'earned'`, [orderId]);
  return r.rows[0].n;
}
const telefone = () => `397${(n++).toString().padStart(8, '0')}`;

async function main() {
  await client.connect();
  const STORE = randomUUID();
  const PROD = randomUUID();

  console.log('==========================================================================');
  console.log(' REF-PAYMENT-SEC-02 (Onda 1) · selo so apos pagamento confirmado (HIGH-01) (E2E)');
  console.log('==========================================================================\n');

  await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste SEC02 Onda1','ativo')`, [STORE, `payment-sec-02-onda1-${Date.now()}`]);
  await client.query(`INSERT INTO public.products (id, nome, preco, categoria_id, disponivel, store_id) VALUES ($1,'Produto Teste',20.00,NULL,true,$2)`, [PROD, STORE]);
  await client.query(
    `INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'loyalty_enabled','true'), ($1,'loyalty_required','10'), ($1,'loyalty_discount','50'), ($1,'pagamento_online_habilitada','true')`,
    [STORE]
  );
  const item = () => [{ product_id: PROD, nome_produto: 'Produto Teste', quantity: 1, price: 20.00, preco_unitario: 20.00 }];

  const novoPedidoOnline = async (label) => {
    await comoLoja(STORE);
    const phone = telefone();
    const r = await callCreateOrder(
      { name: label, phone },
      { payment_method: 'online', address: 'Retirada na loja', retirada: true, status: 'aguardando_pagamento' },
      item(), STORE
    );
    const res = r.rows[0].res;
    if (!res.ok) throw new Error(`create_order falhou (${label}): ${JSON.stringify(res)}`);
    // RESET ROLE: comoLoja() deixou "authenticated" ativo pro resto da transacao (SET LOCAL) --
    // sem isso, tanto a leitura de verificacao quanto uma chamada seguinte a
    // _processar_webhook_payment_intent cairiam sob RLS (orders/payment_intents sao deny-all pra
    // authenticated generico), dando falso "nao encontrado" em vez do resultado real.
    await client.query('RESET ROLE');
    const customerId = (await client.query(`SELECT customer_id FROM public.orders WHERE id=$1`, [res.order_id])).rows[0].customer_id;
    return { orderId: res.order_id, customerId, res };
  };

  try {
    // ══ 1. Pagamento RECUSADO nao gera selo ═══════════════════════════════════════════════════
    await withTx(async () => {
      const { orderId, customerId } = await novoPedidoOnline('recusado1');
      const antes = await selosDoCliente(customerId);
      check('1. Pedido online criado -> selo AINDA NAO concedido (deferido)', antes === 0 && (await eventosEarned(orderId)) === 0, `antes=${antes}`);

      const mpId = `mp-onda1-recusado-${Date.now()}`;
      await client.query(`INSERT INTO public.payment_intents (id,store_id,order_id,amount,status,mp_payment_id) VALUES (gen_random_uuid(),$1,$2,20.00,'pendente',$3)`, [STORE, orderId, mpId]);
      await processarWebhook(mpId, 'recusado', STORE, 'cc_rejected_other_reason');

      const depois = await selosDoCliente(customerId);
      check('1. Pagamento RECUSADO -> nenhum selo concedido', depois === 0 && (await eventosEarned(orderId)) === 0, `depois=${depois}`);
    });

    // ══ 2. Pagamento EXPIRADO nao gera selo ════════════════════════════════════════════════════
    await withTx(async () => {
      const { orderId, customerId } = await novoPedidoOnline('expirado1');
      const mpId = `mp-onda1-expirado-${Date.now()}`;
      await client.query(`INSERT INTO public.payment_intents (id,store_id,order_id,amount,status,mp_payment_id,created_at) VALUES (gen_random_uuid(),$1,$2,20.00,'pendente',$3,now()-interval '20 minutes')`, [STORE, orderId, mpId]);
      await client.query(`SELECT public._expirar_payment_intents_pendentes()`);
      const depois = await selosDoCliente(customerId);
      check('2. Pagamento EXPIRADO (job 15min) -> nenhum selo concedido', depois === 0 && (await eventosEarned(orderId)) === 0, `depois=${depois}`);
    });

    // ══ 3. Pagamento APROVADO gera exatamente 1 selo ═══════════════════════════════════════════
    await withTx(async () => {
      const { orderId, customerId } = await novoPedidoOnline('aprovado1');
      const mpId = `mp-onda1-aprovado-${Date.now()}`;
      await client.query(`INSERT INTO public.payment_intents (id,store_id,order_id,amount,status,mp_payment_id) VALUES (gen_random_uuid(),$1,$2,20.00,'pendente',$3)`, [STORE, orderId, mpId]);
      const res = await processarWebhook(mpId, 'aprovado', STORE, 'accredited');
      const depois = await selosDoCliente(customerId);
      const eventos = await eventosEarned(orderId);
      check('3. Pagamento APROVADO -> exatamente 1 selo concedido', res.ok === true && depois === 1 && eventos === 1, `depois=${depois} eventos=${eventos}`);
    });

    // ══ 4/5. Webhook duplicado (aprovado 2x) -> so 1 selo ══════════════════════════════════════
    await withTx(async () => {
      const { orderId, customerId } = await novoPedidoOnline('duplicado1');
      const mpId = `mp-onda1-dup-${Date.now()}`;
      await client.query(`INSERT INTO public.payment_intents (id,store_id,order_id,amount,status,mp_payment_id) VALUES (gen_random_uuid(),$1,$2,20.00,'pendente',$3)`, [STORE, orderId, mpId]);
      const r1 = await processarWebhook(mpId, 'aprovado', STORE, 'accredited');
      const r2 = await processarWebhook(mpId, 'aprovado', STORE, 'accredited'); // duplicado exato
      const depois = await selosDoCliente(customerId);
      const eventos = await eventosEarned(orderId);
      check('4/5. Webhook APROVADO duplicado (2x) -> apenas 1 selo (idempotente)',
        r1.ok === true && r2.ok === true && r2.idempotente === true && depois === 1 && eventos === 1,
        JSON.stringify({ r1, r2, depois, eventos }));
    });

    // ══ 9. Retry na 1a associacao (mesmo mp_payment_id, _registrar_criacao_pagamento 2x) ═══════
    await withTx(async () => {
      const { orderId, customerId } = await novoPedidoOnline('retry1');
      const piId = randomUUID();
      const mpId = `mp-onda1-retry-${Date.now()}`;
      await client.query(`INSERT INTO public.payment_intents (id,store_id,order_id,amount,status) VALUES ($1,$2,$3,20.00,'pendente')`, [piId, STORE, orderId]);
      const r1 = await client.query(`SELECT public._registrar_criacao_pagamento($1::uuid,$2::uuid,$3::text,'aprovado','accredited','{}'::jsonb) AS res`, [piId, STORE, mpId]);
      const r2 = await client.query(`SELECT public._registrar_criacao_pagamento($1::uuid,$2::uuid,$3::text,'aprovado','accredited','{}'::jsonb) AS res`, [piId, STORE, mpId]); // retry de rede, mesmo mp_payment_id
      const depois = await selosDoCliente(customerId);
      check('9. Retry (mesmo mp_payment_id, 1a associacao 2x) -> apenas 1 selo',
        r1.rows[0].res.ok === true && r2.rows[0].res.ok === true && depois === 1, JSON.stringify({ r1: r1.rows[0].res, r2: r2.rows[0].res, depois }));
    });

    // ══ 10. CONCORRENCIA REAL: 2 conexoes simultaneas processam o MESMO webhook aprovado ════════
    // Achado do proprio teste (mesmo padrao ja documentado em loyalty-02-onda2-test.mjs, Camada C):
    // uma 2a conexao pg SEPARADA nao enxerga dados nao-commitados de outra transacao (MVCC) -- o
    // setup (pedido+payment_intent) precisa estar COMMITADO antes da corrida, senao a 2a conexao
    // simplesmente nao encontra o payment_intent (falha por um motivo ERRADO, nao pelo lock real
    // que este teste quer provar). Por isso esta secao COMMITA (em vez de usar withTx) e faz
    // limpeza pela DELETE final do finally (por store_id), nao por ROLLBACK.
    {
      await client.query('BEGIN');
      const { orderId, customerId } = await novoPedidoOnline('concorrencia1');
      const mpId = `mp-onda1-race-${Date.now()}`;
      await client.query(`INSERT INTO public.payment_intents (id,store_id,order_id,amount,status,mp_payment_id) VALUES (gen_random_uuid(),$1,$2,20.00,'pendente',$3)`, [STORE, orderId, mpId]);
      await client.query('COMMIT');

      const connB = new pg.Client({ ...conn, ssl: { rejectUnauthorized: false } });
      await connB.connect();
      try {
        const chamar = (c) => c.query(
          `SELECT public._processar_webhook_payment_intent($1::text,'aprovado','accredited',$2::uuid,'{}'::jsonb) AS res`,
          [mpId, STORE]
        );
        const [resA, resB] = await Promise.all([chamar(client), chamar(connB)]);
        const depois = await selosDoCliente(customerId);
        const eventos = await eventosEarned(orderId);
        const okA = resA.rows[0].res.ok === true, okB = resB.rows[0].res.ok === true;
        check('10. Concorrencia real (2 conexoes pg simultaneas, mesmo webhook) -> apenas 1 selo, sem erro',
          okA && okB && depois === 1 && eventos === 1,
          JSON.stringify({ resA: resA.rows[0].res, resB: resB.rows[0].res, depois, eventos }));
      } finally {
        await connB.end();
      }
    }

    // ══ ABUSO: multiplos pedidos ONLINE nao pagos -> ZERO acumulacao indevida ══════════════════
    await withTx(async () => {
      const phone = telefone();
      await comoLoja(STORE);
      const r0 = await callCreateOrder({ name: 'abuso', phone }, { payment_method: 'online', address: 'Retirada na loja', retirada: true, status: 'aguardando_pagamento' }, item(), STORE);
      // 5 pedidos abandonados (nunca pagos) do MESMO cliente
      for (let i = 0; i < 5; i++) {
        await callCreateOrder({ name: 'abuso', phone }, { payment_method: 'online', address: 'Retirada na loja', retirada: true, status: 'aguardando_pagamento' }, item(), STORE);
      }
      await client.query('RESET ROLE'); // ver comentario em novoPedidoOnline
      const customerId = (await client.query(`SELECT customer_id FROM public.orders WHERE id=$1`, [r0.rows[0].res.order_id])).rows[0].customer_id;
      const selos = await selosDoCliente(customerId);
      check('ABUSO: 6 pedidos online criados, NENHUM pago -> zero selos acumulados (era o achado original)', selos === 0, `selos=${selos}`);
    });

    // ══ REGRESSAO: metodo FISICO continua ganhando selo NA CRIACAO (nunca dependeu de webhook) ══
    await withTx(async () => {
      await comoLoja(STORE);
      const phone = telefone();
      const r = await callCreateOrder({ name: 'fisico1', phone }, { payment_method: 'dinheiro', address: 'Rua Teste, 1', retirada: true }, item(), STORE);
      await client.query('RESET ROLE');
      const customerId = (await client.query(`SELECT customer_id FROM public.orders WHERE id=$1`, [r.rows[0].res.order_id])).rows[0].customer_id;
      const selos = await selosDoCliente(customerId);
      check('REGRESSAO: pedido FISICO (dinheiro) continua ganhando selo NA CRIACAO, sem depender de webhook',
        r.rows[0].res.ok === true && selos === 1, `ok=${r.rows[0].res.ok} selos=${selos}`);
    });

    // ══ REGRESSAO: pedido de RETIRADA/MESA fisica (status='recebido' default) tambem ganha na hora ══
    await withTx(async () => {
      await comoLoja(STORE);
      const phone = telefone();
      const r = await callCreateOrder({ name: 'pix-fisico1', phone }, { payment_method: 'pix', address: 'Retirada na loja', retirada: true }, item(), STORE);
      await client.query('RESET ROLE');
      const customerId = (await client.query(`SELECT customer_id FROM public.orders WHERE id=$1`, [r.rows[0].res.order_id])).rows[0].customer_id;
      const selos = await selosDoCliente(customerId);
      check('REGRESSAO: PIX fisico (na entrega, status recebido default) continua ganhando selo na criacao',
        r.rows[0].res.ok === true && selos === 1, `selos=${selos}`);
    });

    // ══ REGRESSAO: loyalty_void_on_cancel continua revertendo pedido FISICO cancelado (intocado) ══
    await withTx(async () => {
      await comoLoja(STORE);
      const phone = telefone();
      const r = await callCreateOrder({ name: 'fisico-cancel', phone }, { payment_method: 'dinheiro', address: 'Rua Teste, 1', retirada: true }, item(), STORE);
      await client.query('RESET ROLE');
      const customerId = (await client.query(`SELECT customer_id FROM public.orders WHERE id=$1`, [r.rows[0].res.order_id])).rows[0].customer_id;
      const antes = await selosDoCliente(customerId);
      await client.query(`UPDATE public.orders SET status='cancelado' WHERE id=$1`, [r.rows[0].res.order_id]);
      const depois = await selosDoCliente(customerId);
      check('REGRESSAO: loyalty_void_on_cancel continua revertendo pedido fisico cancelado (trigger intocado)',
        antes === 1 && depois === 0, `antes=${antes} depois=${depois}`);
    });

    // ══ REGRESSAO: resgate de recompensa continua mutuamente exclusivo (nenhuma mudanca) ═══════
    await withTx(async () => {
      const phone = telefone();
      // cliente ja com 10 selos (elegivel) -- INSERT direto ANTES de comoLoja (RLS de customers
      // so' permite INSERT/UPDATE por admin, nao por um authenticated generico).
      const custId = (await client.query(`INSERT INTO public.customers (name,phone,store_id) VALUES ('resgate1',$1,$2) RETURNING id`, [phone, STORE])).rows[0].id;
      await client.query(`INSERT INTO public.loyalty_accounts (customer_id, store_id, stamps) VALUES ($1,$2,10)`, [custId, STORE]);
      await comoLoja(STORE);
      const r = await callCreateOrder({ name: 'resgate1', phone }, { payment_method: 'dinheiro', address: 'Rua Teste, 1', retirada: true, usar_recompensa_fidelidade: true }, item(), STORE);
      await client.query('RESET ROLE');
      const selos = await selosDoCliente(custId);
      check('REGRESSAO: resgate de recompensa continua debitando (nao ganha selo novo no mesmo pedido)',
        r.rows[0].res.ok === true && selos === 0, `ok=${r.rows[0].res.ok} selos=${selos} res=${JSON.stringify(r.rows[0].res)}`);
    });

    console.log(`\n${pass} passaram, ${fail} falharam.`);
  } finally {
    await client.query(`DELETE FROM public.loyalty_events WHERE store_id = $1`, [STORE]);
    await client.query(`DELETE FROM public.loyalty_accounts WHERE store_id = $1`, [STORE]);
    await client.query(`DELETE FROM public.payment_intents WHERE store_id = $1`, [STORE]);
    await client.query(`DELETE FROM public.order_items WHERE store_id = $1`, [STORE]);
    await client.query(`DELETE FROM public.orders WHERE store_id = $1`, [STORE]);
    await client.query(`DELETE FROM public.customers WHERE store_id = $1`, [STORE]);
    await client.query(`DELETE FROM public.products WHERE store_id = $1`, [STORE]);
    await client.query(`DELETE FROM public.store_settings WHERE store_id = $1`, [STORE]);
    await client.query(`DELETE FROM public.stores WHERE id = $1`, [STORE]);
    await client.end();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('ERRO FATAL:', e.message);
  try { await client.query('ROLLBACK'); } catch {}
  await client.end().catch(() => {});
  process.exit(1);
});
