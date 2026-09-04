// REF-MESA-01 · Onda 8 (reconciliacao com REF-DELIVERY-FEE-05) -- valida especificamente a
// INTERSECCAO entre as duas REFs: pedido de Mesa nunca paga adicional_pagamento_fee (mesmo ramo
// "sem taxa" que ja zera delivery_fee/maquininha_fee), pedido de Entrega continua pagando
// adicional normalmente, admin_orders_search devolve as colunas das DUAS REFs simultaneamente, e
// o client nao consegue forjar adicional_pagamento_fee numa Mesa. Mesmo padrao das ondas
// anteriores: SAVEPOINT por caso dentro de BEGIN...ROLLBACK externo. Exit 0 = SUCCESS.
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
function resetRole() {
  return client.query(`RESET ROLE`).then(() => client.query(`SELECT set_config('request.jwt.claims', '{}', true)`));
}
async function criarPedido(storeId, prodId, extra) {
  const r = await client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
    [JSON.stringify({ name: 'Cliente Onda8', phone: telefone() }),
     JSON.stringify(extra),
     JSON.stringify([{ product_id: prodId, nome_produto: 'Produto Onda8', quantity: 1 }]), storeId]);
  return r.rows[0].res;
}

async function main() {
  await client.connect();
  console.log('==========================================================================');
  console.log(' REF-MESA-01 · Onda 8 (reconciliacao com REF-DELIVERY-FEE-05) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 1')).rows;
    if (authUsers.length < 1) { console.error('Precisa de >=1 usuario em auth.users no E2E.'); process.exit(2); }
    const [ADMIN_UID] = authUsers.map(x => x.id);

    const STORE = randomUUID(); const PROD = randomUUID();
    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-01 Onda8','ativo')`, [STORE, `mesa01-onda8-${STORE}`]);
    await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto Onda8',20.00,true,$2)`, [PROD, STORE]);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_UID, STORE]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true')`, [STORE]);

    // B1 -- Mesa + cartao_credito: adicional_pagamento_fee deve ser 0 (mesmo ramo sem-taxa).
    await withSavepoint(async () => {
      await setRole('authenticated', null, STORE);
      const res = await criarPedido(STORE, PROD, { payment_method: 'cartao_credito', tipo_pedido: 'mesa', mesa_identificador: '05' });
      check('B1a create_order (mesa + cartao_credito) retorna ok', res.ok === true, JSON.stringify(res));
      await resetRole();
      const row = (await client.query(`SELECT delivery_fee, maquininha_fee, adicional_pagamento_fee, tipo_pedido, mesa_identificador FROM public.orders WHERE id=$1`, [res.order_id])).rows[0];
      check('B1b mesa: delivery_fee=0, maquininha_fee=0, adicional_pagamento_fee=0 (nenhuma taxa, mesmo com cartao_credito)',
        Number(row.delivery_fee) === 0 && Number(row.maquininha_fee) === 0 && Number(row.adicional_pagamento_fee) === 0, JSON.stringify(row));
      check('B1c tipo_pedido/mesa_identificador persistidos corretamente', row.tipo_pedido === 'mesa' && row.mesa_identificador === '05', JSON.stringify(row));
    });

    // B2 -- Entrega + dinheiro: adicional_pagamento_fee continua sendo cobrado normalmente (regressao).
    await withSavepoint(async () => {
      await setRole('authenticated', null, STORE);
      const res = await criarPedido(STORE, PROD, { payment_method: 'dinheiro', address: 'Rua Teste, 1' });
      check('B2a create_order (entrega + dinheiro) retorna ok', res.ok === true, JSON.stringify(res));
      await resetRole();
      const row = (await client.query(`SELECT adicional_pagamento_fee, tipo_pedido FROM public.orders WHERE id=$1`, [res.order_id])).rows[0];
      check('B2b entrega: adicional_pagamento_fee=2.00 (regressao da REF-DELIVERY-FEE-05, preservada)',
        Number(row.adicional_pagamento_fee) === 2, JSON.stringify(row));
      check('B2c tipo_pedido derivado = entrega (default seguro, sem tipo_pedido explicito)', row.tipo_pedido === 'entrega', JSON.stringify(row));
    });

    // B3 -- client tenta forjar adicional_pagamento_fee numa mesa (real=0) -> divergencia, nenhum pedido.
    await withSavepoint(async () => {
      await setRole('authenticated', null, STORE);
      const res = await criarPedido(STORE, PROD, { payment_method: 'cartao_credito', tipo_pedido: 'mesa', mesa_identificador: '06', adicional_pagamento_fee: 2.00 });
      check('B3 client forja adicional_pagamento_fee=2.00 numa mesa (real=0) -> divergencia_valor, nenhum pedido criado',
        res.ok === false && res.divergencia_valor === true && Number(res.adicional_pagamento_fee) === 0, JSON.stringify(res));
    });

    // B4 -- admin_orders_search devolve as colunas das DUAS REFs simultaneamente.
    await withSavepoint(async () => {
      await setRole('authenticated', null, STORE);
      const mesaRes = await criarPedido(STORE, PROD, { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '09' });
      const entregaRes = await criarPedido(STORE, PROD, { payment_method: 'cartao_debito', address: 'Rua Y, 2' });

      await setRole('authenticated', ADMIN_UID, STORE);
      const r = await client.query(`SELECT * FROM public.admin_orders_search(NULL, NULL, 50, NULL, NULL, $1)`, [STORE]);
      const mesaRow = r.rows.find(o => o.id === mesaRes.order_id);
      const entregaRow = r.rows.find(o => o.id === entregaRes.order_id);
      check('B4a admin_orders_search devolve tipo_pedido=mesa + adicional_pagamento_fee=0 juntos',
        !!mesaRow && mesaRow.tipo_pedido === 'mesa' && Number(mesaRow.adicional_pagamento_fee) === 0, JSON.stringify(mesaRow));
      check('B4b admin_orders_search devolve tipo_pedido=entrega + adicional_pagamento_fee=2.00 juntos (debito)',
        !!entregaRow && entregaRow.tipo_pedido === 'entrega' && Number(entregaRow.adicional_pagamento_fee) === 2, JSON.stringify(entregaRow));
    });

    // B5 -- capability de Mesa desabilitada continua bloqueando, mesmo com adicional_pagamento_fee no meio do caminho.
    await withSavepoint(async () => {
      await client.query(`UPDATE public.store_settings SET valor='false' WHERE store_id=$1 AND chave='mesa_habilitada'`, [STORE]);
      await setRole('authenticated', null, STORE);
      const res = await criarPedido(STORE, PROD, { payment_method: 'pix', tipo_pedido: 'mesa', mesa_identificador: '10' });
      check('B5 mesa desabilitada continua bloqueando (fail-closed intacto pos-reconciliacao)',
        res.ok === false && res.error === 'modalidade indisponivel para esta loja', JSON.stringify(res));
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
