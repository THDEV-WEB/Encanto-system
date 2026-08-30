// REF-MONEY-SCALE-01 -- valida a migration que fixa numeric(10,2) nas 7 colunas monetarias sem
// escala (products.preco/preco_promo, order_items.price/preco_unitario, orders.total/delivery_fee/
// maquininha_fee) + a view v_order_reconciliation recriada. Contra o projeto Supabase DEDICADO a
// E2E (nunca producao). Casos de escrita rodam em BEGIN...ROLLBACK isolado. Exit 0 = SUCCESS.
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

const ENCANTO        = 'be2efc10-c0c8-410f-bcd4-af3f8a371df3';
const PROD_MARMITA_P = '10000000-0000-4000-8000-000000000001'; // preco real no banco: 15.99

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
  await client.query(`SET LOCAL request.jwt.claims = '${JSON.stringify({ sub, tenant_id: tenantId })}'`);
}
async function comoEncanto() { await setJwt(randomUUID(), ENCANTO); }
const telefone = () => `394${(n++).toString().padStart(8, '0')}`;

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

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // 1) SCHEMA -- as 7 colunas viraram numeric(10,2) (leitura, fora de transacao).
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const cols = [
    ['products', 'preco'], ['products', 'preco_promo'],
    ['order_items', 'price'], ['order_items', 'preco_unitario'],
    ['orders', 'total'], ['orders', 'delivery_fee'], ['orders', 'maquininha_fee'],
  ];
  for (const [table, col] of cols) {
    const r = await client.query(
      `SELECT numeric_precision, numeric_scale FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
      [table, col]
    );
    const row = r.rows[0];
    check(`SCHEMA — ${table}.${col} é numeric(10,2)`, row?.numeric_precision === 10 && row?.numeric_scale === 2, JSON.stringify(row));
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // 2) ARREDONDAMENTO -- valores nao-ambiguos por coluna (evita depender de regra de ponto medio).
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  await withTx(async () => {
    const pid = randomUUID();
    await client.query(
      `INSERT INTO public.products (id, nome, preco, preco_promo, categoria_id, disponivel, store_id)
       VALUES ($1, 'Teste Money Scale', 12.346, 12.341, NULL, true, $2)`,
      [pid, ENCANTO]
    );
    const r = await client.query(`SELECT preco, preco_promo FROM public.products WHERE id = $1`, [pid]);
    check('ARREDONDA — products.preco 12.346 -> 12.35', r.rows[0].preco === '12.35', r.rows[0].preco);
    check('ARREDONDA — products.preco_promo 12.341 -> 12.34', r.rows[0].preco_promo === '12.34', r.rows[0].preco_promo);
  });

  await withTx(async () => {
    const p = telefone();
    await comoEncanto();
    const cust = await client.query(
      `INSERT INTO public.customers (name, phone, store_id) VALUES ('Teste Money Scale', $1, $2) RETURNING id`,
      [p, ENCANTO]
    );
    const ord = await client.query(
      `INSERT INTO public.orders (customer_id, total, status, payment_method, address, store_id, delivery_fee, maquininha_fee)
       VALUES ($1, 12.346, 'recebido', 'dinheiro', 'Rua Teste, 1', $2, 5.341, 1.346) RETURNING id`,
      [cust.rows[0].id, ENCANTO]
    );
    const r = await client.query(`SELECT total, delivery_fee, maquininha_fee FROM public.orders WHERE id = $1`, [ord.rows[0].id]);
    check('ARREDONDA — orders.total 12.346 -> 12.35', r.rows[0].total === '12.35', r.rows[0].total);
    check('ARREDONDA — orders.delivery_fee 5.341 -> 5.34', r.rows[0].delivery_fee === '5.34', r.rows[0].delivery_fee);
    check('ARREDONDA — orders.maquininha_fee 1.346 -> 1.35', r.rows[0].maquininha_fee === '1.35', r.rows[0].maquininha_fee);

    const item = await client.query(
      `INSERT INTO public.order_items (order_id, nome_produto, quantity, price, preco_unitario, store_id)
       VALUES ($1, 'Item Teste', 1, 12.346, 12.341, $2) RETURNING id`,
      [ord.rows[0].id, ENCANTO]
    );
    const ri = await client.query(`SELECT price, preco_unitario FROM public.order_items WHERE id = $1`, [item.rows[0].id]);
    check('ARREDONDA — order_items.price 12.346 -> 12.35', ri.rows[0].price === '12.35', ri.rows[0].price);
    check('ARREDONDA — order_items.preco_unitario 12.341 -> 12.34', ri.rows[0].preco_unitario === '12.34', ri.rows[0].preco_unitario);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // 3) VIEW v_order_reconciliation sobrevive com valores corretos.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  await withTx(async () => {
    const p = telefone();
    await comoEncanto();
    const cust = await client.query(
      `INSERT INTO public.customers (name, phone, store_id) VALUES ('Teste Reconciliation', $1, $2) RETURNING id`,
      [p, ENCANTO]
    );
    const ord = await client.query(
      `INSERT INTO public.orders (customer_id, total, status, payment_method, address, store_id)
       VALUES ($1, 25.50, 'recebido', 'dinheiro', 'Rua Teste, 1', $2) RETURNING id`,
      [cust.rows[0].id, ENCANTO]
    );
    await client.query(
      `INSERT INTO public.order_items (order_id, nome_produto, quantity, price, preco_unitario, store_id) VALUES
       ($1, 'Item A', 2, 10.00, 10.00, $2),
       ($1, 'Item B', 1, 5.50, 5.50, $2)`,
      [ord.rows[0].id, ENCANTO]
    );
    const r = await client.query(`SELECT itens_sum, diff FROM public.v_order_reconciliation WHERE order_id = $1`, [ord.rows[0].id]);
    check('VIEW — v_order_reconciliation.itens_sum = 25.50 (2*10.00 + 5.50)', r.rows[0]?.itens_sum === '25.50', JSON.stringify(r.rows[0]));
    check('VIEW — v_order_reconciliation.diff = 0.00 (total bate com a soma dos itens)', r.rows[0]?.diff === '0.00', JSON.stringify(r.rows[0]));
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // 4) GRANTS/RELOPTION da view -- guarda contra "DROP+CREATE perde ACL".
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const acl = await client.query(`
    SELECT
      has_table_privilege('anon', 'public.v_order_reconciliation', 'SELECT') AS anon_select,
      has_table_privilege('authenticated', 'public.v_order_reconciliation', 'SELECT') AS authenticated_select,
      has_table_privilege('service_role', 'public.v_order_reconciliation', 'SELECT') AS service_role_select
  `);
  check('GRANTS — anon NAO tem SELECT em v_order_reconciliation', acl.rows[0].anon_select === false, JSON.stringify(acl.rows[0]));
  check('GRANTS — authenticated tem SELECT em v_order_reconciliation', acl.rows[0].authenticated_select === true, JSON.stringify(acl.rows[0]));
  check('GRANTS — service_role tem SELECT em v_order_reconciliation', acl.rows[0].service_role_select === true, JSON.stringify(acl.rows[0]));

  const reloptions = await client.query(`
    SELECT reloptions FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = 'v_order_reconciliation'
  `);
  const hasSecurityInvoker = (reloptions.rows[0]?.reloptions || []).some(o => o === 'security_invoker=true');
  check('GRANTS — v_order_reconciliation mantém security_invoker=true', hasSecurityInvoker, JSON.stringify(reloptions.rows[0]));

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // 5) create_order() continua 100% funcional apos a migration de schema.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  await withTx(async () => {
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Money Scale Simples', phone: p },
      { total: 15.99, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: PROD_MARMITA_P, nome_produto: 'Marmita P', quantity: 1, price: 15.99 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) { const item = await getOrderItem(res.order_id); ok = Number(item.price) === 15.99; }
    check('CREATE_ORDER — produto simples: preço correto (15.99), pedido criado', ok, JSON.stringify(res));
  });

  await withTx(async () => {
    const prodPromo = randomUUID();
    await client.query(
      `INSERT INTO public.products (id, nome, preco, preco_promo, categoria_id, disponivel, store_id) VALUES ($1,'Combo Money Scale', 29.90, 24.90, NULL, true, $2)`,
      [prodPromo, ENCANTO]
    );
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Money Scale Promo', phone: p },
      { total: 24.90, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: prodPromo, nome_produto: 'Combo Money Scale', quantity: 1, price: 24.90 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) { const item = await getOrderItem(res.order_id); ok = Number(item.price) === 24.90; }
    check('CREATE_ORDER — produto em promoção: preco_promo=24.90 resolvido corretamente', ok, JSON.stringify(res));
  });

  await withTx(async () => {
    const prodTam = randomUUID();
    await client.query(
      `INSERT INTO public.products (id, nome, preco, tamanhos, categoria_id, disponivel, store_id)
       VALUES ($1,'Acai Money Scale', 17.90, $2::jsonb, NULL, true, $3)`,
      [prodTam, JSON.stringify([{ label: '300 ml', preco: 17.90 }, { label: '500 ml', preco: 26.90 }]), ENCANTO]
    );
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Money Scale Tamanho', phone: p },
      { total: 26.90, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: prodTam, tamanho_label: '500 ml', nome_produto: 'Acai Money Scale', quantity: 1, price: 26.90 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) { const item = await getOrderItem(res.order_id); ok = Number(item.price) === 26.90; }
    check('CREATE_ORDER — produto com tamanho: 500ml=26.90 resolvido corretamente', ok, JSON.stringify(res));
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
