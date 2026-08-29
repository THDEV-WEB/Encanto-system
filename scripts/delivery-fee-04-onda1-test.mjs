// REF-DELIVERY-FEE-04 · Onda 1 -- valida que create_order() calcula delivery_fee/maquininha_fee
// AUTORITATIVOS no servidor (nunca confia nos valores enviados pelo client) contra o projeto Supabase
// DEDICADO a E2E (nunca producao). Mesmo padrao de scripts/price-source-01-onda1-test.mjs: conexao
// pg direta (db.e2e.env), cada caso em BEGIN...ROLLBACK, SET LOCAL request.jwt.claims simula
// tenant_id assinado (nao depende de resolucao por Origin, fora do alvo desta REF). Loja/produto/
// enderecos 100% descartaveis, criados dentro da propria transacao -- nunca toca Encanto/Aquarios
// reais nem qualquer fixture compartilhada de outra suite. Exit 0 = SUCCESS.
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

const telefone = () => `388${(n++).toString().padStart(8, '0')}`;

function callCreateOrder(customer, order, items, storeId) {
  return client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
    [JSON.stringify(customer), JSON.stringify(order), JSON.stringify(items), storeId]
  );
}
async function getOrder(orderId) {
  const r = await client.query(`SELECT delivery_fee, maquininha_fee, total FROM public.orders WHERE id = $1`, [orderId]);
  return r.rows[0];
}

// ── Coordenadas fixas p/ teste (Blumenau/SC, mesma regiao dos dados reais do projeto): loja em
// (-26.9000,-48.6000). PERTO ~0.7km (faixa 1, ate 5km). LONGE ~7.8km (faixa 2, 5.1-10km). FORA DE
// ALCANCE ~50km (alem da maior faixa cadastrada).
const LOJA_LAT = -26.9000, LOJA_LNG = -48.6000;
const PERTO_LAT = -26.9060, PERTO_LNG = -48.6060;   // ~0.9km (haversine exato, conferido)
const LONGE_LAT = -26.9450, LONGE_LNG = -48.6450;   // ~6.7km (haversine exato, conferido)
const FORA_LAT  = -27.3500, FORA_LNG  = -49.0500;   // ~58km

const FAIXAS = [{ de: 0, ate: 5, valor: 10.00 }, { de: 5.1, ate: 10, valor: 20.00 }];

