// REF-MESA-01 · Onda 5 -- valida que admin_orders_search() devolve tipo_pedido/origem_pedido/
// mesa_identificador (sem mudar autorizacao/busca/paginacao) contra o projeto Supabase DEDICADO a
// E2E (nunca producao). Mesmo padrao das ondas anteriores: SAVEPOINT por caso, ROLLBACK no final.
// Exit 0 = SUCCESS.
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
const telefone = () => `396${(n++).toString().padStart(8, '0')}`;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  ${extra}`); }
}
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

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-MESA-01 · Onda 5 (admin_orders_search devolve colunas novas) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const r = await client.query(`select pg_get_function_result(oid) as result from pg_proc where proname='admin_orders_search' and pronamespace='public'::regnamespace`);
    check('A1 RETURNS TABLE inclui tipo_pedido/origem_pedido/mesa_identificador', /tipo_pedido text.*origem_pedido text.*mesa_identificador text/.test(r.rows[0]?.result || ''), r.rows[0]?.result);

    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 1')).rows;
    if (authUsers.length < 1) { console.error('Precisa de >=1 usuario em auth.users no E2E.'); process.exit(2); }
    const [ADMIN_UID] = authUsers.map(x => x.id);

    const STORE = randomUUID(); const PROD = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-01 Onda5','ativo')`, [STORE, `mesa01-onda5-${STORE}`]);
    await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto Onda5',20.00,true,$2)`, [PROD, STORE]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true'),($1,'mesa_canal_admin','true')`, [STORE]);

    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE);
      const criar = await client.query(
        `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
        [JSON.stringify({ name: 'Cliente Onda5', phone: telefone() }),
         JSON.stringify({ payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '09', origem_pedido: 'admin_garcom', total: 20 }),
         JSON.stringify([{ product_id: PROD, nome_produto: 'Produto Onda5', quantity: 1 }]), STORE]);
      const orderId = criar.rows[0].res.order_id;
      check('B1 pedido de mesa criado com sucesso (setup)', criar.rows[0].res.ok === true, JSON.stringify(criar.rows[0].res));

      const busca = await client.query(`SELECT * FROM public.admin_orders_search(NULL, NULL, 20, NULL, NULL, $1::uuid)`, [STORE]);
      const row = busca.rows.find(r => r.id === orderId);
      check('B2 admin_orders_search devolve o pedido com tipo_pedido/origem_pedido/mesa_identificador corretos',
        !!row && row.tipo_pedido === 'mesa' && row.origem_pedido === 'admin_garcom' && row.mesa_identificador === '09',
        JSON.stringify(row));
    });

    // Regressao: authz continua igual (nao-admin nao consegue buscar).
    await withSavepoint(async () => {
      await client.query(`SELECT set_config('request.jwt.claims', '{}', true)`);
      await client.query(`SET LOCAL ROLE anon`);
      let erro = null;
      try { await client.query(`SELECT * FROM public.admin_orders_search(NULL, NULL, 20, NULL, NULL, $1::uuid)`, [STORE]); }
      catch (e) { erro = e.message; }
      check('B3 regressao: anon continua sem permissao pra buscar pedidos (authz intocada)', /apenas administradores/i.test(erro || ''), erro);
    });

    await client.query(`SELECT set_config('request.jwt.claims', '{}', true)`);
    await client.query(`RESET ROLE`);
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
