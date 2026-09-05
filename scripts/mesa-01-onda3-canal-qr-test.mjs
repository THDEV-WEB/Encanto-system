// REF-MESA-01 · Onda 3 -- valida a checagem de mesa_canal_qr dentro de create_order() contra o
// projeto Supabase DEDICADO a E2E (nunca producao). Mesmo padrao de
// scripts/mesa-01-onda1-fundacao-test.mjs: conexao pg direta (db.e2e.env), cada caso em SAVEPOINT
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
const telefone = () => `398${(n++).toString().padStart(8, '0')}`;

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
  console.log(' REF-MESA-01 · Onda 3 (canal QR) · E2E');
  console.log('==========================================================================\n');

  await client.query('BEGIN');
  try {
    // Estrutural: constraint de origem_pedido ja inclui 'qr_mesa' desde a Onda 1.
    {
      const r = await client.query(`select pg_get_constraintdef(oid) as def from pg_constraint where conname='orders_origem_pedido_valid'`);
      check('A1 constraint orders_origem_pedido_valid inclui qr_mesa', /qr_mesa/.test(r.rows[0]?.def || ''), r.rows[0]?.def);
    }

    const STORE_QR_ON = randomUUID();    // mesa habilitada + canal_qr habilitado
    const STORE_QR_OFF = randomUUID();   // mesa habilitada, canal_qr DESLIGADO
    const PROD_ON = randomUUID();
    const PROD_OFF = randomUUID();
    const slugOn = `mesa01-qron-${STORE_QR_ON}`;
    const slugOff = `mesa01-qroff-${STORE_QR_OFF}`;

    async function setupLoja(storeId, slug, prodId) {
      await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste MESA-01 QR','ativo')`, [storeId, slug]);
      await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto MESA-01 QR',20.00,true,$2)`, [prodId, storeId]);
    }
    await setupLoja(STORE_QR_ON, slugOn, PROD_ON);
    await setupLoja(STORE_QR_OFF, slugOff, PROD_OFF);
    // Fora de qualquer savepoint de teste (precisa sobreviver aos ROLLBACK TO SAVEPOINT individuais).
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true'),($1,'mesa_canal_qr','true')`, [STORE_QR_ON]);
    await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'mesa_habilitada','true'),($1,'mesa_canal_qr','false')`, [STORE_QR_OFF]);
    const item = (prodId) => [{ product_id: prodId, nome_produto: 'Produto MESA-01 QR', quantity: 1 }];

    // B1 -- canal_qr=true: pedido de mesa via QR e aceito, gravado com origem_pedido='qr_mesa'.
    // REF-MESA-02 · Onda 5 (QR protegido): create_order() passou a exigir mesa_qr_token pro canal
    // qr_mesa (mesa_identificador cru do payload e' ignorado nesse canal) -- cria a mesa fisica de
    // verdade (public.mesas) pra obter um token real, em vez de so mandar '12' solto.
    const mesaQrRow = await client.query(
      `INSERT INTO public.mesas (store_id, identificador) VALUES ($1,'12') RETURNING qr_token`, [STORE_QR_ON]);
    const QR_TOKEN_12 = mesaQrRow.rows[0].qr_token;
    await withSavepoint(async () => {
      await setGuestOrigin(slugOn);
      const r = await callCreateOrder(
        { name: 'Cliente QR', phone: telefone() },
        { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_qr_token: QR_TOKEN_12, origem_pedido: 'qr_mesa', total: 20 },
        item(PROD_ON), STORE_QR_ON);
      const res = r.rows[0].res;
      check('B1a create_order (tipo_pedido=mesa, origem_pedido=qr_mesa, canal_qr=true) retorna ok', res.ok === true, JSON.stringify(res));
      if (res.ok) {
        await resetRole();
        const row = await getOrder(res.order_id);
        check('B1b order gravado com origem_pedido=qr_mesa, tipo_pedido=mesa, mesa_identificador=12',
          row.origem_pedido === 'qr_mesa' && row.tipo_pedido === 'mesa' && row.mesa_identificador === '12', JSON.stringify(row));
      }
    });

    // B2 -- canal_qr=false (mas mesa_habilitada=true): pedido via QR e rejeitado, mensagem generica.
    await withSavepoint(async () => {
      await setGuestOrigin(slugOff);
      const r = await callCreateOrder(
        { name: 'Cliente QR Bloqueado', phone: telefone() },
        { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '05', origem_pedido: 'qr_mesa', total: 20 },
        item(PROD_OFF), STORE_QR_OFF);
      const res = r.rows[0].res;
      check('B2 create_order (origem_pedido=qr_mesa, canal_qr=false) -> ok:false, mensagem generica',
        res.ok === false && res.error === 'canal indisponivel para esta loja', JSON.stringify(res));
    });

    // B3 -- mesmo canal_qr=false: pedido de mesa SEM vir do QR (origem_pedido default 'storefront')
    // continua funcionando normalmente -- confirma que a checagem nova nao regride o caminho da Onda 2.
    await withSavepoint(async () => {
      await setGuestOrigin(slugOff);
      const r = await callCreateOrder(
        { name: 'Cliente Mesa Normal', phone: telefone() },
        { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '06', total: 20 },
        item(PROD_OFF), STORE_QR_OFF);
      const res = r.rows[0].res;
      check('B3 mesa via storefront normal (sem QR) continua ok mesmo com canal_qr=false (regressao Onda 2)',
        res.ok === true, JSON.stringify(res));
    });

    // B4 -- combinacao sem sentido: origem_pedido='qr_mesa' com tipo_pedido='entrega' -> rejeitado.
    await withSavepoint(async () => {
      await setGuestOrigin(slugOn);
      const r = await callCreateOrder(
        { name: 'Cliente Combinacao Invalida', phone: telefone() },
        { payment_method: 'dinheiro', origem_pedido: 'qr_mesa', address: 'Rua X, 1', total: 20 },
        item(PROD_ON), STORE_QR_ON);
      const res = r.rows[0].res;
      check('B4 origem_pedido=qr_mesa com tipo_pedido=entrega -> ok:false, mensagem generica',
        res.ok === false && res.error === 'canal indisponivel para esta loja', JSON.stringify(res));
    });

    // B5 -- bypass anon: loja SEM canal_qr, cliente anonimo tentando forcar origem_pedido=qr_mesa.
    await withSavepoint(async () => {
      await setGuestOrigin(slugOff);
      const r = await callCreateOrder(
        { name: 'Bypass Anon QR', phone: telefone() },
        { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: '09', origem_pedido: 'qr_mesa', total: 20 },
        item(PROD_OFF), STORE_QR_OFF);
      const res = r.rows[0].res;
      check('B5 bypass anon (guest, Origin real, canal_qr=false) -> bloqueado no servidor',
        res.ok === false && res.error === 'canal indisponivel para esta loja', JSON.stringify(res));
    });

    // B6 -- mesa_identificador maior que 40 chars: cai na CHECK constraint da Onda 1, INSERT falha
    // (nao persiste), create_order devolve ok:false (captura via "exception when others").
    await withSavepoint(async () => {
      await setGuestOrigin(slugOn);
      const identificadorGigante = 'M'.repeat(60);
      const r = await callCreateOrder(
        { name: 'Cliente Identificador Gigante', phone: telefone() },
        { payment_method: 'dinheiro', tipo_pedido: 'mesa', mesa_identificador: identificadorGigante, origem_pedido: 'qr_mesa', total: 20 },
        item(PROD_ON), STORE_QR_ON);
      const res = r.rows[0].res;
      check('B6 mesa_identificador > 40 chars -> rejeitado pela CHECK constraint (nao persiste)',
        res.ok === false, JSON.stringify(res));
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
