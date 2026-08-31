// REF-ADDRESS-GEO-INTEGRITY-01 -- GATE FINAL DE PRODUCAO -- SMOKE TEST POS-DEPLOY.
// Roda DEPOIS de aplicar as 2 migrations da Onda 2 em producao. UMA UNICA transacao
// BEGIN...ROLLBACK, dados 100% descartaveis (loja/produto/customers/enderecos fake, gerados com
// randomUUID() dentro da propria transacao -- NUNCA toca a loja "encanto" real nem qualquer dado
// real). Mesmo cenario e mesmas 10 asserções ja validadas 10/10 no E2E
// (scripts/address-geo-integrity-01-onda3-integration-test.mjs) -- roda aqui so' para confirmar que
// o comportamento em PRODUCAO, pos-migration, e' identico ao validado. Exit 0 = SUCCESS (liquido
// zero + 10/10); qualquer FAIL aqui e' motivo de ROLLBACK IMEDIATO das migrations (ver
// docs/ref/REF-ADDRESS-GEO-INTEGRITY-01-gate-final-producao.md).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ENV_PATH = 'C:/Users/00thi/.encanto/db.env';
const EXPECTED_PROD_REF = 'hvbcdxsagkjtfjwvnslo';
const envGet = (txt, k) => { const m = txt.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
function loadConn() {
  const txt = readFileSync(ENV_PATH, 'utf8');
  const password = envGet(txt, 'PGPASSWORD');
  if (!password) { console.error('ERRO: PGPASSWORD vazio'); process.exit(2); }
  const user = envGet(txt, 'PGUSER');
  if (!user || !user.includes(EXPECTED_PROD_REF)) { console.error(`ABORTADO: PGUSER (${user}) nao bate com o project ref de PRODUCAO esperado (${EXPECTED_PROD_REF}).`); process.exit(2); }
  return { host: envGet(txt, 'PGHOST'), port: Number(envGet(txt, 'PGPORT') || 5432), user, password, database: envGet(txt, 'PGDATABASE') || 'postgres' };
}
const client = new pg.Client({ ...loadConn(), ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

let pass = 0, fail = 0, n = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  ${extra}`); }
}
async function setJwt(sub, tenantId) {
  const claims = { ...(sub ? { sub } : {}), ...(tenantId ? { tenant_id: tenantId } : {}) };
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
}
const telefone = () => `396${(n++).toString().padStart(8, '0')}`;
function callCreateOrder(customer, order, items, storeId, requestId) {
  return client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, $4::uuid, $5::uuid) AS res`,
    [JSON.stringify(customer), JSON.stringify(order), JSON.stringify(items), requestId, storeId]
  );
}
async function getOrder(orderId) {
  const r = await client.query(`SELECT delivery_fee, maquininha_fee, total, endereco_id FROM public.orders WHERE id = $1`, [orderId]);
  return r.rows[0];
}
async function countLoyaltyEvents(customerId) {
  const r = await client.query(`SELECT count(*)::int AS n FROM public.loyalty_events WHERE customer_id = $1`, [customerId]);
  return r.rows[0].n;
}
async function countOrderItemPrice(orderId) {
  const r = await client.query(`SELECT preco_unitario FROM public.order_items WHERE order_id = $1`, [orderId]);
  return Number(r.rows[0]?.preco_unitario);
}

const LOJA_X_LAT = -26.9000, LOJA_X_LNG = -48.6000;
const LOJA_Y_LAT = -23.5500, LOJA_Y_LNG = -46.6300;
const PERTO_X_LAT = -26.9060, PERTO_X_LNG = -48.6060;
const PERTO_Y_LAT = -23.5560, PERTO_Y_LNG = -46.6360;

async function main() {
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, current_database() AS db")).rows[0];
  console.log(`Conectado como ${meta.who} em ${meta.db} (ref ${EXPECTED_PROD_REF} == PRODUCAO, confirmado) -- pos-deploy smoke test\n`);
  console.log('==========================================================================');
  console.log(' REF-ADDRESS-GEO-INTEGRITY-01 · GATE FINAL -- SMOKE TEST POS-DEPLOY (producao)');
  console.log('==========================================================================\n');

  const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 2')).rows;
  if (authUsers.length < 2) { console.error('Precisa de >=2 usuarios em auth.users em producao.'); process.exit(2); }
  const [AUTH_C, AUTH_D] = authUsers.map(r => r.id);

  const STORE_X = randomUUID(), STORE_Y = randomUUID();
  await client.query('BEGIN');
  try {
    const PROD_X = randomUUID(), PROD_Y = randomUUID();

    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja X Gate Final','ativo'), ($3,$4,'Loja Y Gate Final','ativo')`,
      [STORE_X, `gate-final-x-${randomUUID()}`, STORE_Y, `gate-final-y-${randomUUID()}`]);
    await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto X',18.50,true,$2), ($3,'Produto Y',30.00,true,$4)`,
      [PROD_X, STORE_X, PROD_Y, STORE_Y]);
    await client.query(
      `INSERT INTO public.store_settings (store_id, chave, valor) VALUES
         ($1,'company_info',$2::text), ($1,'delivery_fee_config',$3::text), ($1,'loyalty_enabled','true'), ($1,'loyalty_required','10'),
         ($4,'company_info',$5::text), ($4,'delivery_fee_config',$6::text)`,
      [STORE_X, JSON.stringify({ lojaLat: LOJA_X_LAT, lojaLng: LOJA_X_LNG }),
       JSON.stringify({ version: 1, ativo: true, maquininha: { ativo: false, valor: 0 }, faixas: [{ de: 0, ate: 5, valor: 9.00 }] }),
       STORE_Y, JSON.stringify({ lojaLat: LOJA_Y_LAT, lojaLng: LOJA_Y_LNG }),
       JSON.stringify({ version: 1, ativo: true, maquininha: { ativo: false, valor: 0 }, faixas: [{ de: 0, ate: 5, valor: 40.00 }] })]
    );

    const phoneC = telefone(), phoneD = telefone();
    const rC = await client.query(`INSERT INTO public.customers (name, phone, store_id, auth_user_id) VALUES ($1,$2,$3,$4) RETURNING id`, ['Customer C', phoneC, STORE_X, AUTH_C]);
    const CUSTOMER_C = rC.rows[0].id;
    const rD = await client.query(`INSERT INTO public.customers (name, phone, store_id, auth_user_id) VALUES ($1,$2,$3,$4) RETURNING id`, ['Customer D', phoneD, STORE_X, AUTH_D]);
    const CUSTOMER_D = rD.rows[0].id;

    const endC = randomUUID();
    await client.query(`INSERT INTO public.addresses (id, store_id, customer_id, rua, numero, latitude, longitude) VALUES ($1,$2,$3,'Rua de C','1',$4,$5)`,
      [endC, STORE_X, CUSTOMER_C, PERTO_X_LAT, PERTO_X_LNG]);
    const endD = randomUUID();
    await client.query(`INSERT INTO public.addresses (id, store_id, customer_id, rua, numero, latitude, longitude) VALUES ($1,$2,$3,'Rua de D','2',$4,$5)`,
      [endD, STORE_X, CUSTOMER_D, PERTO_X_LAT, PERTO_X_LNG]);

    const REQ1 = randomUUID();

    // Prova 1 -- OWNERSHIP + DELIVERY_FEE AUTORITATIVO + DIVERGENCIA
    await setJwt(AUTH_D, STORE_X);
    const r1 = await callCreateOrder(
      { name: 'Customer D', phone: phoneD },
      { payment_method: 'dinheiro', address: 'Tentando endereco de C', endereco_id: endC, delivery_fee: 15.00 },
      [{ product_id: PROD_X, nome_produto: 'Produto X', quantity: 1, price: 0.01 }],
      STORE_X, REQ1
    );
    const res1 = r1.rows[0].res;
    check('1 — OWNERSHIP+DELIVERY_FEE+DIVERGENCIA: endereco de C rejeitado -> autoritativo=0 -> diverge, nenhum pedido',
      res1.ok === false && res1.divergencia_valor === true && Number(res1.delivery_fee) === 0, JSON.stringify(res1));

    // Prova 2 -- BOUNDING BOX + OWNERSHIP + PRECO AUTORITATIVO + FIDELIDADE
    const antesLoyalty = await countLoyaltyEvents(CUSTOMER_D);
    const r2 = await callCreateOrder(
      { name: 'Customer D', phone: phoneD },
      { payment_method: 'dinheiro', address: 'Rua de D, 2', endereco_id: endD, delivery_fee: 9.00 },
      [{ product_id: PROD_X, nome_produto: 'Produto X', quantity: 1, price: 0.01 }],
      STORE_X, REQ1
    );
    const res2 = r2.rows[0].res;
    check('2a — BBOX+OWNERSHIP+DELIVERY_FEE: proprio endereco (dentro do bbox) aceito, delivery_fee=9.00', res2.ok === true, JSON.stringify(res2));
    const ord2 = res2.ok ? await getOrder(res2.order_id) : null;
    check('2b — endereco_id vinculado = o PROPRIO de D', ord2?.endereco_id === endD);
    check('2c — delivery_fee persistido = 9.00', Number(ord2?.delivery_fee) === 9.00);
    const precoItem = res2.ok ? await countOrderItemPrice(res2.order_id) : null;
    check('2d — PRECO AUTORITATIVO: price forjado (0.01) ignorado, banco gravou 18.50', precoItem === 18.50, `gravado=${precoItem}`);
    const depoisLoyalty = await countLoyaltyEvents(CUSTOMER_D);
    check('2e — FIDELIDADE: 0 na divergente, +1 na confirmada', antesLoyalty === 0 && depoisLoyalty === 1, `antes=${antesLoyalty} depois=${depoisLoyalty}`);

    // Prova 3 -- IDEMPOTENCIA
    const r3 = await callCreateOrder(
      { name: 'Customer D', phone: phoneD },
      { payment_method: 'dinheiro', address: 'Rua de D, 2', endereco_id: endD, delivery_fee: 9.00 },
      [{ product_id: PROD_X, nome_produto: 'Produto X', quantity: 1, price: 0.01 }],
      STORE_X, REQ1
    );
    const res3 = r3.rows[0].res;
    check('3a — IDEMPOTENCIA: retry mesmo request_id -> idempotent:true, mesmo order_id', res3.ok === true && res3.idempotent === true && res3.order_id === res2.order_id, JSON.stringify(res3));
    check('3b — IDEMPOTENCIA: retry NAO gera 2o loyalty_event', await countLoyaltyEvents(CUSTOMER_D) === 1);

    // Prova 4 -- ISOLAMENTO MULTI-TENANT
    const rCY = await client.query(`INSERT INTO public.customers (name, phone, store_id, auth_user_id) VALUES ($1,$2,$3,$4) RETURNING id`, ['Customer C em Y', telefone(), STORE_Y, AUTH_C]);
    const CUSTOMER_C_Y = rCY.rows[0].id;
    const endCY = randomUUID();
    await client.query(`INSERT INTO public.addresses (id, store_id, customer_id, rua, numero, latitude, longitude) VALUES ($1,$2,$3,'Rua em Y','9',$4,$5)`,
      [endCY, STORE_Y, CUSTOMER_C_Y, PERTO_Y_LAT, PERTO_Y_LNG]);
    await setJwt(AUTH_C, STORE_Y);
    const r4 = await callCreateOrder(
      { name: 'Customer C em Y', phone: telefone() },
      { payment_method: 'dinheiro', address: 'Rua em Y, 9', endereco_id: endCY, delivery_fee: 40.00 },
      [{ product_id: PROD_Y, nome_produto: 'Produto Y', quantity: 1, price: 999.99 }],
      STORE_Y, randomUUID()
    );
    const res4 = r4.rows[0].res;
    const ord4 = res4.ok ? await getOrder(res4.order_id) : null;
    check('4a — ISOLAMENTO: config propria de Y cobra R$40 (nao R$9 de X)', res4.ok === true && Number(ord4?.delivery_fee) === 40.00, JSON.stringify(res4));

    const r4b = await callCreateOrder(
      { name: 'Customer C em Y', phone: telefone() },
      { payment_method: 'dinheiro', address: 'Tentando endereco de X em Y', endereco_id: endD, delivery_fee: 999 },
      [{ product_id: PROD_Y, nome_produto: 'Produto Y', quantity: 1, price: 30 }],
      STORE_Y, randomUUID()
    );
    const res4b = r4b.rows[0].res;
    check('4b — ISOLAMENTO: endereco de X em pedido de Y -> rejeitado, diverge', res4b.ok === false && res4b.divergencia_valor === true && Number(res4b.delivery_fee) === 0, JSON.stringify(res4b));

    console.log(`\n${pass} passaram, ${fail} falharam.`);
  } finally {
    await client.query('ROLLBACK');
    const chk = await client.query(`SELECT count(*)::int AS n FROM public.stores WHERE id IN ($1,$2)`, [STORE_X, STORE_Y]);
    console.log(`\nVerificacao pos-ROLLBACK: lojas de teste ainda existem no banco? ${chk.rows[0].n > 0 ? 'SIM (FALHA GRAVE!)' : 'NAO (liquido zero confirmado)'}`);
    if (chk.rows[0].n > 0) fail++;
  }
  await client.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('ERRO FATAL:', e.message);
  try { await client.query('ROLLBACK'); } catch {}
  await client.end().catch(() => {});
  process.exit(1);
});