async function main() {
  await client.connect();

  const STORE = randomUUID();
  const OUTRA_LOJA = randomUUID();
  const PROD = randomUUID();
  const END_PERTO = randomUUID();
  const END_LONGE = randomUUID();
  const END_FORA = randomUUID();
  const END_SEM_COORD = randomUUID();
  const END_OUTRA_LOJA = randomUUID();

  console.log('==========================================================================');
  console.log(' REF-DELIVERY-FEE-04 (Onda 1) · delivery_fee/maquininha_fee autoritativos -- create_order (E2E)');
  console.log('==========================================================================\n');

  // Setup (fora de transacao de teste -- fixtures persistentes so' durante a execucao do script,
  // removidas no finally).
  await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste DELIVERY-FEE-04','ativo')`, [STORE, `delivery-fee-04-${Date.now()}`]);
  await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Outra Loja DELIVERY-FEE-04','ativo')`, [OUTRA_LOJA, `delivery-fee-04-outra-${Date.now()}`]);
  await client.query(`INSERT INTO public.products (id, nome, preco, categoria_id, disponivel, store_id) VALUES ($1,'Produto Teste',10.00,NULL,true,$2)`, [PROD, STORE]);
  await client.query(
    `INSERT INTO public.store_settings (store_id, chave, valor) VALUES
       ($1,'company_info', $2::text),
       ($1,'delivery_fee_config', $3::text)`,
    [STORE, JSON.stringify({ lojaLat: LOJA_LAT, lojaLng: LOJA_LNG }),
     JSON.stringify({ version: 1, ativo: true, maquininha: { ativo: true, valor: 2.00 }, faixas: FAIXAS })]
  );
  await client.query(
    `INSERT INTO public.addresses (id, store_id, rua, numero, latitude, longitude) VALUES
       ($1,$5,'Rua Perto','1',$2,$3),
       ($4,$5,'Rua Longe','2',$6,$7),
       ($8,$5,'Rua Fora','3',$9,$10),
       ($11,$5,'Rua Sem Coord','4',NULL,NULL),
       ($12,$13,'Rua Outra Loja','5',$2,$3)`,
    [END_PERTO, PERTO_LAT, PERTO_LNG, END_LONGE, STORE, LONGE_LAT, LONGE_LNG,
     END_FORA, FORA_LAT, FORA_LNG, END_SEM_COORD, END_OUTRA_LOJA, OUTRA_LOJA]
  );

  const item = () => [{ product_id: PROD, nome_produto: 'Produto Teste', quantity: 1, price: 10.00, preco_unitario: 10.00 }];

  try {
    // ── Caso 1 — retirada: delivery_fee/maquininha_fee forjados no payload -> ambos zerados. ──────
    await withTx(async () => {
      await comoLoja(STORE);
      const r = await callCreateOrder(
        { name: 'C1', phone: telefone() },
        { payment_method: 'cartao_credito', address: 'Retirada na loja', retirada: true, delivery_fee: 999, maquininha_fee: 999 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      let ok = res.ok;
      if (ok) { const o = await getOrder(res.order_id); ok = Number(o.delivery_fee) === 0 && Number(o.maquininha_fee) === 0 && Number(o.total) === 10.00; }
      check('Caso 1 — retirada com fees forjados (999/999) -> servidor grava 0/0', ok, JSON.stringify(res));
    });

    // ── Caso 2 — maquininha DESLIGADA no config + cartao + fee forjado -> 0. ────────────────────────
    await withTx(async () => {
      await client.query(`UPDATE public.store_settings SET valor = $2::text WHERE store_id = $1 AND chave = 'delivery_fee_config'`,
        [STORE, JSON.stringify({ version: 1, ativo: true, maquininha: { ativo: false, valor: 2.00 }, faixas: FAIXAS })]);
      await comoLoja(STORE);
      const r = await callCreateOrder(
        { name: 'C2', phone: telefone() },
        { payment_method: 'cartao_credito', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 0, maquininha_fee: 999 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      let ok = res.ok;
      if (ok) { const o = await getOrder(res.order_id); ok = Number(o.maquininha_fee) === 0; }
      check('Caso 2 — maquininha DESLIGADA + cartao + fee forjado (999) -> servidor grava 0', ok, JSON.stringify(res));
    });

    // ── Caso 3 — maquininha LIGADA + cartao debito + fee forjado pra 0 -> servidor grava o valor real (2.00). ──
    await withTx(async () => {
      await comoLoja(STORE);
      const r = await callCreateOrder(
        { name: 'C3', phone: telefone() },
        { payment_method: 'cartao_debito', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 0, maquininha_fee: 0 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      let ok = res.ok;
      if (ok) { const o = await getOrder(res.order_id); ok = Number(o.maquininha_fee) === 2.00; }
      check('Caso 3 — maquininha LIGADA + cartao_debito + fee forjado (0) -> servidor grava 2.00 (config real)', ok, JSON.stringify(res));
    });

    // ── Caso 4 — maquininha LIGADA + pagamento SEM cartao (pix) -> maquininha_fee=0 mesmo forjado. ──
    await withTx(async () => {
      await comoLoja(STORE);
      const r = await callCreateOrder(
        { name: 'C4', phone: telefone() },
        { payment_method: 'pix', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 0, maquininha_fee: 999 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      let ok = res.ok;
      if (ok) { const o = await getOrder(res.order_id); ok = Number(o.maquininha_fee) === 0; }
      check('Caso 4 — pagamento PIX (sem maquininha) + fee forjado (999) -> servidor grava 0', ok, JSON.stringify(res));
    });

    // ── Caso 5 — entrega, endereco PERTO (faixa 1), delivery_fee forjado pra 0 -> grava 10.00. ─────
    await withTx(async () => {
      await comoLoja(STORE);
      const r = await callCreateOrder(
        { name: 'C5', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 0, maquininha_fee: 0 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      let ok = res.ok;
      if (ok) { const o = await getOrder(res.order_id); ok = Number(o.delivery_fee) === 10.00 && Number(o.total) === 20.00; }
      check('Caso 5 — endereco PERTO (~0.9km, faixa1) + fee forjado (0) -> servidor grava 10.00', ok, JSON.stringify(res));
    });

    // ── Caso 6 — entrega, endereco LONGE (faixa 2), delivery_fee forjado pra 0 -> grava 20.00. ─────
    await withTx(async () => {
      await comoLoja(STORE);
      const r = await callCreateOrder(
        { name: 'C6', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Rua Longe, 2', endereco_id: END_LONGE, delivery_fee: 0, maquininha_fee: 0 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      let ok = res.ok;
      if (ok) { const o = await getOrder(res.order_id); ok = Number(o.delivery_fee) === 20.00; }
      check('Caso 6 — endereco LONGE (~9.7km, faixa2) + fee forjado (0) -> servidor grava 20.00', ok, JSON.stringify(res));
    });

    // ── Caso 6b — cliente tenta pagar MENOS num pedido LONGE (fee forjado pra baixo). ───────────────
    await withTx(async () => {
      await comoLoja(STORE);
      const r = await callCreateOrder(
        { name: 'C6b', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Rua Longe, 2', endereco_id: END_LONGE, delivery_fee: 1.00, maquininha_fee: 0 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      let ok = res.ok;
      if (ok) { const o = await getOrder(res.order_id); ok = Number(o.delivery_fee) === 20.00; } // NUNCA 1.00
      check('Caso 6b — endereco LONGE + client manda delivery_fee=1.00 -> servidor grava 20.00, nunca 1.00', ok, JSON.stringify(res));
    });

    // ── Caso 7 — endereco FORA DE ALCANCE (>10km) -> delivery_fee=0 (mesmo fallback do client). ────
    await withTx(async () => {
      await comoLoja(STORE);
      const r = await callCreateOrder(
        { name: 'C7', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Rua Fora, 3', endereco_id: END_FORA, delivery_fee: 999, maquininha_fee: 0 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      let ok = res.ok;
      if (ok) { const o = await getOrder(res.order_id); ok = Number(o.delivery_fee) === 0; }
      check('Caso 7 — endereco FORA DE ALCANCE (~58km) + fee forjado (999) -> servidor grava 0', ok, JSON.stringify(res));
    });

    // ── Caso 8 — entrega SEM endereco_id (null) -> delivery_fee=0 (decisao do dono, 2026-08-29). ───
    await withTx(async () => {
      await comoLoja(STORE);
      const r = await callCreateOrder(
        { name: 'C8', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Endereco so em texto, sem endereco_id', delivery_fee: 999, maquininha_fee: 0 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      let ok = res.ok;
      if (ok) { const o = await getOrder(res.order_id); ok = Number(o.delivery_fee) === 0; }
      check('Caso 8 — sem endereco_id (null) + fee forjado (999) -> servidor grava 0', ok, JSON.stringify(res));
    });

    // ── Caso 9 — endereco existe mas SEM lat/lng gravado (geocode falhou) -> delivery_fee=0. ───────
    await withTx(async () => {
      await comoLoja(STORE);
      const r = await callCreateOrder(
        { name: 'C9', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Rua Sem Coord, 4', endereco_id: END_SEM_COORD, delivery_fee: 999, maquininha_fee: 0 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      let ok = res.ok;
      if (ok) { const o = await getOrder(res.order_id); ok = Number(o.delivery_fee) === 0; }
      check('Caso 9 — endereco_id existe mas sem lat/lng gravado + fee forjado (999) -> servidor grava 0', ok, JSON.stringify(res));
    });

    // ── Caso 10 — endereco_id de OUTRA loja -> tratado como "sem coordenadas" (fee=0), anti-enumeracao. ──
    await withTx(async () => {
      await comoLoja(STORE);
      const r = await callCreateOrder(
        { name: 'C10', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Tentando usar endereco de outra loja', endereco_id: END_OUTRA_LOJA, delivery_fee: 999, maquininha_fee: 0 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      let ok = res.ok; // pedido nao e rejeitado -- so cai no fallback de sem-coordenadas
      if (ok) { const o = await getOrder(res.order_id); ok = Number(o.delivery_fee) === 0; }
      check('Caso 10 — endereco_id de OUTRA loja + fee forjado (999) -> tratado como sem-coordenadas, grava 0', ok, JSON.stringify(res));
    });

    // ── Caso 11 — cobranca automatica DESLIGADA no admin (config.ativo=false) -> delivery_fee=0
    // mesmo com endereco PERTO valido; maquininha continua independente. ───────────────────────────
    await withTx(async () => {
      await client.query(`UPDATE public.store_settings SET valor = $2::text WHERE store_id = $1 AND chave = 'delivery_fee_config'`,
        [STORE, JSON.stringify({ version: 1, ativo: false, maquininha: { ativo: true, valor: 2.00 }, faixas: FAIXAS })]);
      await comoLoja(STORE);
      const r = await callCreateOrder(
        { name: 'C11', phone: telefone() },
        { payment_method: 'cartao_debito', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 999, maquininha_fee: 0 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      let ok = res.ok;
      if (ok) { const o = await getOrder(res.order_id); ok = Number(o.delivery_fee) === 0 && Number(o.maquininha_fee) === 2.00; }
      check('Caso 11 — cobranca automatica DESLIGADA (config.ativo=false) -> delivery_fee=0, maquininha independente (2.00)', ok, JSON.stringify(res));
    });

    // ── Caso 12 — isolamento: OUTRA_LOJA nunca e afetada pelas mudancas de config feitas em STORE. ──
    await withTx(async () => {
      await client.query(
        `INSERT INTO public.store_settings (store_id, chave, valor) VALUES
           ($1,'company_info', $2::text),
           ($1,'delivery_fee_config', $3::text)`,
        [OUTRA_LOJA, JSON.stringify({ lojaLat: LOJA_LAT, lojaLng: LOJA_LNG }),
         JSON.stringify({ version: 1, ativo: true, maquininha: { ativo: true, valor: 5.00 }, faixas: [{ de: 0, ate: 5, valor: 99.00 }] })]
      );
      const prodOutra = randomUUID();
      await client.query(`INSERT INTO public.products (id, nome, preco, categoria_id, disponivel, store_id) VALUES ($1,'Produto Outra Loja',10.00,NULL,true,$2)`, [prodOutra, OUTRA_LOJA]);
      await comoLoja(OUTRA_LOJA);
      const r = await callCreateOrder(
        { name: 'C12', phone: telefone() },
        { payment_method: 'cartao_debito', address: 'Rua Outra Loja, 5', endereco_id: END_OUTRA_LOJA, delivery_fee: 0, maquininha_fee: 0 },
        [{ product_id: prodOutra, nome_produto: 'Produto Outra Loja', quantity: 1, price: 10.00, preco_unitario: 10.00 }], OUTRA_LOJA,
      );
      const res = r.rows[0].res;
      let ok = res.ok;
      if (ok) { const o = await getOrder(res.order_id); ok = Number(o.delivery_fee) === 99.00 && Number(o.maquininha_fee) === 5.00; }
      check('Caso 12 — isolamento: OUTRA_LOJA usa sua PROPRIA tabela (99.00/5.00), nunca a de STORE (10.00/2.00)', ok, JSON.stringify(res));
    });

    console.log(`\n${pass} passaram, ${fail} falharam.`);
  } finally {
    await client.query(`DELETE FROM public.orders WHERE store_id IN ($1,$2)`, [STORE, OUTRA_LOJA]);
    await client.query(`DELETE FROM public.customers WHERE store_id IN ($1,$2)`, [STORE, OUTRA_LOJA]);
    await client.query(`DELETE FROM public.addresses WHERE store_id IN ($1,$2)`, [STORE, OUTRA_LOJA]);
    await client.query(`DELETE FROM public.products WHERE store_id IN ($1,$2)`, [STORE, OUTRA_LOJA]);
    await client.query(`DELETE FROM public.store_settings WHERE store_id IN ($1,$2)`, [STORE, OUTRA_LOJA]);
    await client.query(`DELETE FROM public.stores WHERE id IN ($1,$2)`, [STORE, OUTRA_LOJA]);
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
