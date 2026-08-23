// REF-PROD-GOLIVE-01 -- valida a correcao do MT-01/MT-02 (create_order/link_customer_to_auth
// confiavam cegamente em p_store_id quando autenticado sem tenant_id) contra o banco de PRODUCAO
// real, dentro de BEGIN...ROLLBACK -- nenhuma escrita e persistida (zero mutacao liquida). Testa a
// FUNCAO em isolamento simulando request.jwt.claims/request.headers via SET LOCAL, mesmo padrao ja
// usado por scripts/auth-tenant-onda3-hook-test.mjs. Exit 0 = SUCCESS.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ENV_PATH = 'C:/Users/00thi/.encanto/db.env';

const envGet = (txt, k) => { const m = txt.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
function loadConn() {
  const txt = readFileSync(ENV_PATH, 'utf8');
  const password = envGet(txt, 'PGPASSWORD');
  if (!password) { console.error('ERRO: PGPASSWORD vazio'); process.exit(2); }
  return { host: envGet(txt, 'PGHOST'), port: Number(envGet(txt, 'PGPORT') || 5432), user: envGet(txt, 'PGUSER'), password, database: envGet(txt, 'PGDATABASE') || 'postgres' };
}

const ENCANTO = '8604324d-0529-443d-aa79-4337057bfa01';
const BAR     = '776a01c8-f836-417a-a957-a0e1109f90a2';
// link_customer_to_auth grava auth_user_id (FK real p/ auth.users) -- precisa de um usuario
// existente de verdade. create_order nao grava essa coluna, entao pode usar randomUUID() solto.
const REAL_AUTH_USER = '27bd5049-60e5-4980-abe9-3bd7942a6c31';

const client = new pg.Client({ ...loadConn(), ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

let pass = 0, fail = 0;
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
async function setOrigin(origin) {
  const headers = origin ? { origin } : {};
  await client.query(`SET LOCAL request.headers = '${JSON.stringify(headers)}'`);
}

const orderPayload = (phone) => ({
  customer: { name: 'Teste PROD-GOLIVE-01', phone },
  order: { total: 10, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
  items: [{ nome_produto: 'Item Teste', quantity: 1, price: 10 }],
});

async function main() {
  await client.connect();

  // ── resolve_store_from_origin() ──────────────────────────────────────────────
  await withTx(async () => {
    await setOrigin('https://localhost');
    const r = await client.query(`SELECT public.resolve_store_from_origin() AS id`);
    check('T1 Origin https://localhost -> ENCANTO (app nativo)', r.rows[0].id === ENCANTO, `got ${r.rows[0].id}`);
  });
  await withTx(async () => {
    await setOrigin('https://encanto.valionsistemas.com.br');
    const r = await client.query(`SELECT public.resolve_store_from_origin() AS id`);
    check('T2 Origin encanto.valionsistemas.com.br -> ENCANTO (regressao)', r.rows[0].id === ENCANTO, `got ${r.rows[0].id}`);
  });
  await withTx(async () => {
    await setOrigin('https://aquariosbar.lojas.valionsistemas.com.br');
    const r = await client.query(`SELECT public.resolve_store_from_origin() AS id`);
    check('T3 Origin aquariosbar.lojas... -> BAR (regressao)', r.rows[0].id === BAR, `got ${r.rows[0].id}`);
  });
  await withTx(async () => {
    await setOrigin('https://dominio-desconhecido-xyz.com');
    const r = await client.query(`SELECT public.resolve_store_from_origin() AS id`);
    check('T4 Origin desconhecido -> NULL (fail-closed, regressao)', r.rows[0].id === null, `got ${r.rows[0].id}`);
  });
  await withTx(async () => {
    await setOrigin(null);
    const r = await client.query(`SELECT public.resolve_store_from_origin() AS id`);
    check('T5 Origin ausente -> NULL (regressao)', r.rows[0].id === null, `got ${r.rows[0].id}`);
  });

  // ── create_order() ───────────────────────────────────────────────────────────
  await withTx(async () => {
    // MT-01: autenticado (conta nova, SEM tenant_id) tenta forjar p_store_id=BAR, Origin real e Encanto.
    await setJwt(randomUUID(), null);
    await setOrigin('https://encanto.valionsistemas.com.br');
    const p = orderPayload('11900000001');
    const r = await client.query(
      `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
      [JSON.stringify(p.customer), JSON.stringify(p.order), JSON.stringify(p.items), BAR]
    );
    const res = r.rows[0].res;
    let storeOk = false;
    if (res.ok) {
      const o = await client.query(`SELECT store_id FROM public.orders WHERE id = $1`, [res.order_id]);
      storeOk = o.rows[0]?.store_id === ENCANTO;
    }
    check('T6 MT-01: autenticado sem tenant, p_store_id=BAR forjado, Origin=Encanto -> pedido vai pra ENCANTO', res.ok && storeOk, JSON.stringify(res));
  });

  await withTx(async () => {
    // Regressao: autenticado COM tenant_id=ENCANTO, p_store_id=ENCANTO (legitimo).
    await setJwt(randomUUID(), ENCANTO);
    await setOrigin('https://encanto.valionsistemas.com.br');
    const p = orderPayload('11900000002');
    const r = await client.query(
      `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
      [JSON.stringify(p.customer), JSON.stringify(p.order), JSON.stringify(p.items), ENCANTO]
    );
    check('T7 regressao: autenticado com tenant=ENCANTO, p_store_id=ENCANTO -> ok', r.rows[0].res.ok === true, JSON.stringify(r.rows[0].res));
  });

  await withTx(async () => {
    // Regressao: autenticado COM tenant_id=ENCANTO tenta p_store_id=BAR -> ja era negado antes, continua.
    await setJwt(randomUUID(), ENCANTO);
    await setOrigin('https://encanto.valionsistemas.com.br');
    const p = orderPayload('11900000003');
    const r = await client.query(
      `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
      [JSON.stringify(p.customer), JSON.stringify(p.order), JSON.stringify(p.items), BAR]
    );
    const res = r.rows[0].res;
    check('T8 regressao: tenant=ENCANTO, p_store_id=BAR -> DENY loja invalida', res.ok === false && res.error === 'loja invalida', JSON.stringify(res));
  });

  await withTx(async () => {
    // Regressao: guest (sem sub), Origin=Encanto -> deve funcionar normal.
    await setJwt(null, null);
    await setOrigin('https://encanto.valionsistemas.com.br');
    const p = orderPayload('11900000004');
    const r = await client.query(
      `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
      [JSON.stringify(p.customer), JSON.stringify(p.order), JSON.stringify(p.items), ENCANTO]
    );
    check('T9 regressao: guest + Origin=Encanto -> ok', r.rows[0].res.ok === true, JSON.stringify(r.rows[0].res));
  });

  await withTx(async () => {
    // App nativo: autenticado sem tenant, Origin=https://localhost, tenta p_store_id=BAR -> deve ir pra ENCANTO.
    await setJwt(randomUUID(), null);
    await setOrigin('https://localhost');
    const p = orderPayload('11900000005');
    const r = await client.query(
      `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
      [JSON.stringify(p.customer), JSON.stringify(p.order), JSON.stringify(p.items), BAR]
    );
    const res = r.rows[0].res;
    let storeOk = false;
    if (res.ok) {
      const o = await client.query(`SELECT store_id FROM public.orders WHERE id = $1`, [res.order_id]);
      storeOk = o.rows[0]?.store_id === ENCANTO;
    }
    check('T10 app nativo (Origin=localhost) + p_store_id=BAR forjado -> pedido vai pra ENCANTO', res.ok && storeOk, JSON.stringify(res));
  });

  // ── link_customer_to_auth() ──────────────────────────────────────────────────
  await withTx(async () => {
    await setJwt(REAL_AUTH_USER, null);
    await setOrigin('https://encanto.valionsistemas.com.br');
    const r = await client.query(`SELECT public.link_customer_to_auth('11900000006', NULL, 'Teste', $1::uuid) AS res`, [BAR]);
    const res = r.rows[0].res;
    let storeOk = false;
    if (res.ok) {
      const c = await client.query(`SELECT store_id FROM public.customers WHERE id = $1`, [res.customer_id]);
      storeOk = c.rows[0]?.store_id === ENCANTO;
    }
    check('T11 MT-02: autenticado sem tenant, p_store_id=BAR forjado, Origin=Encanto -> vincula na ENCANTO', res.ok && storeOk, JSON.stringify(res));
  });

  await withTx(async () => {
    await setJwt(randomUUID(), ENCANTO);
    await setOrigin('https://encanto.valionsistemas.com.br');
    const r = await client.query(`SELECT public.link_customer_to_auth('11900000007', NULL, 'Teste', $1::uuid) AS res`, [BAR]);
    const res = r.rows[0].res;
    check('T12 regressao: tenant=ENCANTO, p_store_id=BAR -> DENY loja invalida', res.ok === false && res.error === 'loja invalida', JSON.stringify(res));
  });

  await withTx(async () => {
    await setJwt(REAL_AUTH_USER, null);
    await setOrigin('https://localhost');
    const r = await client.query(`SELECT public.link_customer_to_auth('11900000008', NULL, 'Teste', $1::uuid) AS res`, [BAR]);
    const res = r.rows[0].res;
    let storeOk = false;
    if (res.ok) {
      const c = await client.query(`SELECT store_id FROM public.customers WHERE id = $1`, [res.customer_id]);
      storeOk = c.rows[0]?.store_id === ENCANTO;
    }
    check('T13 app nativo (Origin=localhost) + p_store_id=BAR forjado -> vincula na ENCANTO', res.ok && storeOk, JSON.stringify(res));
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
