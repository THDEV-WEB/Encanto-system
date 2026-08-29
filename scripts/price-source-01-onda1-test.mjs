// REF-PRICE-SOURCE-01 · Onda 1 -- valida que create_order() calcula o preco AUTORITATIVO no servidor
// (nunca confia em price/preco_unitario/total enviados pelo client) contra o projeto Supabase DEDICADO
// a E2E (nunca producao -- conexao so' de db.e2e.env, mesmo padrao de scripts/e2e-seed.mjs). Cada caso
// roda dentro de BEGIN...ROLLBACK -- nenhuma escrita e persistida. Mesmo padrao de simulacao de
// contexto (SET LOCAL request.jwt.claims/request.headers) ja usado por
// scripts/prod-golive-01-tenant-fix-test.mjs. Exit 0 = SUCCESS.
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

const ENCANTO       = 'be2efc10-c0c8-410f-bcd4-af3f8a371df3';
const BAR           = '99999999-9999-4999-8999-999999999998';
const PROD_MARMITA_P = '10000000-0000-4000-8000-000000000001'; // preco real no banco: 15.99

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
// autenticado com tenant_id=ENCANTO assinado -- mesma fonte confiavel usada nos demais testes deste
// projeto (REF-AUTH-TENANT-01/REF-ORDER-TENANT-01); nao depende de resolucao por Origin, que nao e o
// alvo desta REF (ja auditada/testada em outras).
async function comoEncanto() { await setJwt(randomUUID(), ENCANTO); }

const telefone = () => `389${(n++).toString().padStart(8, '0')}`;

