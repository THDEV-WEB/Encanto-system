// REF-PAGAMENTO-01 · Onda 6 (payment_method real) -- E2E dedicado.
// _registrar_criacao_pagamento agora mapeia payment_type_id (vocabulario do Mercado Pago) pro
// vocabulario ja existente do projeto (dinheiro/pix/cartao_debito/cartao_credito) na 1a associacao.
// SAVEPOINT por caso.
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

let pass = 0, fail = 0, spCounter = 0;
function check(label, cond, extra = '') { if (cond) { pass++; console.log(`PASS  ${label}`); } else { fail++; console.log(`FAIL  ${label}  ${extra}`); } }
async function withSavepoint(fn) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try { return await fn(); } finally { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); }
}

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-PAGAMENTO-01 · Onda 6 (payment_method real) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const STORE_A = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste PAGAMENTO-01 Onda6','ativo')`, [STORE_A, `pagamento01-onda6-${STORE_A}`]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'pagamento_online_habilitada','true')`, [STORE_A]);

    async function novoPagamentoOnline(total = 50.00) {
      const custId = randomUUID(); const orderId = randomUUID();
      await client.query(`INSERT INTO public.customers (id, name, phone, store_id) VALUES ($1,'Cliente Onda6','37600000001',$2)`, [custId, STORE_A]);
      await client.query(`INSERT INTO public.orders (id, customer_id, total, status, payment_method, address, store_id, tipo_pedido, origem_pedido) VALUES ($1,$2,$3,'aguardando_pagamento','online','Rua Onda6',$4,'entrega','storefront')`, [orderId, custId, total, STORE_A]);
      const piId = (await client.query(`SELECT public.iniciar_pagamento_pedido($1, $2) AS r`, [orderId, STORE_A])).rows[0].r.payment_intent_id;
      return { orderId, piId };
    }

    // ── I1: credit_card -> cartao_credito ────────────────────────────────────────────────────
    await withSavepoint(async () => {
      const { orderId, piId } = await novoPagamentoOnline();
      const payload = { payment_type_id: 'credit_card', payment_method_id: 'visa', status: 'approved' };
      const r = await client.query(`SELECT public._registrar_criacao_pagamento($1,$2,$3,$4,$5,$6) AS r`,
        [piId, STORE_A, 'mp-cc-1', 'aprovado', 'accredited', JSON.stringify(payload)]);
      check('I1 ok', r.rows[0].r.ok === true, JSON.stringify(r.rows[0].r));
      const ord = (await client.query(`SELECT payment_method, status, payment_status FROM public.orders WHERE id=$1`, [orderId])).rows[0];
      check('I1b payment_method vira cartao_credito (era online)', ord.payment_method === 'cartao_credito', JSON.stringify(ord));
      check('I1c status/payment_status atualizados normalmente (aprovacao)', ord.status === 'recebido' && ord.payment_status === 'aprovado');
    });

    // ── I2: debit_card -> cartao_debito ──────────────────────────────────────────────────────
    await withSavepoint(async () => {
      const { orderId, piId } = await novoPagamentoOnline();
      const payload = { payment_type_id: 'debit_card', payment_method_id: 'elo', status: 'approved' };
      await client.query(`SELECT public._registrar_criacao_pagamento($1,$2,$3,$4,$5,$6) AS r`,
        [piId, STORE_A, 'mp-dc-1', 'aprovado', 'accredited', JSON.stringify(payload)]);
      const ord = (await client.query(`SELECT payment_method FROM public.orders WHERE id=$1`, [orderId])).rows[0];
      check('I2 payment_method vira cartao_debito', ord.payment_method === 'cartao_debito', JSON.stringify(ord));
    });

    // ── I3: bank_transfer -> pix ──────────────────────────────────────────────────────────────
    await withSavepoint(async () => {
      const { orderId, piId } = await novoPagamentoOnline();
      const payload = { payment_type_id: 'bank_transfer', payment_method_id: 'pix', status: 'pending' };
      await client.query(`SELECT public._registrar_criacao_pagamento($1,$2,$3,$4,$5,$6) AS r`,
        [piId, STORE_A, 'mp-pix-1', 'pendente', 'pending_waiting_transfer', JSON.stringify(payload)]);
      const ord = (await client.query(`SELECT payment_method FROM public.orders WHERE id=$1`, [orderId])).rows[0];
      check('I3 payment_method vira pix', ord.payment_method === 'pix', JSON.stringify(ord));
    });

    // ── I4: payment_type_id desconhecido/ausente -> NAO sobrescreve (mantem 'online') ────────
    await withSavepoint(async () => {
      const { orderId, piId } = await novoPagamentoOnline();
      const payload = { payment_type_id: 'digital_wallet', payment_method_id: 'account_money', status: 'approved' };
      await client.query(`SELECT public._registrar_criacao_pagamento($1,$2,$3,$4,$5,$6) AS r`,
        [piId, STORE_A, 'mp-dw-1', 'aprovado', 'accredited', JSON.stringify(payload)]);
      const ord = (await client.query(`SELECT payment_method FROM public.orders WHERE id=$1`, [orderId])).rows[0];
      check('I4 payment_type_id desconhecido -> mantem online (nunca adivinha)', ord.payment_method === 'online', JSON.stringify(ord));
    });

    await withSavepoint(async () => {
      const { orderId, piId } = await novoPagamentoOnline();
      await client.query(`SELECT public._registrar_criacao_pagamento($1,$2,$3,$4,$5,$6) AS r`,
        [piId, STORE_A, 'mp-null-1', 'aprovado', 'accredited', null]);
      const ord = (await client.query(`SELECT payment_method FROM public.orders WHERE id=$1`, [orderId])).rows[0];
      check('I5 raw_payload nulo -> mantem online (nunca quebra)', ord.payment_method === 'online', JSON.stringify(ord));
    });

    console.log(`\n${'='.repeat(74)}\nTOTAL: ${pass} passaram, ${fail} falharam\n${'='.repeat(74)}`);
    process.exitCode = fail > 0 ? 1 : 0;
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
