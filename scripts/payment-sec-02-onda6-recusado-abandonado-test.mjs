// REF-PAYMENT-SEC-02 · Onda 6 -- valida contra o banco (E2E dedicado, NUNCA producao) que um pedido
// com pagamento RECUSADO que o cliente nunca reenvia deixa de ficar preso pra sempre em
// 'aguardando_pagamento'. Reproduz o bug com a versao ANTIGA da funcao (rollback), confirma o fix
// com a versao NOVA, e cobre os casos de regressao (retry do cliente, janela ainda nao vencida,
// varios payment_intents pro mesmo pedido, comportamento pre-existente do caso 'expirado').
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

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  ${extra}`); }
}
async function withTx(fn) {
  await client.query('BEGIN');
  try { return await fn(); } finally { await client.query('ROLLBACK'); }
}

const ROLLBACK_SQL = readFileSync('C:/Projetos/Encanto/encanto-react/migrations/REF-PAYMENT-SEC-02-onda6-recusado-abandonado-rollback.sql', 'utf8');
const FIX_SQL = readFileSync('C:/Projetos/Encanto/encanto-react/migrations/REF-PAYMENT-SEC-02-onda6-recusado-abandonado.sql', 'utf8');

async function novoPedido(store, { statusPedido = 'aguardando_pagamento' } = {}) {
  const orderId = randomUUID();
  await client.query(
    `INSERT INTO public.orders (id, total, status, payment_method, address, store_id, tipo_pedido, origem_pedido, payment_status)
     VALUES ($1,2.00,$2,'pix','Retirada na loja',$3,'retirada','storefront','recusado')`,
    [orderId, statusPedido, store]
  );
  return orderId;
}
async function novoPaymentIntent(store, orderId, { status, minutosAtras = 0 }) {
  const piId = randomUUID();
  await client.query(
    `INSERT INTO public.payment_intents (id, store_id, order_id, amount, status, status_detail, mp_payment_id, created_at, updated_at)
     VALUES ($1,$2,$3,2.00,$4,NULL,$5, now() - ($6 || ' minutes')::interval, now() - ($6 || ' minutes')::interval)`,
    [piId, store, orderId, status, `mp-onda6-${randomUUID()}`, minutosAtras]
  );
  return piId;
}

async function main() {
  await client.connect();
  const STORE = randomUUID();

  console.log('==========================================================================');
  console.log(' REF-PAYMENT-SEC-02 (Onda 6) · pagamento recusado abandonado (E2E)');
  console.log('==========================================================================\n');

  await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste SEC02 Onda6','ativo')`, [STORE, `payment-sec-02-onda6-${Date.now()}`]);

  try {
    // ══ PROVA DO BUG (versao ANTIGA da funcao, via rollback) ══════════════════════════════════════
    await client.query(ROLLBACK_SQL);
    await withTx(async () => {
      const orderId = await novoPedido(STORE);
      await novoPaymentIntent(STORE, orderId, { status: 'recusado', minutosAtras: 20 });
      await client.query(`SELECT public._expirar_payment_intents_pendentes()`);
      const o = await client.query(`SELECT status FROM public.orders WHERE id = $1`, [orderId]);
      check('BUG REPRODUZIDO (versao antiga) · pedido com recusado ha 20min NAO e cancelado -- fica preso pra sempre',
        o.rows[0].status === 'aguardando_pagamento', JSON.stringify(o.rows[0]));
    });

    // ══ APLICA O FIX ═══════════════════════════════════════════════════════════════════════════════
    await client.query(FIX_SQL);

    // ══ FIX CONFIRMADO: recusado ha mais de 15min, sem retry -> pedido cancelado ═════════════════
    await withTx(async () => {
      const orderId = await novoPedido(STORE);
      await novoPaymentIntent(STORE, orderId, { status: 'recusado', minutosAtras: 20 });
      await client.query(`SELECT public._expirar_payment_intents_pendentes()`);
      const o = await client.query(`SELECT status, payment_status FROM public.orders WHERE id = $1`, [orderId]);
      check('FIX · pedido com recusado ha 20min e cancelado', o.rows[0].status === 'cancelado', JSON.stringify(o.rows[0]));
      check('FIX · payment_status permanece "recusado" (nao e reescrito -- ja refletia o fato real)',
        o.rows[0].payment_status === 'recusado', JSON.stringify(o.rows[0]));
    });

    // ══ REGRESSAO: recusado ha MENOS de 15min -> ainda dentro da janela, NAO cancela ainda ═══════
    await withTx(async () => {
      const orderId = await novoPedido(STORE);
      await novoPaymentIntent(STORE, orderId, { status: 'recusado', minutosAtras: 5 });
      await client.query(`SELECT public._expirar_payment_intents_pendentes()`);
      const o = await client.query(`SELECT status FROM public.orders WHERE id = $1`, [orderId]);
      check('REGRESSAO · recusado ha so 5min continua aguardando_pagamento (ainda dentro da janela de retry)',
        o.rows[0].status === 'aguardando_pagamento', JSON.stringify(o.rows[0]));
    });

    // ══ REGRESSAO: cliente TENTOU DE NOVO -- recusado antigo + pendente novo -> NAO cancela ══════
    await withTx(async () => {
      const orderId = await novoPedido(STORE);
      await novoPaymentIntent(STORE, orderId, { status: 'recusado', minutosAtras: 30 });
      await novoPaymentIntent(STORE, orderId, { status: 'pendente', minutosAtras: 2 });
      await client.query(`SELECT public._expirar_payment_intents_pendentes()`);
      const o = await client.query(`SELECT status FROM public.orders WHERE id = $1`, [orderId]);
      check('REGRESSAO · cliente reenviou (novo payment_intent pendente) -- pedido NAO cancelado pelo branch recusado',
        o.rows[0].status === 'aguardando_pagamento', JSON.stringify(o.rows[0]));
    });

    // ══ REGRESSAO: cliente tentou de novo E foi aprovado -- pedido ja nao esta mais aguardando ═══
    await withTx(async () => {
      const orderId = await novoPedido(STORE);
      await novoPaymentIntent(STORE, orderId, { status: 'recusado', minutosAtras: 30 });
      await novoPaymentIntent(STORE, orderId, { status: 'aprovado', minutosAtras: 2 });
      await client.query(`UPDATE public.orders SET status = 'recebido', payment_status = 'aprovado' WHERE id = $1`, [orderId]);
      await client.query(`SELECT public._expirar_payment_intents_pendentes()`);
      const o = await client.query(`SELECT status FROM public.orders WHERE id = $1`, [orderId]);
      check('REGRESSAO · pedido ja recebido (retry aprovado) permanece intocado pelo cron',
        o.rows[0].status === 'recebido', JSON.stringify(o.rows[0]));
    });

    // ══ REGRESSAO: 2 payment_intents recusados -- so o MAIS RECENTE importa (LATERAL ORDER BY) ═══
    await withTx(async () => {
      const orderId = await novoPedido(STORE);
      await novoPaymentIntent(STORE, orderId, { status: 'recusado', minutosAtras: 40 });
      await novoPaymentIntent(STORE, orderId, { status: 'recusado', minutosAtras: 20 });
      await client.query(`SELECT public._expirar_payment_intents_pendentes()`);
      const o = await client.query(`SELECT status FROM public.orders WHERE id = $1`, [orderId]);
      check('REGRESSAO · 2 recusados, mais recente com 20min -- cancela usando a data do mais recente',
        o.rows[0].status === 'cancelado', JSON.stringify(o.rows[0]));
    });

    // ══ REGRESSAO: comportamento pre-existente 'pendente' -> 'expirado' continua intacto ═════════
    await withTx(async () => {
      const orderId = await novoPedido(STORE);
      await novoPaymentIntent(STORE, orderId, { status: 'pendente', minutosAtras: 20 });
      const n = await client.query(`SELECT public._expirar_payment_intents_pendentes() AS n`);
      const o = await client.query(`SELECT status, payment_status FROM public.orders WHERE id = $1`, [orderId]);
      check('REGRESSAO · caso pendente->expirado continua funcionando (return count >= 1)', n.rows[0].n >= 1, JSON.stringify(n.rows[0]));
      check('REGRESSAO · pedido expirado continua sendo cancelado com payment_status=expirado',
        o.rows[0].status === 'cancelado' && o.rows[0].payment_status === 'expirado', JSON.stringify(o.rows[0]));
    });

  } finally {
    await client.query(`DELETE FROM public.payment_intents WHERE store_id = $1`, [STORE]);
    await client.query(`DELETE FROM public.orders WHERE store_id = $1`, [STORE]);
    await client.query(`DELETE FROM public.stores WHERE id = $1`, [STORE]);
    await client.end();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('ERRO FATAL:', e); process.exit(1); });
