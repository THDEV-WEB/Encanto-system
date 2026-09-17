// REF-PROMO-01 -- valida que _resolve_item_pricing()/create_order() aplicam preco promocional POR
// TAMANHO corretamente e que a constraint nova (products_preco_promo_check) protege o produto simples,
// contra o projeto Supabase DEDICADO a E2E (nunca producao). Cada caso roda dentro de BEGIN...ROLLBACK
// -- nenhuma escrita e persistida. Mesmo padrao de scripts/price-source-01-onda1-test.mjs. Exit 0 = SUCCESS.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ENV_PATH = 'C:/Users/00thi/.encanto/db.e2e.env';

const envGet = (txt, k) => { const m = txt.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
function loadConn() {
  const txt = readFileSync(ENV_PATH, 'utf8');
  const password = envGet(txt, 'PGPASSWORD');
  if (!password) { console.error('ERRO: PGPASSWORD vazio'); process.exit(2); }
  return { host: envGet(txt, 'PGHOST'), port: Number(envGet(txt, 'PGPORT') || 5432), user: envGet(txt, 'PGUSER'), password, database: envGet(txt, 'PGDATABASE') || 'postgres' };
}

const ENCANTO = 'be2efc10-c0c8-410f-bcd4-af3f8a371df3';

const client = new pg.Client({ ...loadConn(), ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

let pass = 0, fail = 0, n = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  ${extra}`); }
}

async function withTx(fn) {
  await client.query('BEGIN');
  try { return await fn(); } finally { await client.query('ROLLBACK'); }
}
async function setJwt(sub, tenantId) {
  const claims = sub ? { sub, ...(tenantId ? { tenant_id: tenantId } : {}) } : {};
  await client.query(`SET LOCAL request.jwt.claims = '${JSON.stringify(claims)}'`);
}
async function comoEncanto() { await setJwt(randomUUID(), ENCANTO); }

const telefone = () => `388${(n++).toString().padStart(8, '0')}`;

function callCreateOrder(customer, order, items, storeId = ENCANTO) {
  return client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
    [JSON.stringify(customer), JSON.stringify(order), JSON.stringify(items), storeId]
  );
}
async function getOrderItem(orderId) {
  const r = await client.query(`SELECT price, preco_unitario FROM public.order_items WHERE order_id = $1`, [orderId]);
  return r.rows[0];
}

async function main() {
  await client.connect();

  // ── Caso 1 — Casadinho-like: tamanho "1 copo" com promo -> servidor cobra o preco promocional. ──
  await withTx(async () => {
    const prodId = randomUUID();
    await client.query(
      `INSERT INTO public.products (id, nome, preco, tamanhos, categoria_id, disponivel, store_id)
       VALUES ($1,'Casadinho Teste', 32.99, $2::jsonb, NULL, true, $3)`,
      [prodId, JSON.stringify([
        { label: '1 copo (500 ml)', preco: 32.99, preco_promo: 27.99 },
        { label: '2 copos (500 ml cada)', preco: 65.98, preco_promo: 49.99 },
      ]), ENCANTO]
    );
    await comoEncanto();
    const p = telefone();
    // client tenta manipular o preco (manda 1.00) -- servidor deve ignorar e usar o promo real (27.99)
    const r = await callCreateOrder(
      { name: 'Teste Promo1', phone: p },
      { total: 1.00, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: prodId, tamanho_label: '1 copo (500 ml)', nome_produto: 'Casadinho Teste', quantity: 1, price: 1.00, preco_unitario: 1.00 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) {
      const item = await getOrderItem(res.order_id);
      ok = Number(item.price) === 27.99 && Number(item.preco_unitario) === 27.99;
    }
    check('Caso 1 — tamanho "1 copo" com promo (27.99) -> servidor cobra 27.99 (nunca 32.99 nem o 1.00 do client)', ok, JSON.stringify(res));
  });

  // ── Caso 2 — mesmo produto, tamanho "2 copos" com promo diferente. ──────────────────────────────
  await withTx(async () => {
    const prodId = randomUUID();
    await client.query(
      `INSERT INTO public.products (id, nome, preco, tamanhos, categoria_id, disponivel, store_id)
       VALUES ($1,'Casadinho Teste 2', 32.99, $2::jsonb, NULL, true, $3)`,
      [prodId, JSON.stringify([
        { label: '1 copo (500 ml)', preco: 32.99, preco_promo: 27.99 },
        { label: '2 copos (500 ml cada)', preco: 65.98, preco_promo: 49.99 },
      ]), ENCANTO]
    );
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste Promo2', phone: p },
      { total: 1.00, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: prodId, tamanho_label: '2 copos (500 ml cada)', nome_produto: 'Casadinho Teste 2', quantity: 1, price: 1.00, preco_unitario: 1.00 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) {
      const item = await getOrderItem(res.order_id);
      ok = Number(item.price) === 49.99;
    }
    check('Caso 2 — tamanho "2 copos" com promo (49.99) -> servidor cobra 49.99 (nunca 65.98)', ok, JSON.stringify(res));
  });

  // ── Caso 3 — regressao: tamanho SEM preco_promo continua usando o preco cheio (comportamento de sempre). ──
  await withTx(async () => {
    const prodId = randomUUID();
    await client.query(
      `INSERT INTO public.products (id, nome, preco, tamanhos, categoria_id, disponivel, store_id)
       VALUES ($1,'Acai Sem Promo', 17.90, $2::jsonb, NULL, true, $3)`,
      [prodId, JSON.stringify([{ label: '300 ml', preco: 17.90 }, { label: '500 ml', preco: 26.90 }]), ENCANTO]
    );
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste Regressao', phone: p },
      { total: 26.90, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: prodId, tamanho_label: '500 ml', nome_produto: 'Acai Sem Promo', quantity: 1, price: 26.90, preco_unitario: 26.90 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) {
      const item = await getOrderItem(res.order_id);
      ok = Number(item.price) === 26.90;
    }
    check('Caso 3 — regressão: tamanho sem preco_promo -> preço cheio (26.90), idêntico a antes desta REF', ok, JSON.stringify(res));
  });

  // ── Caso 4 — tamanho com preco_promo corrompido/malicioso (>= preco cheio) -> ignorado, cobra o cheio. ──
  await withTx(async () => {
    const prodId = randomUUID();
    await client.query(
      `INSERT INTO public.products (id, nome, preco, tamanhos, categoria_id, disponivel, store_id)
       VALUES ($1,'Promo Invalida', 20.00, $2::jsonb, NULL, true, $3)`,
      [prodId, JSON.stringify([{ label: 'Único', preco: 20.00, preco_promo: 25.00 }]), ENCANTO]
    );
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste Promo Invalida', phone: p },
      { total: 20.00, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: prodId, tamanho_label: 'Único', nome_produto: 'Promo Invalida', quantity: 1, price: 20.00, preco_unitario: 20.00 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) {
      const item = await getOrderItem(res.order_id);
      ok = Number(item.price) === 20.00; // promo >= preco cheio -> ignorada
    }
    check('Caso 4 — preco_promo do tamanho >= preço cheio (dado corrompido) -> ignorado, cobra 20.00', ok, JSON.stringify(res));
  });

  // ── Caso 5 — regressao: produto SIMPLES com preco_promo classico continua identico. ──────────────
  await withTx(async () => {
    const prodId = randomUUID();
    await client.query(
      `INSERT INTO public.products (id, nome, preco, preco_promo, categoria_id, disponivel, store_id) VALUES ($1,'Combo Promo Simples', 29.90, 24.90, NULL, true, $2)`,
      [prodId, ENCANTO]
    );
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste Simples', phone: p },
      { total: 1.00, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: prodId, nome_produto: 'Combo Promo Simples', quantity: 1, price: 1.00, preco_unitario: 1.00 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) {
      const item = await getOrderItem(res.order_id);
      ok = Number(item.price) === 24.90;
    }
    check('Caso 5 — regressão: produto simples com preco_promo=24.90 -> inalterado', ok, JSON.stringify(res));
  });

  // ── Caso 6 — constraint products_preco_promo_check rejeita negativo/zero/>=preco. ────────────────
  await withTx(async () => {
    let rejeitados = 0;
    const tentativas = [
      { preco_promo: -5, label: 'negativo' },
      { preco_promo: 0, label: 'zero' },
      { preco_promo: 15, label: 'maior que preco (10)' },
    ];
    for (const t of tentativas) {
      try {
        await client.query('SAVEPOINT sp');
        await client.query(
          `INSERT INTO public.products (id, nome, preco, preco_promo, categoria_id, disponivel, store_id) VALUES ($1,'Teste Constraint', 10.00, $2, NULL, true, $3)`,
          [randomUUID(), t.preco_promo, ENCANTO]
        );
      } catch (e) {
        if (e.code === '23514') rejeitados++; // check_violation
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT sp');
      }
    }
    check('Caso 6 — constraint rejeita preco_promo negativo/zero/maior-que-preco (3/3)', rejeitados === 3, `rejeitados=${rejeitados}/3`);
  });

  console.log(`\n${pass} passaram, ${fail} falharam.`);
  await client.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('ERRO FATAL:', e.message);
  try { await client.query('ROLLBACK'); } catch {}
  await client.end().catch(() => {});
  process.exit(1);
});