function callCreateOrder(customer, order, items, storeId = ENCANTO) {
  return client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS res`,
    [JSON.stringify(customer), JSON.stringify(order), JSON.stringify(items), storeId]
  );
}
async function getOrderItem(orderId) {
  const r = await client.query(`SELECT price, preco_unitario, adicionais, quantity FROM public.order_items WHERE order_id = $1`, [orderId]);
  return r.rows[0];
}
async function getOrder(orderId) {
  const r = await client.query(`SELECT total FROM public.orders WHERE id = $1`, [orderId]);
  return r.rows[0];
}

async function main() {
  await client.connect();

  // ── Caso 1 — preco normal: client manda exatamente o preco real -- aceito, sem surpresa. ──────────
  await withTx(async () => {
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste C1', phone: p },
      { total: 15.99, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: PROD_MARMITA_P, nome_produto: 'Marmita P', quantity: 1, price: 15.99, preco_unitario: 15.99 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) {
      const item = await getOrderItem(res.order_id);
      const order = await getOrder(res.order_id);
      ok = Number(item.price) === 15.99 && Number(item.preco_unitario) === 15.99 && Number(order.total) === 15.99;
    }
    check('Caso 1 — preco normal (client=banco=15.99) -> aceito com 15.99', ok, JSON.stringify(res));
  });

  // ── Caso 2 — client tenta pagar MENOS. ──────────────────────────────────────────────────────────
  await withTx(async () => {
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste C2', phone: p },
      { total: 1.00, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: PROD_MARMITA_P, nome_produto: 'Marmita P', quantity: 1, price: 1.00, preco_unitario: 1.00 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) {
      const item = await getOrderItem(res.order_id);
      const order = await getOrder(res.order_id);
      ok = Number(item.price) === 15.99 && Number(order.total) === 15.99; // NUNCA 1.00
    }
    check('Caso 2 — client manda price=1.00 (banco=15.99) -> servidor grava 15.99, nunca 1.00', ok, JSON.stringify(res));
  });

  // ── Caso 3 — client tenta pagar MAIS. ───────────────────────────────────────────────────────────
  await withTx(async () => {
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste C3', phone: p },
      { total: 99.90, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: PROD_MARMITA_P, nome_produto: 'Marmita P', quantity: 1, price: 99.90, preco_unitario: 99.90 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) {
      const item = await getOrderItem(res.order_id);
      const order = await getOrder(res.order_id);
      ok = Number(item.price) === 15.99 && Number(order.total) === 15.99; // NUNCA 99.90
    }
    check('Caso 3 — client manda price=99.90 (banco=15.99) -> servidor grava 15.99, nunca 99.90', ok, JSON.stringify(res));
  });

  // ── Caso 4 — preco negativo/zero enviado pelo client, com product_id valido. ───────────────────────
  await withTx(async () => {
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste C4a', phone: p },
      { total: -5, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: PROD_MARMITA_P, nome_produto: 'Marmita P', quantity: 1, price: -5, preco_unitario: -5 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) {
      const item = await getOrderItem(res.order_id);
      ok = Number(item.price) === 15.99; // preco negativo do client e' irrelevante -- servidor recalcula
    }
    check('Caso 4a — price=-5 do client (com product_id) -> irrelevante, servidor usa 15.99', ok, JSON.stringify(res));
  });
  await withTx(async () => {
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste C4b', phone: p },
      { total: 0, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: PROD_MARMITA_P, nome_produto: 'Marmita P', quantity: 1, price: 0, preco_unitario: 0 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) {
      const item = await getOrderItem(res.order_id);
      ok = Number(item.price) === 15.99;
    }
    check('Caso 4b — price=0 do client (com product_id) -> irrelevante, servidor usa 15.99', ok, JSON.stringify(res));
  });

  // ── Caso 5 — produto inexistente. ───────────────────────────────────────────────────────────────
  await withTx(async () => {
    await comoEncanto();
    const p = telefone();
    const fakeId = randomUUID();
    const r = await callCreateOrder(
      { name: 'Teste C5', phone: p },
      { total: 15.99, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: fakeId, nome_produto: 'Produto Fantasma', quantity: 1, price: 15.99, preco_unitario: 15.99 }],
    );
    const res = r.rows[0].res;
    check('Caso 5 — product_id inexistente -> rejeitado (produto invalido)', res.ok === false && res.error === 'produto invalido', JSON.stringify(res));
  });

  // ── Caso 6 — produto de OUTRO tenant (BAR) usado num pedido da ENCANTO. ─────────────────────────
  await withTx(async () => {
    const prodBar = randomUUID();
    await client.query(
      `INSERT INTO public.products (id, nome, preco, categoria_id, disponivel, store_id) VALUES ($1,'Produto do Bar', 50.00, NULL, true, $2)`,
      [prodBar, BAR]
    );
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste C6', phone: p },
      { total: 50.00, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: prodBar, nome_produto: 'Produto do Bar', quantity: 1, price: 50.00, preco_unitario: 50.00 }],
    );
    const res = r.rows[0].res;
    check('Caso 6 — produto de OUTRA loja (BAR) num pedido da ENCANTO -> rejeitado', res.ok === false && res.error === 'produto invalido', JSON.stringify(res));
  });

  // ── Caso 7 — produto com tamanhos: servidor usa o preco do TAMANHO selecionado, nunca o base nem o do client. ──
  await withTx(async () => {
    const prodTam = randomUUID();
    await client.query(
      `INSERT INTO public.products (id, nome, preco, tamanhos, categoria_id, disponivel, store_id)
       VALUES ($1,'Acai Teste', 17.90, $2::jsonb, NULL, true, $3)`,
      [prodTam, JSON.stringify([{ label: '300 ml', preco: 17.90 }, { label: '500 ml', preco: 26.90 }, { label: '700 ml', preco: 35.90 }]), ENCANTO]
    );
    await comoEncanto();
    const p = telefone();
    // client escolheu 500ml na UI mas manda price=1.00 (tentativa de manipulacao)
    const r = await callCreateOrder(
      { name: 'Teste C7', phone: p },
      { total: 1.00, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: prodTam, tamanho_label: '500 ml', nome_produto: 'Acai Teste', quantity: 1, price: 1.00, preco_unitario: 1.00 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) {
      const item = await getOrderItem(res.order_id);
      const order = await getOrder(res.order_id);
      ok = Number(item.price) === 26.90 && Number(order.total) === 26.90; // preco do tamanho 500ml, nao 17.90 (base) nem 1.00 (client)
    }
    check('Caso 7 — produto com tamanhos: tamanho_label=500ml -> servidor usa 26.90 (nunca base 17.90 nem client=1.00)', ok, JSON.stringify(res));
  });
  await withTx(async () => {
    // fallback: tamanho_label ausente -> servidor cai no 1o tamanho (mesmo fallback do client).
    const prodTam = randomUUID();
    await client.query(
      `INSERT INTO public.products (id, nome, preco, tamanhos, categoria_id, disponivel, store_id)
       VALUES ($1,'Acai Teste 2', 17.90, $2::jsonb, NULL, true, $3)`,
      [prodTam, JSON.stringify([{ label: '300 ml', preco: 17.90 }, { label: '500 ml', preco: 26.90 }]), ENCANTO]
    );
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste C7b', phone: p },
      { total: 17.90, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: prodTam, nome_produto: 'Acai Teste 2', quantity: 1, price: 17.90, preco_unitario: 17.90 }], // sem tamanho_label
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) {
      const item = await getOrderItem(res.order_id);
      ok = Number(item.price) === 17.90; // 1o tamanho
    }
    check('Caso 7b — tamanho_label ausente -> servidor cai no 1º tamanho (300ml=17.90)', ok, JSON.stringify(res));
  });

  // ── Caso 8 — promocao: preco_promo vence sobre preco cheio, e o client nao pode inflar/reduzir. ──
  await withTx(async () => {
    const prodPromo = randomUUID();
    await client.query(
      `INSERT INTO public.products (id, nome, preco, preco_promo, categoria_id, disponivel, store_id) VALUES ($1,'Combo Promo', 29.90, 24.90, NULL, true, $2)`,
      [prodPromo, ENCANTO]
    );
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste C8', phone: p },
      { total: 1.00, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: prodPromo, nome_produto: 'Combo Promo', quantity: 1, price: 1.00, preco_unitario: 1.00 }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) {
      const item = await getOrderItem(res.order_id);
      ok = Number(item.price) === 24.90; // preco_promo, nunca 29.90 (cheio) nem 1.00 (client)
    }
    check('Caso 8 — promoção: preco_promo=24.90 vence sobre preco cheio 29.90 e sobre o que o client mandou', ok, JSON.stringify(res));
  });

  // ── Caso 9 — adicionais: franquia gratis + pago, preco vem SEMPRE da tabela, nunca do payload. ──
  await withTx(async () => {
    const prodAd = randomUUID();
    const ad1 = randomUUID(), ad2 = randomUUID(), ad3 = randomUUID();
    await client.query(`INSERT INTO public.products (id, nome, preco, adicionais_gratis, categoria_id, disponivel, store_id) VALUES ($1,'Acai c/ Adicionais', 20.00, 2, NULL, true, $2)`, [prodAd, ENCANTO]);
    await client.query(`INSERT INTO public.adicionais (id, nome, grupo, tipo, preco, ativo, store_id) VALUES ($1,'Banana Teste','acai','gratis',0,true,$2)`, [ad1, ENCANTO]);
    await client.query(`INSERT INTO public.adicionais (id, nome, grupo, tipo, preco, ativo, store_id) VALUES ($1,'Granola Teste','acai','gratis',0,true,$2)`, [ad2, ENCANTO]);
    await client.query(`INSERT INTO public.adicionais (id, nome, grupo, tipo, preco, ativo, store_id) VALUES ($1,'Nutella Teste','acai','pago',8.00,true,$2)`, [ad3, ENCANTO]);
    await comoEncanto();
    const p = telefone();
    // client manda preco MENTIROSO em cada adicional (tentativa de manipulacao) — servidor deve ignorar.
    const r = await callCreateOrder(
      { name: 'Teste C9', phone: p },
      { total: 1.00, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: prodAd, nome_produto: 'Acai c/ Adicionais', quantity: 1, price: 1.00, preco_unitario: 1.00,
         adicionais: [{ id: ad1, nome: 'Banana Teste', preco: 999 }, { id: ad2, nome: 'Granola Teste', preco: 999 }, { id: ad3, nome: 'Nutella Teste', preco: 0.01 }] }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    let adsPersistidos = null;
    if (ok) {
      const item = await getOrderItem(res.order_id);
      adsPersistidos = item.adicionais;
      // base 20.00 + Banana(0, dentro da cota) + Granola(0, dentro da cota) + Nutella(8.00, pago sempre) = 28.00
      ok = Number(item.price) === 28.00
        && adsPersistidos.find(a => a.id === ad1)?.preco === 0
        && adsPersistidos.find(a => a.id === ad2)?.preco === 0
        && adsPersistidos.find(a => a.id === ad3)?.preco === 8.00;
    }
    check('Caso 9 — adicionais: preco vem da tabela (20+0+0+8=28.00), nunca dos valores mentirosos do payload', ok, JSON.stringify(res) + ' ads=' + JSON.stringify(adsPersistidos));
  });
  await withTx(async () => {
    // excedente da franquia gratis: cota=1, 2 adicionais "tipo gratis" selecionados -> o 2º vira excedente (ADICIONAL_SIMPLES_PRECO=2.00, pois preco=0 na tabela).
    const prodAd = randomUUID();
    const ad1 = randomUUID(), ad2 = randomUUID();
    await client.query(`INSERT INTO public.products (id, nome, preco, adicionais_gratis, categoria_id, disponivel, store_id) VALUES ($1,'Acai Cota1', 10.00, 1, NULL, true, $2)`, [prodAd, ENCANTO]);
    await client.query(`INSERT INTO public.adicionais (id, nome, grupo, tipo, preco, ativo, store_id) VALUES ($1,'Ad Gratis A','acai','gratis',0,true,$2)`, [ad1, ENCANTO]);
    await client.query(`INSERT INTO public.adicionais (id, nome, grupo, tipo, preco, ativo, store_id) VALUES ($1,'Ad Gratis B','acai','gratis',0,true,$2)`, [ad2, ENCANTO]);
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste C9b', phone: p },
      { total: 10.00, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: prodAd, nome_produto: 'Acai Cota1', quantity: 1, price: 10.00, preco_unitario: 10.00,
         adicionais: [{ id: ad1, nome: 'Ad Gratis A', preco: 0 }, { id: ad2, nome: 'Ad Gratis B', preco: 0 }] }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) {
      const item = await getOrderItem(res.order_id);
      // base 10.00 + 1º grátis (dentro da cota=1, custa 0) + 2º grátis (excedente, custa ADICIONAL_SIMPLES_PRECO=2.00) = 12.00
      ok = Number(item.price) === 12.00;
    }
    check('Caso 9b — franquia grátis excedente: cota=1, 2 selecionados -> 10.00+0+2.00=12.00 (ADICIONAL_SIMPLES_PRECO)', ok, JSON.stringify(res));
  });
  await withTx(async () => {
    // dedupe: mesmo id de adicional 2x no payload -> conta 1x so'.
    const prodAd = randomUUID();
    const ad1 = randomUUID();
    await client.query(`INSERT INTO public.products (id, nome, preco, adicionais_gratis, categoria_id, disponivel, store_id) VALUES ($1,'Acai Dedupe', 10.00, 0, NULL, true, $2)`, [prodAd, ENCANTO]);
    await client.query(`INSERT INTO public.adicionais (id, nome, grupo, tipo, preco, ativo, store_id) VALUES ($1,'Ad Pago Dedupe','acai','pago',5.00,true,$2)`, [ad1, ENCANTO]);
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste C9c', phone: p },
      { total: 10.00, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: prodAd, nome_produto: 'Acai Dedupe', quantity: 1, price: 10.00, preco_unitario: 10.00,
         adicionais: [{ id: ad1, nome: 'x', preco: 5 }, { id: ad1, nome: 'x', preco: 5 }, { id: ad1, nome: 'x', preco: 5 }] }],
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) {
      const item = await getOrderItem(res.order_id);
      ok = Number(item.price) === 15.00 && item.adicionais.length === 1; // 10.00 + 5.00 (1x, nao 3x)
    }
    check('Caso 9c — mesmo adicional enviado 3x no payload -> conta 1x só (dedupe, 10+5=15.00)', ok, JSON.stringify(res));
  });
  await withTx(async () => {
    // adicional inexistente/de outra loja -> pedido inteiro rejeitado.
    const prodAd = randomUUID();
    const adOutraLoja = randomUUID();
    await client.query(`INSERT INTO public.products (id, nome, preco, categoria_id, disponivel, store_id) VALUES ($1,'Acai AdInvalido', 10.00, NULL, true, $2)`, [prodAd, ENCANTO]);
    await client.query(`INSERT INTO public.adicionais (id, nome, grupo, tipo, preco, ativo, store_id) VALUES ($1,'Ad do Bar','acai','pago',5.00,true,$2)`, [adOutraLoja, BAR]);
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste C9d', phone: p },
      { total: 15.00, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ product_id: prodAd, nome_produto: 'Acai AdInvalido', quantity: 1, price: 15.00, preco_unitario: 15.00,
         adicionais: [{ id: adOutraLoja, nome: 'Ad do Bar', preco: 5 }] }],
    );
    const res = r.rows[0].res;
    check('Caso 9d — adicional de OUTRA loja -> pedido inteiro rejeitado (adicional invalido)', res.ok === false && res.error === 'adicional invalido', JSON.stringify(res));
  });

  // ── Caso 10 — adulteração simultânea de price + preco_unitario + total. ────────────────────────
  await withTx(async () => {
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste C10', phone: p },
      { total: 1.00, payment_method: 'dinheiro', address: 'Rua Teste, 1' }, // total mentiroso
      [{ product_id: PROD_MARMITA_P, nome_produto: 'Marmita P', quantity: 1, price: 1.00, preco_unitario: 1.00 }], // price/preco_unitario mentirosos
    );
    const res = r.rows[0].res;
    let ok = res.ok;
    if (ok) {
      const item = await getOrderItem(res.order_id);
      const order = await getOrder(res.order_id);
      ok = Number(item.price) === 15.99 && Number(item.preco_unitario) === 15.99 && Number(order.total) === 15.99;
    }
    check('Caso 10 — price+preco_unitario+total adulterados simultaneamente -> servidor determina tudo (15.99)', ok, JSON.stringify(res));
  });

  // ── SUPERSEDIDO PELA ONDA 2 (REF-PRICE-SOURCE-01-onda2-exige-product-id.sql) ──────────────────────
  // Ate a Onda 1, item SEM product_id preservava o comportamento legado (confiava no price do client)
  // -- decisao consciente para nao quebrar scripts/saas01-onda4-1-pedidos-test.mjs e
  // scripts/harden-orders-rls-test.mjs, na epoca. A Onda 2 investigou esse caminho (mockCatalog.js) e
  // provou, com teste Playwright real, que ele permitia um PEDIDO REAL com preco do MOCK -- fechado:
  // agora TODO item exige product_id valido, sem excecao (os 2 scripts acima foram adaptados para usar
  // produto real). Ver scripts/price-source-01-onda2-test.mjs para a suite completa da Onda 2.
  await withTx(async () => {
    await comoEncanto();
    const p = telefone();
    const r = await callCreateOrder(
      { name: 'Teste Sem ProductId', phone: p },
      { total: 33.00, payment_method: 'dinheiro', address: 'Rua Teste, 1' },
      [{ nome_produto: 'Item Avulso Sem Catalogo', quantity: 1, price: 33.00, preco_unitario: 33.00 }], // sem product_id
    );
    const res = r.rows[0].res;
    check('Onda 2 fechou o legado — item SEM product_id agora e REJEITADO (nunca mais confia no price do client)', res.ok === false && res.error === 'item "Item Avulso Sem Catalogo" sem produto valido', JSON.stringify(res));
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
