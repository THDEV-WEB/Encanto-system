// REF-MESA-02 · Onda 3 (orders.mesa_session_id) -- valida coerencia com tipo_pedido, isolamento
// cross-tenant, imutabilidade, e que pedidos normais (Entrega/Retirada/Mesa-sem-sessao) continuam
// 100% intocados. Contra o E2E dedicado. SAVEPOINT por caso. Exit 0 = SUCCESS.
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
function check(label, cond, extra = '') { if (cond) { pass++; console.log(`PASS  ${label}`); } else { fail++; console.log(`FAIL  ${label}  ${extra}`); } }
async function withSavepoint(fn) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try { return await fn(); } finally { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); }
}
async function expectError(fn) {
  const sp = `sp_err_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try { await fn(); return { threw: false }; }
  catch (e) { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); return { threw: true, message: e.message }; }
}
async function setRole(role, sub, tenantId) {
  const claims = { ...(sub ? { sub } : {}), ...(tenantId ? { tenant_id: tenantId } : {}) };
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  await client.query(`SET LOCAL ROLE ${role}`);
}
async function resetRole() { await client.query(`RESET ROLE`); await client.query(`SELECT set_config('request.jwt.claims', '{}', true)`); }
async function criarPedido(storeId, prodId, extra) {
  const r = await client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
    [JSON.stringify({ name: 'Cliente Onda3', phone: telefone() }),
     JSON.stringify({ payment_method: 'dinheiro', ...extra }),
     JSON.stringify([{ product_id: prodId, nome_produto: 'Produto Onda3', quantity: 1 }]), storeId]);
  return r.rows[0].res;
}

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-MESA-02 · Onda 3 (orders.mesa_session_id) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const STORE_A = randomUUID(); const STORE_B = randomUUID(); const PROD = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-02 Onda3 A','ativo')`, [STORE_A, `mesa02-onda3-a-${STORE_A}`]);
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-02 Onda3 B','ativo')`, [STORE_B, `mesa02-onda3-b-${STORE_B}`]);
    await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto Onda3',20.00,true,$2)`, [PROD, STORE_A]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true')`, [STORE_A]);

    console.log('── REGRESSAO: create_order() continua intocado (mesa_session_id sempre NULL ainda) ──\n');
    await withSavepoint(async () => {
      await setRole('authenticated', null, STORE_A);
      const rEntrega = await criarPedido(STORE_A, PROD, { address: 'Rua Z, 1' });
      const rMesa = await criarPedido(STORE_A, PROD, { tipo_pedido: 'mesa', mesa_identificador: '01' });
      await resetRole();
      const rows = (await client.query(`SELECT id, tipo_pedido, mesa_session_id FROM public.orders WHERE id IN ($1,$2)`, [rEntrega.order_id, rMesa.order_id])).rows;
      check('R1 create_order continua funcionando igual (entrega e mesa), mesa_session_id sempre NULL',
        rows.every(r => r.mesa_session_id === null) && rows.some(r => r.tipo_pedido === 'entrega') && rows.some(r => r.tipo_pedido === 'mesa'),
        JSON.stringify(rows));
    });

    console.log('\n── CAMADA B: constraints e triggers da coluna nova ──\n');

    let sessaoA;
    await client.query(`INSERT INTO public.mesa_sessions (store_id, origem_abertura) VALUES ($1,'qr_mesa') RETURNING id`, [STORE_A])
      .then(r => { sessaoA = r.rows[0].id; });

    await withSavepoint(async () => {
      const r = await expectError(() => client.query(
        `INSERT INTO public.orders (customer_id, total, status, payment_method, address, store_id, tipo_pedido, mesa_session_id)
         VALUES (NULL, 20, 'recebido', 'dinheiro', 'Rua X', $1, 'entrega', $2)`, [STORE_A, sessaoA]));
      check('B1 mesa_session_id preenchido com tipo_pedido=entrega -> bloqueado (CHECK coerencia)', r.threw, r.message);
    });

    await withSavepoint(async () => {
      const r = await client.query(
        `INSERT INTO public.orders (customer_id, total, status, payment_method, address, store_id, tipo_pedido, mesa_identificador, mesa_session_id)
         VALUES (NULL, 20, 'recebido', 'dinheiro', 'Mesa 01', $1, 'mesa', '01', $2) RETURNING id`, [STORE_A, sessaoA]);
      check('B2 mesa_session_id preenchido com tipo_pedido=mesa E mesma loja -> sucesso', !!r.rows[0].id);
    });

    await withSavepoint(async () => {
      const r = await expectError(() => client.query(
        `INSERT INTO public.orders (customer_id, total, status, payment_method, address, store_id, tipo_pedido, mesa_identificador, mesa_session_id)
         VALUES (NULL, 20, 'recebido', 'dinheiro', 'Mesa 01', $1, 'mesa', '01', $2)`, [STORE_B, sessaoA]));
      check('B3 pedido da loja B apontando pra sessao da loja A -> bloqueado (trigger cross-tenant)', r.threw, r.message);
    });

    await withSavepoint(async () => {
      const ins = await client.query(
        `INSERT INTO public.orders (customer_id, total, status, payment_method, address, store_id, tipo_pedido, mesa_identificador, mesa_session_id)
         VALUES (NULL, 20, 'recebido', 'dinheiro', 'Mesa 01', $1, 'mesa', '01', $2) RETURNING id`, [STORE_A, sessaoA]);
      const outraSessao = (await client.query(`INSERT INTO public.mesa_sessions (store_id, origem_abertura) VALUES ($1,'qr_mesa') RETURNING id`, [STORE_A])).rows[0].id;
      const r = await expectError(() => client.query(`UPDATE public.orders SET mesa_session_id=$1 WHERE id=$2`, [outraSessao, ins.rows[0].id]));
      check('B4 tentar reatribuir mesa_session_id de um pedido pra outra sessao -> bloqueado (imutabilidade)', r.threw, r.message);
      const r2 = await expectError(() => client.query(`UPDATE public.orders SET mesa_session_id=NULL WHERE id=$1`, [ins.rows[0].id]));
      check('B5 tentar limpar mesa_session_id de um pedido -> bloqueado (imutabilidade)', r2.threw, r2.message);
      const r3 = await client.query(`UPDATE public.orders SET status='preparo' WHERE id=$1 RETURNING status`, [ins.rows[0].id]);
      check('B6 mudar STATUS do mesmo pedido continua livre (trigger so protege mesa_session_id)', r3.rows[0].status === 'preparo');
    });

    await withSavepoint(async () => {
      const s = (await client.query(`INSERT INTO public.mesa_sessions (store_id, origem_abertura) VALUES ($1,'qr_mesa') RETURNING id`, [STORE_A])).rows[0].id;
      await client.query(
        `INSERT INTO public.orders (customer_id, total, status, payment_method, address, store_id, tipo_pedido, mesa_identificador, mesa_session_id)
         VALUES (NULL, 20, 'recebido', 'dinheiro', 'Mesa 02', $1, 'mesa', '02', $2)`, [STORE_A, s]);
      const r = await expectError(() => client.query(`DELETE FROM public.mesa_sessions WHERE id=$1`, [s]));
      check('B7 apagar mesa_session referenciada por pedido -> bloqueado (ON DELETE RESTRICT)', r.threw, r.message);
    });

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
