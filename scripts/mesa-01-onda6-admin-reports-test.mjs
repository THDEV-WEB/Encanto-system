// REF-MESA-01 · Onda 6 -- valida que admin_reports_summary() separa Mesa como fatia PROPRIA em
// por_tipo, nunca somada silenciosamente a 'entrega' (achado mais grave da auditoria original)
// contra o projeto Supabase DEDICADO a E2E (nunca producao). Mesmo padrao das ondas anteriores:
// SAVEPOINT por caso, ROLLBACK no final. Exit 0 = SUCCESS.
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
const telefone = () => `395${(n++).toString().padStart(8, '0')}`;
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
async function criarPedido(storeId, prodId, extra) {
  const r = await client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
    [JSON.stringify({ name: 'Cliente Onda6', phone: telefone() }),
     JSON.stringify({ payment_method: 'dinheiro', total: 20, ...extra }),
     JSON.stringify([{ product_id: prodId, nome_produto: 'Produto Onda6', quantity: 1 }]), storeId]);
  if (!r.rows[0].res.ok) throw new Error('create_order falhou no setup: ' + JSON.stringify(r.rows[0].res));
  return r.rows[0].res.order_id;
}

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-MESA-01 · Onda 6 (admin_reports_summary separa Mesa) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 1')).rows;
    if (authUsers.length < 1) { console.error('Precisa de >=1 usuario em auth.users no E2E.'); process.exit(2); }
    const [ADMIN_UID] = authUsers.map(x => x.id);

    const STORE = randomUUID(); const PROD = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-01 Onda6','ativo')`, [STORE, `mesa01-onda6-${STORE}`]);
    await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto Onda6',20.00,true,$2)`, [PROD, STORE]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true')`, [STORE]);

    await withSavepoint(async () => {
      await setRole('authenticated', null, STORE);
      await criarPedido(STORE, PROD, { address: 'Rua X, 1' });                              // entrega
      await criarPedido(STORE, PROD, { address: 'Retirada na loja - x', retirada: true });   // retirada
      await criarPedido(STORE, PROD, { tipo_pedido: 'mesa', mesa_identificador: '01' });      // mesa
      await criarPedido(STORE, PROD, { tipo_pedido: 'mesa', mesa_identificador: '02' });      // mesa

      await setRole('authenticated', ADMIN_UID, STORE);
      const hoje = new Date().toISOString().slice(0, 10);
      const r = await client.query(`SELECT public.admin_reports_summary($1,$2,$3) AS r`, [hoje, hoje, STORE]);
      const porTipo = r.rows[0].r.por_tipo;
      const mapa = Object.fromEntries(porTipo.map(t => [t.tipo, t]));

      check('B1 por_tipo tem exatamente 3 fatias (entrega/retirada/mesa), nunca mesa somada em entrega',
        porTipo.length === 3 && mapa.entrega && mapa.retirada && mapa.mesa,
        JSON.stringify(porTipo));
      check('B2 entrega: 1 pedido, R$20', mapa.entrega?.pedidos === '1' || mapa.entrega?.pedidos === 1, JSON.stringify(mapa.entrega));
      check('B3 retirada: 1 pedido, R$20', mapa.retirada?.pedidos === '1' || mapa.retirada?.pedidos === 1, JSON.stringify(mapa.retirada));
      check('B4 mesa: 2 pedidos, R$40 -- NAO contabilizados como entrega', (mapa.mesa?.pedidos === '2' || mapa.mesa?.pedidos === 2) && Number(mapa.mesa?.receita) === 40, JSON.stringify(mapa.mesa));
      // REF-MESA-01 Onda 8 (reconciliacao com REF-DELIVERY-FEE-05): o pedido "entrega" deste fixture
      // paga em dinheiro -> ganha +R$2,00 de adicional_pagamento_fee (retirada/mesa continuam em
      // R$0, confirmado por B3/B4 acima) -- 80 (4x R$20) + 2 = 82. Nao e' regressao de Mesa, e' a
      // nova taxa da REF-DELIVERY-FEE-05 coexistindo corretamente.
      check('B5 total_pedidos/total_receita agregam os 4 (agnostico a tipo, ja era assim)', r.rows[0].r.total_pedidos === 4 && Number(r.rows[0].r.total_receita) === 82, JSON.stringify({ total_pedidos: r.rows[0].r.total_pedidos, total_receita: r.rows[0].r.total_receita }));
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
