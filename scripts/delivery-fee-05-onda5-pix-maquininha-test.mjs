// REF-DELIVERY-FEE-05 · Onda 5 -- valida contra o banco (E2E dedicado por padrao) real que PIX pago
// na maquininha fisica da entrega passa a se comportar EXATAMENTE como debito/credito: aciona
// maquininha_fee quando a maquininha esta ativa no Admin, cai no fallback do adicional_pagamento_fee
// quando ela esta desativada, e continua mutuamente exclusivo entre os dois (Onda 4). Confere tambem
// que dinheiro/cartao NAO regrediram e que create_order() detecta divergencia quando o client declara
// um valor de PIX desatualizado (regra antiga). Mesmo padrao de conexao pg direta + BEGIN...ROLLBACK
// dos scripts REF-DELIVERY-FEE-05 anteriores -- nunca toca producao nem lojas reais quando apontado
// para db.e2e.env. Exit 0 = SUCCESS.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ENV_PATH = process.argv.includes('--prod')
  ? 'C:/Users/00thi/.encanto/db.env'
  : 'C:/Users/00thi/.encanto/db.e2e.env';

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

const telefone = () => `386${(n++).toString().padStart(8, '0')}`;

function callCreateOrder(customer, order, items, storeId, requestId = null) {
  return client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, $5::uuid, $4::uuid) AS res`,
    [JSON.stringify(customer), JSON.stringify(order), JSON.stringify(items), storeId, requestId]
  );
}
async function getOrder(orderId) {
  const r = await client.query(`SELECT delivery_fee, maquininha_fee, adicional_pagamento_fee, total FROM public.orders WHERE id = $1`, [orderId]);
  return r.rows[0];
}
async function callResolveDeliveryFee(storeId, retirada, paymentMethod, enderecoId) {
  const r = await client.query(
    `SELECT public._resolve_delivery_fee($1::uuid, $2::boolean, $3::text, $4::uuid) AS res`,
    [storeId, retirada, paymentMethod, enderecoId]
  );
  return r.rows[0].res;
}

const LOJA_LAT = -26.9000, LOJA_LNG = -48.6000;

async function main() {
  await client.connect();
  const STORE = randomUUID();
  console.log('==========================================================================');
  console.log(` REF-DELIVERY-FEE-05 (Onda 5) · PIX na maquininha fisica = tratamento de cartao (${ENV_PATH.includes('db.env') ? 'PRODUCAO' : 'E2E'})`);
  console.log('==========================================================================\n');

  const ENDERECO = randomUUID();
  const PRODUTO = randomUUID();
  await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste DF05 Onda5','ativo')`, [STORE, `delivery-fee-05-onda5-${Date.now()}`]);
  await client.query(`INSERT INTO public.products (id, nome, preco, categoria_id, disponivel, store_id) VALUES ($1,'Produto Teste',10.00,NULL,true,$2)`, [PRODUTO, STORE]);
  await client.query(`INSERT INTO public.addresses (id, store_id, rua, numero, latitude, longitude) VALUES ($1,$2,'Rua Teste','1',$3,$4)`, [ENDERECO, STORE, LOJA_LAT - 2 / 111.045, LOJA_LNG]);
  const item = () => [{ product_id: PRODUTO, nome_produto: 'Produto Teste', quantity: 1, price: 10.00, preco_unitario: 10.00 }];

  const setConfig = (maqAtivo, adicAtivo) => client.query(
    `INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'company_info', $2::text), ($1,'delivery_fee_config', $3::text)
     ON CONFLICT (store_id, chave) DO UPDATE SET valor = EXCLUDED.valor`,
    [STORE, JSON.stringify({ lojaLat: LOJA_LAT, lojaLng: LOJA_LNG }),
     JSON.stringify({ version: 1, ativo: true, maquininha: { ativo: maqAtivo, valor: 2.00 }, adicionalPagamento: { ativo: adicAtivo, valor: 2.00 }, incrementoAcimaFaixas: 2.00, faixas: [{ de: 0, ate: 20, valor: 10.00 }] })]
  );

  try {
    // ══ 1) _resolve_delivery_fee direto: PIX passa a se comportar EXATAMENTE como cartao ══════════
    await setConfig(true, true);
    await withTx(async () => {
      const pix = await callResolveDeliveryFee(STORE, false, 'pix', ENDERECO);
      const debito = await callResolveDeliveryFee(STORE, false, 'cartao_debito', ENDERECO);
      const credito = await callResolveDeliveryFee(STORE, false, 'cartao_credito', ENDERECO);
      const dinheiro = await callResolveDeliveryFee(STORE, false, 'dinheiro', ENDERECO);
      check('PIX (maquininha ativa) -> maquininha_fee=2.00, adicional=0 (igual debito/credito)',
        Number(pix.maquininha_fee) === 2.00 && Number(pix.adicional_pagamento_fee) === 0, JSON.stringify(pix));
      check('PIX == debito == credito (mesmos valores de acrescimo)',
        JSON.stringify({ m: pix.maquininha_fee, a: pix.adicional_pagamento_fee }) === JSON.stringify({ m: debito.maquininha_fee, a: debito.adicional_pagamento_fee })
        && JSON.stringify({ m: pix.maquininha_fee, a: pix.adicional_pagamento_fee }) === JSON.stringify({ m: credito.maquininha_fee, a: credito.adicional_pagamento_fee }));
      check('dinheiro NAO regrediu -- continua so adicional_pagamento_fee (maquininha nunca cobre dinheiro)',
        Number(dinheiro.maquininha_fee) === 0 && Number(dinheiro.adicional_pagamento_fee) === 2.00, JSON.stringify(dinheiro));
    });

    // ══ 2) Maquininha desativada -> PIX cai no fallback do adicional (igual cartao nesse cenario) ══
    await setConfig(false, true);
    await withTx(async () => {
      const pix = await callResolveDeliveryFee(STORE, false, 'pix', ENDERECO);
      const credito = await callResolveDeliveryFee(STORE, false, 'cartao_credito', ENDERECO);
      check('PIX com maquininha desligada -> maquininha_fee=0, adicional_pagamento_fee=2.00 (fallback)',
        Number(pix.maquininha_fee) === 0 && Number(pix.adicional_pagamento_fee) === 2.00, JSON.stringify(pix));
      check('PIX == credito nesse cenario tambem (mesmo fallback)',
        JSON.stringify({ m: pix.maquininha_fee, a: pix.adicional_pagamento_fee }) === JSON.stringify({ m: credito.maquininha_fee, a: credito.adicional_pagamento_fee }));
    });

    // ══ 3) Ambos desativados -> PIX R$0 nos dois (mesma regra de sempre) ══════════════════════════
    await setConfig(false, false);
    await withTx(async () => {
      const pix = await callResolveDeliveryFee(STORE, false, 'pix', ENDERECO);
      check('PIX com maquininha e adicional desligados -> ambos R$0', Number(pix.maquininha_fee) === 0 && Number(pix.adicional_pagamento_fee) === 0, JSON.stringify(pix));
    });

    // ══ 4) create_order() fluxo real: PIX com valores corretos -> ok, sem divergencia ═════════════
    await setConfig(true, true);
    await withTx(async () => {
      await comoLoja(STORE);
      const r = await callCreateOrder(
        { name: 'pix-maquininha-ok', phone: telefone() },
        { payment_method: 'pix', address: 'Rua Teste, 1', endereco_id: ENDERECO, delivery_fee: 10.00, maquininha_fee: 2.00, adicional_pagamento_fee: 0 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      let ok = res.ok === true && !res.divergencia_valor;
      if (ok) { const o = await getOrder(res.order_id); ok = Number(o.maquininha_fee) === 2.00 && Number(o.adicional_pagamento_fee) === 0; }
      check('create_order · PIX declarando maquininha_fee=2.00/adicional=0 -> aceito, persistido igual', ok, JSON.stringify(res));
    });

    // ══ 5) create_order() adulteracao: client declara PIX com a regra ANTIGA (R$0) -> divergencia ═══
    await withTx(async () => {
      await comoLoja(STORE);
      const antes = (await client.query(`SELECT count(*)::int n FROM public.orders WHERE store_id=$1`, [STORE])).rows[0].n;
      const r = await callCreateOrder(
        { name: 'pix-regra-antiga', phone: telefone() },
        { payment_method: 'pix', address: 'Rua Teste, 1', endereco_id: ENDERECO, delivery_fee: 10.00, maquininha_fee: 0, adicional_pagamento_fee: 0 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      const depois = (await client.query(`SELECT count(*)::int n FROM public.orders WHERE store_id=$1`, [STORE])).rows[0].n;
      const ok = res.ok === false && res.divergencia_valor === true && Number(res.maquininha_fee) === 2.00 && depois === antes;
      check('create_order · PIX declarando valores da regra ANTIGA (R$0) -> divergencia, nenhum pedido criado', ok, JSON.stringify(res));
    });

    // ══ 6) retirada + PIX -> tudo R$0 (early-return, nunca chega na regra de metodo) ═══════════════
    await withTx(async () => {
      const r = await callResolveDeliveryFee(STORE, true, 'pix', ENDERECO);
      check('retirada + PIX -> maquininha e adicional sempre R$0', Number(r.maquininha_fee) === 0 && Number(r.adicional_pagamento_fee) === 0, JSON.stringify(r));
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
