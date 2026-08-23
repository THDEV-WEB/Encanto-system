// REF-PROD-GOLIVE-01 (complemento) -- valida a correcao do vetor secundario de create_order
// (INSERT ... ON CONFLICT DO UPDATE SET name sem checar auth_user_id) contra o banco de PRODUCAO
// real, dentro de BEGIN...ROLLBACK -- nenhuma escrita e persistida. Exit 0 = SUCCESS.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

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
// 2 usuarios reais existentes -- customers.auth_user_id tem FK real p/ auth.users, entao UPDATE
// direto (simulando link_customer_to_auth ja feito) exige ids que existam de verdade.
const REAL_USER_A = '27bd5049-60e5-4980-abe9-3bd7942a6c31';
const REAL_USER_B = 'ce7ece01-266c-42b1-a9db-8051da24d7f5';

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
async function setJwt(sub) {
  const claims = sub ? { sub } : {};
  await client.query(`SET LOCAL request.jwt.claims = '${JSON.stringify(claims)}'`);
}
async function setOrigin(origin) {
  await client.query(`SET LOCAL request.headers = '${JSON.stringify({ origin })}'`);
}
const orderPayload = (name, phone) => ({
  customer: { name, phone },
  order: { total: 10, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
  items: [{ nome_produto: 'Item Teste', quantity: 1, price: 10 }],
});
async function createOrder(name, phone) {
  const p = orderPayload(name, phone);
  const r = await client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
    [JSON.stringify(p.customer), JSON.stringify(p.order), JSON.stringify(p.items), ENCANTO]
  );
  return r.rows[0].res;
}
async function getCustomer(id) {
  const r = await client.query(`SELECT name, phone, auth_user_id FROM public.customers WHERE id = $1`, [id]);
  return r.rows[0];
}

async function main() {
  await client.connect();

  // T1: guest cria customer novo -- comportamento normal preservado.
  await withTx(async () => {
    await setJwt(null);
    await setOrigin('https://encanto.valionsistemas.com.br');
    const res = await createOrder('Fulano Guest', '11988880001');
    let ok = false;
    if (res.ok) {
      const o = await client.query(`SELECT customer_id FROM public.orders WHERE id = $1`, [res.order_id]);
      const c = await getCustomer(o.rows[0].customer_id);
      ok = c.name === 'Fulano Guest' && c.auth_user_id === null;
    }
    check('T1 guest cria customer novo -> nome/orfao normais', res.ok && ok, JSON.stringify(res));
  });

  // T2: guest atualiza o proprio nome (mesmo telefone, sem auth_user_id) -- legado preservado.
  await withTx(async () => {
    await setJwt(null);
    await setOrigin('https://encanto.valionsistemas.com.br');
    const phone = '11988880002';
    await createOrder('Nome Antigo', phone);
    const res2 = await createOrder('Nome Corrigido', phone);
    let ok = false;
    if (res2.ok) {
      const o = await client.query(`SELECT customer_id FROM public.orders WHERE id = $1`, [res2.order_id]);
      const c = await getCustomer(o.rows[0].customer_id);
      ok = c.name === 'Nome Corrigido';
    }
    check('T2 guest atualiza o proprio nome (customer orfao) -> permitido (legado)', res2.ok && ok, JSON.stringify(res2));
  });

  // T3: autenticado A cria customer vinculado a ele proprio via UPDATE customers direto (simula
  // link_customer_to_auth ja feito antes), depois faz um 2o pedido mudando o proprio nome -> permitido.
  await withTx(async () => {
    const userA = REAL_USER_A;
    await setJwt(null);
    await setOrigin('https://encanto.valionsistemas.com.br');
    const phone = '11988880003';
    const res1 = await createOrder('Nome Inicial A', phone);
    const o1 = await client.query(`SELECT customer_id FROM public.orders WHERE id = $1`, [res1.order_id]);
    await client.query(`UPDATE public.customers SET auth_user_id = $1 WHERE id = $2`, [userA, o1.rows[0].customer_id]);

    await setJwt(userA);
    const res2 = await createOrder('Nome Atualizado A', phone);
    let ok = false;
    if (res2.ok) {
      const c = await getCustomer(o1.rows[0].customer_id);
      ok = c.name === 'Nome Atualizado A';
    }
    check('T3 autenticado atualiza o PROPRIO nome (auth_user_id bate) -> permitido', res2.ok && ok, JSON.stringify(res2));
  });

  // T4 (ataque, o vetor a fechar): autenticado B tenta criar pedido no telefone de um customer
  // JA vinculado a A (outra conta) -- nome NAO deve mudar, mas pedido deve ser criado normalmente.
  await withTx(async () => {
    const userA = REAL_USER_A;
    const userB = REAL_USER_B;
    await setJwt(null);
    await setOrigin('https://encanto.valionsistemas.com.br');
    const phone = '11988880004';
    const res1 = await createOrder('Nome Original A', phone);
    const o1 = await client.query(`SELECT customer_id FROM public.orders WHERE id = $1`, [res1.order_id]);
    await client.query(`UPDATE public.customers SET auth_user_id = $1 WHERE id = $2`, [userA, o1.rows[0].customer_id]);

    await setJwt(userB);
    const res2 = await createOrder('Nome Forjado por B', phone);
    let nomeIntacto = false, pedidoCriado = false, mesmoCustomer = false;
    if (res2.ok) {
      pedidoCriado = true;
      const o2 = await client.query(`SELECT customer_id FROM public.orders WHERE id = $1`, [res2.order_id]);
      mesmoCustomer = o2.rows[0].customer_id === o1.rows[0].customer_id;
      const c = await getCustomer(o1.rows[0].customer_id);
      nomeIntacto = c.name === 'Nome Original A';
    }
    check('T4 (ATAQUE) autenticado B tenta sobrescrever nome de customer de A -> nome intacto', nomeIntacto, JSON.stringify({ res2 }));
    check('T4b pedido de B ainda e criado normalmente (nao quebra o fluxo)', pedidoCriado, JSON.stringify(res2));
    check('T4c pedido de B fica vinculado ao MESMO customer_id (telefone e identidade)', mesmoCustomer, '');
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
