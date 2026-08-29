// REF-PRICE-HARDENING-01 -- valida a restricao de EXECUTE de public._resolve_item_pricing() a
// anon/authenticated (achado registrado durante a validacao de producao da REF-PRICE-SOURCE-01).
// Contra o projeto Supabase DEDICADO a E2E (nunca producao). Cada caso roda em BEGIN...ROLLBACK
// isolado. Exit 0 = SUCCESS.
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
const BAR            = '99999999-9999-4999-8999-999999999998';
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
  const claims = sub ? { sub, ...(tenantId ? { tenant_id: tenantId } : {}) } : {};
  await client.query(`SET LOCAL request.jwt.claims = '${JSON.stringify(claims)}'`);
}
async function comoEncanto() { await setJwt(randomUUID(), ENCANTO); }
const telefone = () => `391${(n++).toString().padStart(8, '0')}`;

function callCreateOrder(customer, order, items, storeId = ENCANTO) {
  return client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
    [JSON.stringify(customer), JSON.stringify(order), JSON.stringify(items), storeId]
  );
}
async function getOrderItem(orderId) {
  const r = await client.query(`SELECT price, preco_unitario, adicionais, product_id, quantity FROM public.order_items WHERE order_id = $1`, [orderId]);
  return r.rows[0];
}
async function getOrder(orderId) {
  const r = await client.query(`SELECT total FROM public.orders WHERE id = $1`, [orderId]);
  return r.rows[0];
}
async function countOrders(phone) {
  const r = await client.query(
    `SELECT count(*) AS n FROM public.orders o JOIN public.customers c ON c.id = o.customer_id WHERE c.phone = $1`, [phone]
  );
  return Number(r.rows[0].n);
}
async function countLoyaltyEvents(phone) {
  const r = await client.query(
    `SELECT count(*) AS n FROM public.loyalty_events le JOIN public.customers c ON c.id = le.customer_id WHERE c.phone = $1`, [phone]
  );
  return Number(r.rows[0].n);
}

