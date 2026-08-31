// REF-MESA-01 · Onda 4 -- valida a checagem de mesa_canal_admin + is_admin_of dentro de
// create_order() contra o projeto Supabase DEDICADO a E2E (nunca producao). Mesmo padrao de
// scripts/mesa-01-onda3-canal-qr-test.mjs: conexao pg direta (db.e2e.env), cada caso em SAVEPOINT
// dentro de uma unica transacao externa, ROLLBACK no final -- mutacao liquida = 0. Exit 0 = SUCCESS.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ENV_PATH = 'C:/Users/00thi/.encanto/db.e2e.env';

function loadConn() {
  const txt = readFileSync(ENV_PATH, 'utf8');
  const map = {};
  for (const line of txt.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i === -1) continue;
    map[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  if (!map.PGPASSWORD) { console.error('ERRO: PGPASSWORD vazio'); process.exit(2); }
  return { host: map.PGHOST, port: Number(map.PGPORT || 5432), user: map.PGUSER, password: map.PGPASSWORD, database: map.PGDATABASE || 'postgres' };
}

const client = new pg.Client({ ...loadConn(), ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

let pass = 0, fail = 0, spCounter = 0, n = 0;
const telefone = () => `397${(n++).toString().padStart(8, '0')}`;

function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  ${extra}`); }
}

async function withSavepoint(fn) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try { return await fn(); }
  finally { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); }
}

async function setRole(role, sub, tenantId) {
  const claims = { ...(sub ? { sub } : {}), ...(tenantId ? { tenant_id: tenantId } : {}) };
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  await client.query(`SELECT set_config('request.headers', '{}', true)`);
  await client.query(`SET LOCAL ROLE ${role}`);
}
async function setGuestOrigin(slug) {
  await client.query(`SELECT set_config('request.jwt.claims', '{}', true)`);
  await client.query(`SELECT set_config('request.headers', $1, true)`, [JSON.stringify({ origin: `http://${slug}.localhost:5183` })]);
  await client.query(`SET LOCAL ROLE anon`);
}
async function resetRole() {
  await client.query(`RESET ROLE`);
  await client.query(`SELECT set_config('request.jwt.claims', '{}', true)`);
  await client.query(`SELECT set_config('request.headers', '{}', true)`);
}

function callCreateOrder(customer, order, items, storeId, requestId = null) {
  return client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, $4::uuid, $5::uuid) AS res`,
    [JSON.stringify(customer), JSON.stringify(order), JSON.stringify(items), requestId, storeId]
  );
}
async function getOrder(orderId) {
  const r = await client.query(`SELECT tipo_pedido, origem_pedido, mesa_identificador FROM public.orders WHERE id = $1`, [orderId]);
  return r.rows[0];
}

async function main() {
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, current_database() AS db")).rows[0];
  console.log(`Conectado como ${meta.who} em ${meta.db} (projeto E2E dedicado, nunca producao)\n`);
  console.log('==========================================================================');
  console.log(' REF-MESA-01 · Onda 4 (canal Admin/garcom) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 2')).rows;
    if (authUsers.length < 2) { console.error('Precisa de >=2 usuarios em auth.users no E2E (fixtures).'); process.exit(2); }
    const [ADMIN_UID, OUTSIDER_UID] = authUsers.map(r => r.id);

    const STORE_A = randomUUID();     // canal_admin habilitado, ADMIN_UID e admin dela
    const STORE_B = randomUUID();     // canal_admin DESLIGADO (mesa_habilitada=true), ADMIN_UID e' admin dela tambem (testa canal antes de papel)
    const STORE_C = randomUUID();     // mesa+canal_admin habilitados, mas ADMIN_UID NAO e' admin dela (cross-tenant)
    const PROD_A = randomUUID(); const PROD_B = randomUUID(); const PROD_C = randomUUID();
    const slugA = `mesa01-adma-${STORE_A}`;

    async function setupLoja(storeId, slug, prodId) {
      await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-01 Admin','ativo')`, [storeId, slug]);
      await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto MESA-01 Admin',20.00,true,$2)`, [prodId, storeId]);
    }
    await setupLoja(STORE_A, slugA, PROD_A);
    await setupLoja(STORE_B, `mesa01-admb-${STORE_B}`, PROD_B);
    await setupLoja(STORE_C, `mesa01-admc-${STORE_C}`, PROD_C);
    // Fora de qualquer savepoint de teste (precisa sobreviver aos ROLLBACK TO SAVEPOINT individuais).
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true'),($1,'mesa_canal_admin','true')`, [STORE_A]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true'),($1,'mesa_canal_admin','false')`, [STORE_B]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true'),($1,'mesa_canal_admin','true')`, [STORE_C]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE_A]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE_B]);
    // ADMIN_UID NAO e admin de STORE_C de proposito (cross-tenant, ver B3).
    const item = (prodId) => [{ product_id: prodId, nome_produto: 'Produto MESA-01 Admin', quantity: 1 }];

    // B1 -- admin da propria loja, canal ligado: cria normalmente, origem_pedido='admin_garcom'.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const r = await callCreateOrder(
        { name: 'Cliente da Mesa (garcom)', phone: telefone() },
        { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '21', origem_pedido: 'admin_garcom', total: 20 },
        item(PROD_A), STORE_A);
      const res = r.rows[0].res;
      check('B1a admin da propria loja, canal_admin=true -> ok', res.ok === true, JSON.stringify(res));
      if (res.ok) {
        await resetRole();
        const row = await getOrder(res.order_id);
        check('B1b order gravado com origem_pedido=admin_garcom, tipo_pedido=mesa',
          row.origem_pedido === 'admin_garcom' && row.tipo_pedido === 'mesa' && row.mesa_identificador === '21', JSON.stringify(row));
      }
    });

    // B2 -- mesma loja A, mas canal_admin=false: mesmo sendo admin de verdade, bloqueado (checagem
    // de canal vem ANTES da checagem de papel).
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_B);
      const r = await callCreateOrder(
        { name: 'Cliente Bloqueado Canal', phone: telefone() },
        { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '22', origem_pedido: 'admin_garcom', total: 20 },
        item(PROD_B), STORE_B);
      const res = r.rows[0].res;
      check('B2 admin de verdade, mas canal_admin=false -> ok:false, canal indisponivel',
        res.ok === false && res.error === 'canal indisponivel para esta loja', JSON.stringify(res));
    });

    // B3 -- cross-tenant: authenticated (ADMIN_UID) tem tenant_id=STORE_A no JWT, mas tenta criar em
    // STORE_C (onde nem e admin) -- bloqueado MUITO antes (REF-ORDER-TENANT-01, "loja invalida"),
    // nunca chega na checagem de canal/papel desta Onda.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const r = await callCreateOrder(
        { name: 'Cross Tenant Admin', phone: telefone() },
        { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '23', origem_pedido: 'admin_garcom', total: 20 },
        item(PROD_C), STORE_C);
      const res = r.rows[0].res;
      check('B3 cross-tenant (tenant_id da loja A, tentando criar na loja C) -> bloqueado por loja invalida (REF-ORDER-TENANT-01)',
        res.ok === false && res.error === 'loja invalida', JSON.stringify(res));
    });

    // B4 -- authenticated SEM nenhum vinculo de admin (OUTSIDER_UID), tentando a loja C (canal ligado,
    // mas ele nao e admin dela) -- bloqueado por papel, nao por canal.
    await withSavepoint(async () => {
      await setRole('authenticated', OUTSIDER_UID, STORE_C);
      const r = await callCreateOrder(
        { name: 'Outsider Tentando Garcom', phone: telefone() },
        { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '24', origem_pedido: 'admin_garcom', total: 20 },
        item(PROD_C), STORE_C);
      const res = r.rows[0].res;
      check('B4 authenticated sem vinculo de admin (loja com canal ligado) -> ok:false, sem permissao',
        res.ok === false && res.error === 'sem permissao', JSON.stringify(res));
    });

    // B5 -- bypass anon: cliente anonimo (guest via Origin real) tentando origem_pedido=admin_garcom
    // na loja C (canal ligado) -- bloqueado por papel (anon nunca e admin de loja nenhuma).
    await withSavepoint(async () => {
      await setGuestOrigin(`mesa01-admc-${STORE_C}`);
      const r = await callCreateOrder(
        { name: 'Bypass Anon Garcom', phone: telefone() },
        { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '25', origem_pedido: 'admin_garcom', total: 20 },
        item(PROD_C), STORE_C);
      const res = r.rows[0].res;
      check('B5 bypass anon (guest, canal ligado) -> ok:false, sem permissao',
        res.ok === false && res.error === 'sem permissao', JSON.stringify(res));
    });

    // B6 -- combinacao sem sentido: origem_pedido='admin_garcom' com tipo_pedido='entrega' (mesmo
    // sendo admin de verdade) -> rejeitado antes de chegar na checagem de papel.
    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      const r = await callCreateOrder(
        { name: 'Combinacao Invalida Garcom', phone: telefone() },
        { payment_method: 'dinheiro', origem_pedido: 'admin_garcom', address: 'x', total: 20 },
        item(PROD_A), STORE_A);
      const res = r.rows[0].res;
      check('B6 origem_pedido=admin_garcom com tipo_pedido=entrega -> ok:false, canal indisponivel',
        res.ok === false && res.error === 'canal indisponivel para esta loja', JSON.stringify(res));
    });

    // B7 -- regressao: pedido de mesa via storefront normal (sem origem_pedido) continua ok na loja A
    // mesmo com canal_admin=true -- confirma que a checagem nova nao interfere no caminho da Onda 2.
    await withSavepoint(async () => {
      await setGuestOrigin(slugA);
      const r = await callCreateOrder(
        { name: 'Cliente Mesa Normal Onda2', phone: telefone() },
        { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '26', total: 20 },
        item(PROD_A), STORE_A);
      const res = r.rows[0].res;
      check('B7 mesa via storefront normal continua ok (regressao Onda 2, canal_admin nao interfere)',
        res.ok === true, JSON.stringify(res));
    });

    await resetRole();
  } finally {
    await client.query('ROLLBACK');
  }

  console.log('\n==========================================================================');
  console.log(` RESULTADO: ${pass} PASS / ${fail} FAIL`);
  console.log('==========================================================================');
  await client.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('ERRO FATAL', e); process.exit(2); });
