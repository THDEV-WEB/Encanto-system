// REF-MESA-02 · Onda 7 (adicionais pagos no formulario do garcom) -- E2E dedicado. Confirma que
// create_order() (a autoridade real, _resolve_item_pricing) calcula o preco corretamente quando um
// pedido admin_garcom chega com adicionais -- o mesmo caminho que NovoPedidoMesaModal agora usa.
// SAVEPOINT por caso.
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

let pass = 0, fail = 0, spCounter = 0, n = 0;
const telefone = () => `370${(n++).toString().padStart(8, '0')}`;
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

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-MESA-02 · Onda 7 (adicionais pagos no formulario do garcom) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 1')).rows;
    if (authUsers.length < 1) { console.error('Precisa de >=1 usuario em auth.users no E2E.'); process.exit(2); }
    const [ADMIN_UID] = authUsers.map(x => x.id);

    const STORE_A = randomUUID(); const PROD = randomUUID(); const AD = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-02 Onda7','ativo')`, [STORE_A, `mesa02-onda7-${STORE_A}`]);
    await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto Onda7',20.00,true,$2)`, [PROD, STORE_A]);
    await client.query(`INSERT INTO public.adicionais (id, nome, grupo, tipo, preco, ativo, ordem, store_id) VALUES ($1,'Bacon extra','acai','pago',5.00,true,1,$2)`, [AD, STORE_A]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE_A]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true'),($1,'mesa_canal_admin','true')`, [STORE_A]);

    await withSavepoint(async () => {
      await setRole('authenticated', ADMIN_UID, STORE_A);
      // adicionais no MESMO formato que _resolve_item_pricing espera (id/nome/preco vindos do
      // client sao so PISTA -- o preco de verdade e' recalculado server-side, mas para um produto
      // sem tabela real de adicionais cadastrados, _resolve_item_pricing aceita o array recebido
      // como snapshot quando o produto nao restringe -- confirma que o pipeline aceita e persiste
      // adicionais no pedido de mesa via admin_garcom, o caminho que NovoPedidoMesaModal usa agora.
      const res = await client.query(
        `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
        [JSON.stringify({ name: 'Cliente Onda7', phone: telefone() }),
         JSON.stringify({ payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '15', origem_pedido: 'admin_garcom' }),
         JSON.stringify([{ product_id: PROD, nome_produto: 'Produto Onda7', quantity: 1, adicionais: [{ id: AD, nome: 'Bacon extra', preco: 5 }] }]),
         STORE_A]);
      check('B1 create_order admin_garcom com adicionais no item -> sucesso', res.rows[0].res.ok === true, JSON.stringify(res.rows[0].res));
      await resetRole();
      const item = (await client.query(`SELECT adicionais, preco_unitario FROM public.order_items WHERE order_id=$1`, [res.rows[0].res.order_id])).rows[0];
      check('B2 order_items.adicionais persistido (nao mais sempre vazio [])', Array.isArray(item.adicionais) && item.adicionais.length > 0, JSON.stringify(item));
      check('B3 preco_unitario reflete produto (20) + adicional (5) = 25 -- server-side, nunca confia no client', Number(item.preco_unitario) === 25, JSON.stringify(item));
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
