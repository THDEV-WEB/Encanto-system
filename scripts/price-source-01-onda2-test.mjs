// REF-PRICE-SOURCE-01 · Onda 2 -- valida que create_order() EXIGE product_id valido em todo item,
// sem excecao (fecha o vetor residual do mockCatalog documentado na Onda 1). Contra o projeto Supabase
// DEDICADO a E2E (nunca producao). Cada caso roda em BEGIN...ROLLBACK isolado. Exit 0 = SUCCESS.
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
const BAR             = '99999999-9999-4999-8999-999999999998';
const PROD_MARMITA_P  = '10000000-0000-4000-8000-000000000001'; // preco real no banco: 15.99

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
  const r = await client.query(`SELECT price, preco_unitario, product_id, quantity FROM public.order_items WHERE order_id = $1`, [orderId]);
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

  // ── 1. product_id valido -- aceito, preco autoritativo do banco. ───────────────────────────────
  await withTx(async () => {
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste 1', phone: p },
      { total: 15.99, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: PROD_MARMITA_P, nome_produto: 'Marmita P', quantity: 1, price: 15.99 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) { const item = await getOrderItem(res.order_id); ok = Number(item.price) === 15.99; }
    check('1. product_id valido -> aceito, preco autoritativo (15.99)', ok, JSON.stringify(res));
  });

  // ── 2. product_id ausente (chave nem enviada) -- rejeitado. ─────────────────────────────────────
  await withTx(async () => {
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste 2', phone: p },
      { total: 15.99, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ nome_produto: 'Item Sem Chave', quantity: 1, price: 15.99 }],
    );
    const res = r.rows[0].res;
    check('2. product_id ausente -> rejeitado (sem produto valido)', res.ok === false && res.error === 'item "Item Sem Chave" sem produto valido', JSON.stringify(res));
    check('   nenhum pedido persistido para este telefone', (await countOrders(p)) === 0);
  });

  // ── 3. product_id = null explicito -- rejeitado. ────────────────────────────────────────────────
  await withTx(async () => {
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste 3', phone: p },
      { total: 15.99, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: null, nome_produto: 'Item Null', quantity: 1, price: 15.99 }],
    );
    const res = r.rows[0].res;
    check('3. product_id=null -> rejeitado', res.ok === false && res.error === 'item "Item Null" sem produto valido', JSON.stringify(res));
  });

  // ── 4. product_id invalido (nao-uuid) -- rejeitado (cast falha -> capturado pelo exception geral). ──
  await withTx(async () => {
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste 4', phone: p },
      { total: 15.99, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: 'nao-e-um-uuid', nome_produto: 'Item Formato Invalido', quantity: 1, price: 15.99 }],
    );
    const res = r.rows[0].res;
    check('4. product_id em formato invalido (nao-uuid) -> rejeitado', res.ok === false, JSON.stringify(res));
  });

  // ── 5. produto inexistente (uuid valido, sem linha correspondente) -- rejeitado. ────────────────
  await withTx(async () => {
    await comoEncanto();
    const p = telefone();
    const fakeId = randomUUID();
    const r = await callCreateOrder(
      { name: 'Teste 5', phone: p },
      { total: 15.99, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: fakeId, nome_produto: 'Produto Fantasma', quantity: 1, price: 15.99 }],
    );
    const res = r.rows[0].res;
    check('5. produto inexistente -> rejeitado (produto invalido)', res.ok === false && res.error === 'produto invalido', JSON.stringify(res));
  });

  // ── 6. produto de outro tenant (BAR) usado num pedido da ENCANTO -- rejeitado. ──────────────────
  await withTx(async () => {
    const prodBar = randomUUID();
    await client.query(`INSERT INTO public.products (id, nome, preco, categoria_id, disponivel, store_id) VALUES ($1,'Produto do Bar Onda2', 50.00, NULL, true, $2)`, [prodBar, BAR]);
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste 6', phone: p },
      { total: 50.00, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: prodBar, nome_produto: 'Produto do Bar Onda2', quantity: 1, price: 50.00 }],
    );
    const res = r.rows[0].res;
    check('6. produto de OUTRO tenant -> rejeitado (produto invalido)', res.ok === false && res.error === 'produto invalido', JSON.stringify(res));
  });

  // ── 7. preco adulterado, COM product_id valido -- servidor ignora e usa o preco do banco. ───────
  await withTx(async () => {
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste 7', phone: p },
      { total: 0.01, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: PROD_MARMITA_P, nome_produto: 'Marmita P', quantity: 1, price: 0.01, preco_unitario: 0.01 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) { const item = await getOrderItem(res.order_id); ok = Number(item.price) === 15.99; }
    check('7. preco adulterado (0.01) com product_id valido -> servidor usa 15.99 (do banco)', ok, JSON.stringify(res));
  });

  // ── 8. total adulterado, COM product_id valido -- servidor recalcula. ──────────────────────────
  await withTx(async () => {
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste 8', phone: p },
      { total: 0.01, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: PROD_MARMITA_P, nome_produto: 'Marmita P', quantity: 1, price: 15.99 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) { const order = await getOrder(res.order_id); ok = Number(order.total) === 15.99; }
    check('8. total adulterado (0.01) com product_id valido -> servidor recalcula 15.99', ok, JSON.stringify(res));
  });

  // ── 9. ausencia de product_id + preco adulterado, combinados -- rejeitado (pela ausencia; o preco
  //      nem chega a importar, mas confirma que a combinacao nao abre nenhuma brecha nova). ────────
  await withTx(async () => {
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste 9', phone: p },
      { total: 0.01, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ nome_produto: 'Item Combinado 9', quantity: 1, price: 0.01, preco_unitario: 0.01 }],
    );
    const res = r.rows[0].res;
    check('9. product_id ausente + price=0.01 -> rejeitado (mesma mensagem, sem brecha)', res.ok === false && res.error === 'item "Item Combinado 9" sem produto valido', JSON.stringify(res));
    check('   nenhum pedido persistido', (await countOrders(p)) === 0);
    check('   nenhum evento de fidelidade gerado', (await countLoyaltyEvents(p)) === 0);
  });

  // ── 10. ausencia de product_id + total adulterado, combinados -- rejeitado. ────────────────────
  await withTx(async () => {
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste 10', phone: p },
      { total: 999999.99, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ nome_produto: 'Item Combinado 10', quantity: 1, price: 5.00 }],
    );
    const res = r.rows[0].res;
    check('10. product_id ausente + total=999999.99 -> rejeitado, sem persistir nenhum valor', res.ok === false && res.error === 'item "Item Combinado 10" sem produto valido', JSON.stringify(res));
    check('    nenhum pedido persistido', (await countOrders(p)) === 0);
  });

  // ── Relatórios/fidelidade: pedido VALIDO continua contabilizando normalmente (fidelidade nao foi
  //    alterada por esta onda -- confirma que a rejeicao dos casos acima nao tem efeito colateral no
  //    caminho feliz). ─────────────────────────────────────────────────────────────────────────────
  await withTx(async () => {
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ('${ENCANTO}','loyalty_enabled','true') ON CONFLICT (store_id, chave) DO UPDATE SET valor='true'`);
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste Fidelidade', phone: p },
      { total: 15.99, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: PROD_MARMITA_P, nome_produto: 'Marmita P', quantity: 1, price: 15.99 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) ok = (await countLoyaltyEvents(p)) === 1;
    check('Fidelidade — pedido VALIDO (product_id ok) contabiliza 1 loyalty_event normalmente', ok, JSON.stringify(res));
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
