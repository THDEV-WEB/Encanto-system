// REF-MESA-02 · Onda 19 (nome/telefone opcional no canal admin_garcom) -- E2E dedicado.
// create_order(): so o canal admin_garcom (garcom lancando manualmente pela mesa) aceita
// nome/telefone ausentes -- storefront e qr_mesa continuam exigindo os dois, sem mudanca nenhuma.
// Sem nome: vira 'Mesa <identificador>'. Sem telefone: vira um placeholder UNICO por pedido (nunca
// reaproveitado -- cada pedido sem telefone precisa virar seu PROPRIO customer_id, nunca misturar
// com outro via o upsert por (store_id,phone)). SAVEPOINT por caso.
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
async function setRole(role, sub, tenantId) {
  const claims = { ...(sub ? { sub } : {}), ...(tenantId ? { tenant_id: tenantId } : {}) };
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  await client.query(`SET LOCAL ROLE ${role}`);
}
async function resetRole() { await client.query(`RESET ROLE`); await client.query(`SELECT set_config('request.jwt.claims', '{}', true)`); }

async function criarPedido(storeId, produto, customer, order) {
  const r = await client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
    [JSON.stringify(customer), JSON.stringify(order), JSON.stringify([{ product_id: produto, nome_produto: 'Produto Onda19', quantity: 1 }]), storeId]);
  return r.rows[0].res;
}
async function customerDoPedido(orderId) {
  return (await client.query(`SELECT c.id, c.name, c.phone FROM public.orders o JOIN public.customers c ON c.id = o.customer_id WHERE o.id = $1`, [orderId])).rows[0];
}

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-MESA-02 · Onda 19 (nome/telefone opcional, canal admin_garcom) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 1')).rows;
    if (authUsers.length < 1) { console.error('Precisa de >=1 usuario em auth.users no E2E.'); process.exit(2); }
    const ADMIN_UID = authUsers[0].id;

    const STORE = randomUUID();
    const PROD = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-02 Onda19','ativo')`, [STORE, `mesa02-onda19-${STORE}`]);
    await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto Onda19',10.00,true,$2)`, [PROD, STORE]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true'),($1,'mesa_canal_admin','true'),($1,'mesa_canal_qr','true')`, [STORE]);
    const mesa = (await client.query(`INSERT INTO public.mesas (store_id, identificador) VALUES ($1,'12') RETURNING qr_token`, [STORE])).rows[0];

    // ── 1: admin_garcom sem nome nem telefone -> aceita, nome vira "Mesa 12" ────────────────
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE);
      const r = await criarPedido(STORE, PROD, {}, { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '12', origem_pedido: 'admin_garcom' });
      check('1a pedido criado mesmo sem customer nenhum', r.ok === true, JSON.stringify(r));
      const c = await customerDoPedido(r.order_id);
      check('1b nome cai pra "Mesa 12"', c.name === 'Mesa 12', JSON.stringify(c));
      check('1c telefone vira placeholder "sem-telefone-*"', c.phone.startsWith('sem-telefone-'), JSON.stringify(c));
      await resetRole();
    });

    // ── 2: admin_garcom so' com nome (sem telefone) -> nome respeitado, telefone vira placeholder ──
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE);
      const r = await criarPedido(STORE, PROD, { name: 'Joao da Mesa' }, { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '12', origem_pedido: 'admin_garcom' });
      const c = await customerDoPedido(r.order_id);
      check('2 nome informado e respeitado, telefone vira placeholder', c.name === 'Joao da Mesa' && c.phone.startsWith('sem-telefone-'), JSON.stringify(c));
      await resetRole();
    });

    // ── 3: 2 pedidos admin_garcom SEM telefone, mesas diferentes -> NUNCA misturam identidade ──
    await withSavepoint(async () => {
      const mesa13 = (await client.query(`INSERT INTO public.mesas (store_id, identificador) VALUES ($1,'13') RETURNING identificador`, [STORE])).rows[0];
      await setRole('authenticated', ADMIN_UID, STORE);
      const r1 = await criarPedido(STORE, PROD, {}, { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '12', origem_pedido: 'admin_garcom' });
      const r2 = await criarPedido(STORE, PROD, {}, { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: mesa13.identificador, origem_pedido: 'admin_garcom' });
      const c1 = await customerDoPedido(r1.order_id);
      const c2 = await customerDoPedido(r2.order_id);
      check('3 2 pedidos anonimos diferentes NUNCA compartilham customer_id', c1.id !== c2.id, JSON.stringify({ c1, c2 }));
      check('3b cada um com o nome da PROPRIA mesa (nao "herdou" do outro)', c1.name === 'Mesa 12' && c2.name === 'Mesa 13', JSON.stringify({ c1, c2 }));
      await resetRole();
    });

    // ── 4: admin_garcom com nome+telefone reais -> comportamento antigo intocado (dedup por phone) ──
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE);
      const r1 = await criarPedido(STORE, PROD, { name: 'Maria Real', phone: '38999990001' }, { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '12', origem_pedido: 'admin_garcom' });
      const r2 = await criarPedido(STORE, PROD, { name: 'Maria Real', phone: '38999990001' }, { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '12', origem_pedido: 'admin_garcom' });
      const c1 = await customerDoPedido(r1.order_id);
      const c2 = await customerDoPedido(r2.order_id);
      check('4 telefone real continua deduplicando pro MESMO customer_id (regressao)', c1.id === c2.id && c1.phone === '38999990001', JSON.stringify({ c1, c2 }));
      await resetRole();
    });

    // ── 5: storefront (entrega comum) sem nome/telefone -> continua RECUSADO, sem mudanca ──────
    // (tenant_id via JWT so' pra tornar a resolucao de loja deterministica no teste -- storefront
    // real de guest resolve por Origin, ja coberto por REF-ORDER-TENANT-01; o que importa aqui e'
    // que o canal NAO e' admin_garcom, entao nome/telefone continuam obrigatorios.)
    await withSavepoint(async () => {
      await setRole('anon', null, STORE);
      const r = await criarPedido(STORE, PROD, {}, { payment_method: 'dinheiro', tipo_pedido: 'entrega', address: 'Rua X, 1' });
      check('5 storefront sem customer continua recusado (name obrigatorio)', r.ok === false && /name do cliente/.test(r.error), JSON.stringify(r));
      await resetRole();
    });

    // ── 6: qr_mesa (autoatendimento) sem nome/telefone -> continua RECUSADO, sem mudanca ───────
    await withSavepoint(async () => {
      await setRole('anon', null, STORE);
      const r = await criarPedido(STORE, PROD, {}, { payment_method: 'dinheiro', tipo_pedido: 'mesa', origem_pedido: 'qr_mesa', mesa_qr_token: mesa.qr_token });
      check('6 qr_mesa sem customer continua recusado (name obrigatorio)', r.ok === false && /name do cliente/.test(r.error), JSON.stringify(r));
      await resetRole();
    });

    // ── 7: qr_mesa com nome mas sem telefone -> continua RECUSADO (telefone ainda obrigatorio) ──
    await withSavepoint(async () => {
      await setRole('anon', null, STORE);
      const r = await criarPedido(STORE, PROD, { name: 'Cliente QR' }, { payment_method: 'dinheiro', tipo_pedido: 'mesa', origem_pedido: 'qr_mesa', mesa_qr_token: mesa.qr_token });
      check('7 qr_mesa sem telefone continua recusado (telefone obrigatorio)', r.ok === false && /telefone do cliente/.test(r.error), JSON.stringify(r));
      await resetRole();
    });

    console.log(`\n${'='.repeat(74)}\nTOTAL: ${pass} passaram, ${fail} falharam\n${'='.repeat(74)}`);
    process.exitCode = fail > 0 ? 1 : 0;
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
