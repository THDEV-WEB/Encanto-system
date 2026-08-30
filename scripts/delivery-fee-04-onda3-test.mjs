// REF-DELIVERY-FEE-04 · Onda 3 -- valida a restricao de EXECUTE de public._resolve_delivery_fee()
// a anon/authenticated (mesmo achado/padrao de scripts/price-hardening-01-test.mjs, aplicado a
// _resolve_item_pricing() por outra sessao). Contra o projeto Supabase DEDICADO a E2E (nunca
// producao). Cada caso roda em BEGIN...ROLLBACK isolado. Exit 0 = SUCCESS.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ENV_PATH = 'C:/Users/00thi/.encanto/db.e2e.env';

const envGet = (txt, k) => { const m = txt.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
function loadConn() {
  const txt = readFileSync(ENV_PATH, 'utf8');
  const password = envGet(txt, 'PGPASSWORD');
  if (!password) { console.error('ERRO: PGPASSWORD vazio'); process.exit(2); }
  return { host: envGet(txt, 'PGHOST'), port: Number(envGet(txt, 'PGPORT') || 5432), user: envGet(txt, 'PGUSER'), password, database: envGet(txt, 'PGDATABASE') || 'postgres' };
}

const client = new pg.Client({ ...loadConn(), ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

let pass = 0, fail = 0, n = 0;
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
async function comoLoja(storeId) { await setJwt(randomUUID(), storeId); }
const telefone = () => `385${(n++).toString().padStart(8, '0')}`;

function callCreateOrder(customer, order, items, storeId) {
  return client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
    [JSON.stringify(customer), JSON.stringify(order), JSON.stringify(items), storeId]
  );
}
async function getOrder(orderId) {
  const r = await client.query(`SELECT delivery_fee, maquininha_fee FROM public.orders WHERE id = $1`, [orderId]);
  return r.rows[0];
}

const LOJA_LAT = -26.9000, LOJA_LNG = -48.6000;
const PERTO_LAT = -26.9060, PERTO_LNG = -48.6060; // ~0.9km, faixa1 = 10.00
const FAIXAS = [{ de: 0, ate: 5, valor: 10.00 }];

async function main() {
  await client.connect();

  const STORE = randomUUID();
  const PROD = randomUUID();
  const END_PERTO = randomUUID();

  console.log('==========================================================================');
  console.log(' REF-DELIVERY-FEE-04 (Onda 3) · restricao de EXECUTE de _resolve_delivery_fee (E2E)');
  console.log('==========================================================================\n');

  await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste DF04-Onda3','ativo')`, [STORE, `delivery-fee-04-onda3-${Date.now()}`]);
  await client.query(`INSERT INTO public.products (id, nome, preco, categoria_id, disponivel, store_id) VALUES ($1,'Produto Teste',10.00,NULL,true,$2)`, [PROD, STORE]);
  await client.query(
    `INSERT INTO public.store_settings (store_id, chave, valor) VALUES
       ($1,'company_info', $2::text),
       ($1,'delivery_fee_config', $3::text)`,
    [STORE, JSON.stringify({ lojaLat: LOJA_LAT, lojaLng: LOJA_LNG }),
     JSON.stringify({ version: 1, ativo: true, maquininha: { ativo: true, valor: 2.00 }, faixas: FAIXAS })]
  );
  await client.query(`INSERT INTO public.addresses (id, store_id, rua, numero, latitude, longitude) VALUES ($1,$2,'Rua Perto','1',$3,$4)`,
    [END_PERTO, STORE, PERTO_LAT, PERTO_LNG]);

  try {
    // ═══ ACESSO DIRETO — anon/authenticated NAO conseguem mais chamar _resolve_delivery_fee() direto. ═══
    await withTx(async () => {
      await client.query(`SET LOCAL ROLE anon`);
      try {
        await client.query(`SELECT public._resolve_delivery_fee($1::uuid, false, 'dinheiro', $2::uuid)`, [STORE, END_PERTO]);
        check('ACESSO DIRETO — role anon chamando _resolve_delivery_fee() -> bloqueado', false, 'nao lancou excecao');
      } catch (e) {
        check('ACESSO DIRETO — role anon chamando _resolve_delivery_fee() -> bloqueado (permission denied)', /permission denied/i.test(e.message), e.message);
      }
    });
    await withTx(async () => {
      await client.query(`SET LOCAL ROLE authenticated`);
      try {
        await client.query(`SELECT public._resolve_delivery_fee($1::uuid, false, 'dinheiro', $2::uuid)`, [STORE, END_PERTO]);
        check('ACESSO DIRETO — role authenticated chamando _resolve_delivery_fee() -> bloqueado', false, 'nao lancou excecao');
      } catch (e) {
        check('ACESSO DIRETO — role authenticated chamando _resolve_delivery_fee() -> bloqueado (permission denied)', /permission denied/i.test(e.message), e.message);
      }
    });
    // controle negativo: service_role continua com EXECUTE (nao faz parte do achado).
    await withTx(async () => {
      await client.query(`SET LOCAL ROLE service_role`);
      const r = await client.query(`SELECT public._resolve_delivery_fee($1::uuid, false, 'dinheiro', $2::uuid) AS r`, [STORE, END_PERTO]);
      check('CONTROLE — role service_role continua com EXECUTE (nao revogado)', r.rows[0].r?.delivery_fee !== undefined, JSON.stringify(r.rows[0]));
    });

    // ═══ FLUXO LEGITIMO — create_order() (chamador interno via SECURITY DEFINER) continua 100% operacional. ═══
    await withTx(async () => {
      await comoLoja(STORE);
      const r = await callCreateOrder(
        { name: 'Legit', phone: telefone() },
        { payment_method: 'cartao_debito', address: 'Rua Perto, 1', endereco_id: END_PERTO },
        [{ product_id: PROD, nome_produto: 'Produto Teste', quantity: 1, price: 10.00, preco_unitario: 10.00 }],
        STORE,
      );
      const res = r.rows[0].res;
      let ok = res.ok === true;
      if (ok) { const o = await getOrder(res.order_id); ok = Number(o.delivery_fee) === 10.00 && Number(o.maquininha_fee) === 2.00; }
      check('FLUXO LEGITIMO — create_order continua operacional (delivery=10.00, maquininha=2.00)', ok, JSON.stringify(res));
    });

    // ═══ DIVERGENCIA continua funcionando normalmente (Onda 2 intocada por este REVOKE). ═══
    await withTx(async () => {
      await comoLoja(STORE);
      const r = await callCreateOrder(
        { name: 'Legit2', phone: telefone() },
        { payment_method: 'cartao_debito', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 0, maquininha_fee: 0 },
        [{ product_id: PROD, nome_produto: 'Produto Teste', quantity: 1, price: 10.00, preco_unitario: 10.00 }],
        STORE,
      );
      const res = r.rows[0].res;
      const ok = res.ok === false && res.divergencia_valor === true && Number(res.delivery_fee) === 10.00;
      check('REGRESSAO — divergencia (Onda 2) continua funcionando apos o REVOKE', ok, JSON.stringify(res));
    });

    console.log(`\n${pass} passaram, ${fail} falharam.`);
  } finally {
    await client.query(`DELETE FROM public.orders WHERE store_id = $1`, [STORE]);
    await client.query(`DELETE FROM public.customers WHERE store_id = $1`, [STORE]);
    await client.query(`DELETE FROM public.addresses WHERE store_id = $1`, [STORE]);
    await client.query(`DELETE FROM public.products WHERE store_id = $1`, [STORE]);
    await client.query(`DELETE FROM public.store_settings WHERE store_id = $1`, [STORE]);
    await client.query(`DELETE FROM public.stores WHERE id = $1`, [STORE]);
    await client.end();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('ERRO FATAL:', e.message);
  try { await client.query('ROLLBACK'); } catch {}
  await client.end().catch(() => {});
  process.exit(1);
});