async function main() {
  await client.connect();

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ACESSO DIRETO -- confirma que anon/authenticated NAO conseguem mais chamar
  // _resolve_item_pricing() diretamente via RPC (bypass de create_order).
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  await withTx(async () => {
    await client.query(`SET LOCAL ROLE anon`);
    try {
      await client.query(`SELECT public._resolve_item_pricing($1::uuid, $2::uuid, NULL, '[]'::jsonb)`, [ENCANTO, PROD_MARMITA_P]);
      check('ACESSO DIRETO — role anon chamando _resolve_item_pricing() -> bloqueado', false, 'nao lancou excecao');
    } catch (e) {
      check('ACESSO DIRETO — role anon chamando _resolve_item_pricing() -> bloqueado (permission denied)', /permission denied/i.test(e.message), e.message);
    }
  });
  await withTx(async () => {
    await client.query(`SET LOCAL ROLE authenticated`);
    try {
      await client.query(`SELECT public._resolve_item_pricing($1::uuid, $2::uuid, NULL, '[]'::jsonb)`, [ENCANTO, PROD_MARMITA_P]);
      check('ACESSO DIRETO — role authenticated chamando _resolve_item_pricing() -> bloqueado', false, 'nao lancou excecao');
    } catch (e) {
      check('ACESSO DIRETO — role authenticated chamando _resolve_item_pricing() -> bloqueado (permission denied)', /permission denied/i.test(e.message), e.message);
    }
  });
  // controle negativo: service_role continua com EXECUTE (nao faz parte do achado).
  await withTx(async () => {
    await client.query(`SET LOCAL ROLE service_role`);
    const r = await client.query(`SELECT public._resolve_item_pricing($1::uuid, $2::uuid, NULL, '[]'::jsonb) AS r`, [ENCANTO, PROD_MARMITA_P]);
    check('CONTROLE — role service_role continua com EXECUTE (nao revogado)', r.rows[0].r?.preco_unitario !== undefined, JSON.stringify(r.rows[0]));
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // FLUXO LEGITIMO -- create_order() (chamador interno via SECURITY DEFINER) continua 100%
  // operacional para todos os casos comerciais, mesmo sem anon/authenticated terem EXECUTE direto.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  await withTx(async () => {
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Legit Simples', phone: p },
      { total: 15.99, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: PROD_MARMITA_P, nome_produto: 'Marmita P', quantity: 1, price: 15.99 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) { const item = await getOrderItem(res.order_id); ok = Number(item.price) === 15.99; }
    check('FLUXO LEGITIMO — produto simples: preco correto (15.99), pedido criado', ok, JSON.stringify(res));
  });

  await withTx(async () => {
    const prodTam = randomUUID();
    await client.query(
      `INSERT INTO public.products (id, nome, preco, tamanhos, categoria_id, disponivel, store_id)
       VALUES ($1,'Acai Hardening', 17.90, $2::jsonb, NULL, true, $3)`,
      [prodTam, JSON.stringify([{ label: '300 ml', preco: 17.90 }, { label: '500 ml', preco: 26.90 }]), ENCANTO]
    );
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Legit Tamanho', phone: p },
      { total: 26.90, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: prodTam, tamanho_label: '500 ml', nome_produto: 'Acai Hardening', quantity: 1, price: 26.90 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) { const item = await getOrderItem(res.order_id); ok = Number(item.price) === 26.90; }
    check('FLUXO LEGITIMO — produto com tamanho: 500ml=26.90 resolvido corretamente', ok, JSON.stringify(res));
  });

  await withTx(async () => {
    const prodPromo = randomUUID();
    await client.query(
      `INSERT INTO public.products (id, nome, preco, preco_promo, categoria_id, disponivel, store_id) VALUES ($1,'Combo Hardening', 29.90, 24.90, NULL, true, $2)`,
      [prodPromo, ENCANTO]
    );
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Legit Promo', phone: p },
      { total: 24.90, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: prodPromo, nome_produto: 'Combo Hardening', quantity: 1, price: 24.90 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) { const item = await getOrderItem(res.order_id); ok = Number(item.price) === 24.90; }
    check('FLUXO LEGITIMO — produto em promocao: preco_promo=24.90 resolvido corretamente', ok, JSON.stringify(res));
  });

  await withTx(async () => {
    const prodAd = randomUUID();
    const ad1 = randomUUID(), ad2 = randomUUID();
    await client.query(`INSERT INTO public.products (id, nome, preco, adicionais_gratis, categoria_id, disponivel, store_id) VALUES ($1,'Acai Hardening Ad', 20.00, 1, NULL, true, $2)`, [prodAd, ENCANTO]);
    await client.query(`INSERT INTO public.adicionais (id, nome, grupo, tipo, preco, ativo, store_id) VALUES ($1,'Banana Hardening','acai','gratis',0,true,$2)`, [ad1, ENCANTO]);
    await client.query(`INSERT INTO public.adicionais (id, nome, grupo, tipo, preco, ativo, store_id) VALUES ($1,'Nutella Hardening','acai','pago',8.00,true,$2)`, [ad2, ENCANTO]);
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Legit Adicionais', phone: p },
      { total: 28.00, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: prodAd, nome_produto: 'Acai Hardening Ad', quantity: 1, price: 28.00,
         adicionais: [{ id: ad1, nome: 'Banana Hardening' }, { id: ad2, nome: 'Nutella Hardening' }] }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) { const item = await getOrderItem(res.order_id); ok = Number(item.price) === 28.00; } // 20 + 0(gratis) + 8(pago)
    check('FLUXO LEGITIMO — adicionais: franquia gratis + pago resolvidos corretamente (28.00)', ok, JSON.stringify(res));
  });

  await withTx(async () => {
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ('${ENCANTO}','loyalty_enabled','true') ON CONFLICT (store_id, chave) DO UPDATE SET valor='true'`);
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Legit Fidelidade', phone: p },
      { total: 15.99, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: PROD_MARMITA_P, nome_produto: 'Marmita P', quantity: 1, price: 15.99 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) ok = (await countLoyaltyEvents(p)) === 1;
    check('FLUXO LEGITIMO — fidelidade: pedido valido continua contabilizando 1 loyalty_event', ok, JSON.stringify(res));
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // MANIPULACAO -- reexecuta os casos principais da REF-PRICE-SOURCE-01: a protecao financeira
  // permanece intacta apos a restricao de EXECUTE.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  await withTx(async () => {
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Manip Preco', phone: p },
      { total: 0.01, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: PROD_MARMITA_P, nome_produto: 'Marmita P', quantity: 1, price: 0.01, preco_unitario: 0.01 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) { const item = await getOrderItem(res.order_id); ok = Number(item.price) === 15.99; }
    check('MANIPULACAO — preco adulterado (0.01) -> servidor usa 15.99 (do banco)', ok, JSON.stringify(res));
  });

  await withTx(async () => {
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Manip Total', phone: p },
      { total: 0.01, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: PROD_MARMITA_P, nome_produto: 'Marmita P', quantity: 1, price: 15.99 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) { const order = await getOrder(res.order_id); ok = Number(order.total) === 15.99; }
    check('MANIPULACAO — total adulterado (0.01) -> servidor recalcula 15.99', ok, JSON.stringify(res));
  });

  await withTx(async () => {
    await comoEncanto();
    const p = telefone();
    const fakeId = randomUUID();
    const r = await callCreateOrder(
      { name: 'Manip Inexistente', phone: p },
      { total: 15.99, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: fakeId, nome_produto: 'Produto Fantasma', quantity: 1, price: 15.99 }],
    );
    const res = r.rows[0].res;
    check('MANIPULACAO — produto inexistente -> rejeitado (produto invalido)', res.ok === false && res.error === 'produto invalido', JSON.stringify(res));
  });

  await withTx(async () => {
    const prodBar = randomUUID();
    await client.query(`INSERT INTO public.products (id, nome, preco, categoria_id, disponivel, store_id) VALUES ($1,'Produto do Bar Hardening', 50.00, NULL, true, $2)`, [prodBar, BAR]);
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Manip CrossTenant', phone: p },
      { total: 50.00, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: prodBar, nome_produto: 'Produto do Bar Hardening', quantity: 1, price: 50.00 }],
    );
    const res = r.rows[0].res;
    check('MANIPULACAO — produto de outro tenant -> rejeitado (produto invalido)', res.ok === false && res.error === 'produto invalido', JSON.stringify(res));
  });

  await withTx(async () => {
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Manip SemProductId', phone: p },
      { total: 15.99, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ nome_produto: 'Item Sem Produto', quantity: 1, price: 15.99 }],
    );
    const res = r.rows[0].res;
    check('MANIPULACAO — ausencia de product_id -> rejeitado (sem produto valido)', res.ok === false && res.error === 'item "Item Sem Produto" sem produto valido', JSON.stringify(res));
    check('   nenhum pedido persistido', (await countOrders(p)) === 0);
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
