// REF-DELIVERY-FEE-05 · Ondas 1+2 -- valida contra o banco (E2E dedicado por padrao) real:
// (Onda 1) tabela comercial OFICIAL + fronteiras exatas + extrapolacao matematica acima de 20km +
// precisao/arredondamento (ambiguidade de ponto flutuante na fronteira sempre cai na MESMA faixa);
// (Onda 2) adicional de pagamento (+R$2,00 dinheiro/debito/credito, so' em entrega, nunca em
// retirada/PIX) coexistindo com maquininha_fee, autoritativo no servidor, divergencia em centavos,
// isolamento cross-tenant. Mesmo padrao de conexao pg direta + BEGIN...ROLLBACK dos scripts
// REF-DELIVERY-FEE-04 -- nunca toca producao nem Encanto/Aquarios reais quando apontado para
// db.e2e.env. Exit 0 = SUCCESS.
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

const telefone = () => `385${(n++).toString().padStart(8, '0')}`;

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
  // _resolve_delivery_fee NAO tem EXECUTE para anon/authenticated (REF-DELIVERY-FEE-04 Onda 3) --
  // chamamos como role de teste local (superuser da conexao) apenas para inspecionar o calculo puro,
  // sem passar por create_order/RLS. Nunca faca isso fora de um script de teste descartavel.
  const r = await client.query(
    `SELECT public._resolve_delivery_fee($1::uuid, $2::boolean, $3::text, $4::uuid) AS res`,
    [storeId, retirada, paymentMethod, enderecoId]
  );
  return r.rows[0].res;
}

// Loja em (-26.9000,-48.6000). Distancia Haversine ate' cada endereco calculada para bater
// EXATAMENTE nos casos de aceitacao (fronteiras + extrapolacao) -- coordenadas derivadas por
// deslocamento norte-sul puro (mesma longitude), onde 1 grau de latitude ~= 111.045km, entao
// deltaLat = km_alvo / 111.045.
const LOJA_LAT = -26.9000, LOJA_LNG = -48.6000;
const KM_POR_GRAU_LAT = 111.045;
const enderecoA = (km) => ({ lat: LOJA_LAT - km / KM_POR_GRAU_LAT, lng: LOJA_LNG });

const FAIXAS_OFICIAIS = [
  { de: 0.0, ate: 4.0, valor: 10.00 }, { de: 4.1, ate: 5.0, valor: 12.00 },
  { de: 5.1, ate: 7.0, valor: 14.00 }, { de: 7.1, ate: 8.0, valor: 16.00 },
  { de: 8.1, ate: 9.0, valor: 18.00 }, { de: 9.1, ate: 10.0, valor: 20.00 },
  { de: 10.1, ate: 11.0, valor: 22.00 }, { de: 11.1, ate: 12.0, valor: 24.00 },
  { de: 12.1, ate: 13.0, valor: 26.00 }, { de: 13.1, ate: 14.0, valor: 28.00 },
  { de: 14.1, ate: 15.0, valor: 30.00 }, { de: 15.1, ate: 16.0, valor: 32.00 },
  { de: 16.1, ate: 17.0, valor: 34.00 }, { de: 17.1, ate: 18.0, valor: 36.00 },
  { de: 18.1, ate: 19.0, valor: 38.00 }, { de: 19.1, ate: 20.0, valor: 40.00 },
];

async function main() {
  await client.connect();
  const STORE = randomUUID();
  const OUTRA_LOJA = randomUUID();
  const PROD = randomUUID();
  console.log('==========================================================================');
  console.log(` REF-DELIVERY-FEE-05 (Ondas 1+2) · tabela oficial+extrapolacao+adicional pagamento (${ENV_PATH.includes('db.env') ? 'PRODUCAO' : 'E2E'})`);
  console.log('==========================================================================\n');

  await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste DF05','ativo')`, [STORE, `delivery-fee-05-${Date.now()}`]);
  await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Outra Loja DF05','ativo')`, [OUTRA_LOJA, `delivery-fee-05-outra-${Date.now()}`]);
  await client.query(`INSERT INTO public.products (id, nome, preco, categoria_id, disponivel, store_id) VALUES ($1,'Produto Teste',10.00,NULL,true,$2)`, [PROD, STORE]);
  await client.query(
    `INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'company_info', $2::text), ($1,'delivery_fee_config', $3::text)`,
    [STORE, JSON.stringify({ lojaLat: LOJA_LAT, lojaLng: LOJA_LNG }),
     JSON.stringify({ version: 1, ativo: true, maquininha: { ativo: true, valor: 2.00 }, adicionalPagamento: { ativo: true, valor: 2.00 }, incrementoAcimaFaixas: 2.00, faixas: FAIXAS_OFICIAIS })]
  );

  // Um endereco por caso de aceitacao — todos ligados a STORE.
  const CASOS_FRONTEIRA = [
    ['4.0km', 4.0, 10.00], ['4.1km', 4.1, 12.00], ['5.0km', 5.0, 12.00], ['5.1km', 5.1, 14.00],
    ['7.0km', 7.0, 14.00], ['7.1km', 7.1, 16.00], ['8.0km', 8.0, 16.00],
    ['20.0km', 20.0, 40.00], ['20.1km', 20.1, 42.00], ['21.0km', 21.0, 42.00], ['21.1km', 21.1, 44.00],
    ['23.0km', 23.0, 46.00], ['25.0km', 25.0, 50.00],
    ['4.5km(aceitacao original)', 4.5, 12.00], ['5.7km(aceitacao original)', 5.7, 14.00],
  ];
  const enderecos = {};
  for (const [label, km] of CASOS_FRONTEIRA) {
    const id = randomUUID();
    const { lat, lng } = enderecoA(km);
    await client.query(`INSERT INTO public.addresses (id, store_id, rua, numero, latitude, longitude) VALUES ($1,$2,'Rua Teste','1',$3,$4)`, [id, STORE, lat, lng]);
    enderecos[label] = id;
  }
  const item = () => [{ product_id: PROD, nome_produto: 'Produto Teste', quantity: 1, price: 10.00, preco_unitario: 10.00 }];

  try {
    // ══ ONDA 1: tabela oficial + fronteiras + extrapolacao (via _resolve_delivery_fee direto) ══════
    for (const [label, km, esperado] of CASOS_FRONTEIRA) {
      await withTx(async () => {
        const res = await callResolveDeliveryFee(STORE, false, 'pix', enderecos[label]);
        check(`Onda1 · ${label} -> R$${esperado.toFixed(2)}`, Number(res.delivery_fee) === esperado, JSON.stringify(res));
      });
    }

    // ── Onda 1: precisao -- 2 pontos MUITO proximos da fronteira 21km (ambiguidade de ponto flutuante,
    // devem cair na MESMA faixa apos arredondamento de 1 casa decimal). ──────────────────────────────
    await withTx(async () => {
      const idA = randomUUID(), idB = randomUUID();
      const a = enderecoA(20.9999999); const b = enderecoA(21.0000001);
      await client.query(`INSERT INTO public.addresses (id, store_id, rua, numero, latitude, longitude) VALUES ($1,$3,'Rua A','1',$2,$4), ($5,$3,'Rua B','1',$6,$4)`,
        [idA, JSON.stringify(a.lat), STORE, a.lng, idB, b.lat]);
      const resA = await callResolveDeliveryFee(STORE, false, 'pix', idA);
      const resB = await callResolveDeliveryFee(STORE, false, 'pix', idB);
      check('Onda1 · ambiguidade de ponto flutuante (20.9999999 e 21.0000001) -> SEMPRE R$42 nos dois',
        Number(resA.delivery_fee) === 42.00 && Number(resB.delivery_fee) === 42.00, JSON.stringify({ resA, resB }));
    });

    // ── Onda 1: bounding box continua intacto (coordenada grosseiramente implausivel -> excecao). ───
    await withTx(async () => {
      const idLonge = randomUUID();
      const longe = enderecoA(500); // muito alem do bbox (max(ate)*3=60km)
      await client.query(`INSERT INTO public.addresses (id, store_id, rua, numero, latitude, longitude) VALUES ($1,$2,'Rua Longe','1',$3,$4)`, [idLonge, STORE, longe.lat, longe.lng]);
      let lancou = false;
      try { await callResolveDeliveryFee(STORE, false, 'pix', idLonge); }
      catch (e) { lancou = /implausiveis/.test(e.message); }
      check('Onda1 · bounding box intacto (500km -> excecao "coordenadas implausiveis")', lancou);
    });

    // ══ ONDA 2: adicional de pagamento -- matriz completa via create_order (fluxo real) ═════════════
    const enderecoPerto = enderecos['4.0km'];
    const matriz = [
      ['entrega+dinheiro', false, 'dinheiro', 10.00, 0, 2.00],
      ['entrega+debito',   false, 'cartao_debito', 10.00, 2.00, 2.00],
      ['entrega+credito',  false, 'cartao_credito', 10.00, 2.00, 2.00],
      ['entrega+pix',      false, 'pix', 10.00, 0, 0],
    ];
    for (const [label, retirada, pay, dExp, mExp, aExp] of matriz) {
      await withTx(async () => {
        await comoLoja(STORE);
        const r = await callCreateOrder(
          { name: label, phone: telefone() },
          { payment_method: pay, address: 'Rua Teste, 1', endereco_id: enderecoPerto, retirada,
            delivery_fee: dExp, maquininha_fee: mExp, adicional_pagamento_fee: aExp },
          item(), STORE,
        );
        const res = r.rows[0].res;
        let ok = res.ok === true && !res.divergencia_valor;
        if (ok) { const o = await getOrder(res.order_id); ok = Number(o.delivery_fee) === dExp && Number(o.maquininha_fee) === mExp && Number(o.adicional_pagamento_fee) === aExp; }
        check(`Onda2 · matriz ${label} -> delivery=${dExp} maquininha=${mExp} adicional=${aExp}`, ok, JSON.stringify(res));
      });
    }
    // Retirada: TODOS os metodos -> adicional 0 (mesmo dinheiro/cartao).
    for (const pay of ['dinheiro', 'cartao_debito', 'cartao_credito', 'pix']) {
      await withTx(async () => {
        await comoLoja(STORE);
        const r = await callCreateOrder(
          { name: `retirada+${pay}`, phone: telefone() },
          { payment_method: pay, address: 'Retirada na loja', retirada: true, delivery_fee: 0, maquininha_fee: 0, adicional_pagamento_fee: 0 },
          item(), STORE,
        );
        const res = r.rows[0].res;
        let ok = res.ok === true && !res.divergencia_valor;
        if (ok) { const o = await getOrder(res.order_id); ok = Number(o.adicional_pagamento_fee) === 0; }
        check(`Onda2 · retirada+${pay} -> adicional de pagamento sempre R$0`, ok, JSON.stringify(res));
      });
    }

    // ── Onda 2: adulteracao -- client declara adicional_pagamento_fee=0 numa entrega em dinheiro
    // (deveria ser 2.00) -> divergencia, nenhum pedido criado. ───────────────────────────────────────
    await withTx(async () => {
      await comoLoja(STORE);
      const antes = (await client.query(`SELECT count(*)::int n FROM public.orders WHERE store_id=$1`, [STORE])).rows[0].n;
      const r = await callCreateOrder(
        { name: 'adulterado1', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Rua Teste, 1', endereco_id: enderecoPerto, delivery_fee: 10.00, maquininha_fee: 0, adicional_pagamento_fee: 0 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      const depois = (await client.query(`SELECT count(*)::int n FROM public.orders WHERE store_id=$1`, [STORE])).rows[0].n;
      const ok = res.ok === false && res.divergencia_valor === true && Number(res.adicional_pagamento_fee) === 2.00 && depois === antes;
      check('Onda2 · client declara adicional_pagamento_fee=0 (real=2.00) -> divergencia, nenhum pedido criado', ok, JSON.stringify(res));
    });
    // ── Onda 2: adulteracao -- client declara adicional_pagamento_fee=2.00 numa RETIRADA (deveria ser 0). ──
    await withTx(async () => {
      await comoLoja(STORE);
      const r = await callCreateOrder(
        { name: 'adulterado2', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Retirada na loja', retirada: true, delivery_fee: 0, maquininha_fee: 0, adicional_pagamento_fee: 2.00 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      const ok = res.ok === false && res.divergencia_valor === true && Number(res.adicional_pagamento_fee) === 0;
      check('Onda2 · client declara adicional_pagamento_fee=2.00 numa RETIRADA (real=0) -> divergencia', ok, JSON.stringify(res));
    });
    // ── Onda 2: chamador legado que NUNCA declara o campo -> sem divergencia, servidor persiste o autoritativo. ──
    await withTx(async () => {
      await comoLoja(STORE);
      const r = await callCreateOrder(
        { name: 'legado', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Rua Teste, 1', endereco_id: enderecoPerto, delivery_fee: 10.00, maquininha_fee: 0 }, // sem adicional_pagamento_fee no payload
        item(), STORE,
      );
      const res = r.rows[0].res;
      let ok = res.ok === true && !res.divergencia_valor;
      if (ok) { const o = await getOrder(res.order_id); ok = Number(o.adicional_pagamento_fee) === 2.00; }
      check('Onda2 · chamador legado sem o campo -> sem divergencia, servidor persiste autoritativo (2.00)', ok, JSON.stringify(res));
    });

    // ── Onda 2: cross-tenant -- OUTRA_LOJA com adicionalPagamento diferente (R$5,00) nunca usa o R$2 de STORE. ──
    await withTx(async () => {
      const prodOutra = randomUUID();
      const endOutra = randomUUID();
      await client.query(
        `INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'company_info', $2::text), ($1,'delivery_fee_config', $3::text)`,
        [OUTRA_LOJA, JSON.stringify({ lojaLat: LOJA_LAT, lojaLng: LOJA_LNG }),
         JSON.stringify({ version: 1, ativo: true, maquininha: { ativo: false, valor: 0 }, adicionalPagamento: { ativo: true, valor: 5.00 }, incrementoAcimaFaixas: 2.00, faixas: [{ de: 0, ate: 20, valor: 30.00 }] })]
      );
      await client.query(`INSERT INTO public.products (id, nome, preco, categoria_id, disponivel, store_id) VALUES ($1,'Produto Outra',10.00,NULL,true,$2)`, [prodOutra, OUTRA_LOJA]);
      await client.query(`INSERT INTO public.addresses (id, store_id, rua, numero, latitude, longitude) VALUES ($1,$2,'Rua Outra','1',$3,$4)`, [endOutra, OUTRA_LOJA, LOJA_LAT - 1/KM_POR_GRAU_LAT, LOJA_LNG]);
      await comoLoja(OUTRA_LOJA);
      const r = await callCreateOrder(
        { name: 'cross-tenant', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Rua Outra, 1', endereco_id: endOutra, delivery_fee: 10.00, maquininha_fee: 0, adicional_pagamento_fee: 2.00 }, // valores de STORE, nao de OUTRA_LOJA
        [{ product_id: prodOutra, nome_produto: 'Produto Outra', quantity: 1, price: 10.00, preco_unitario: 10.00 }], OUTRA_LOJA,
      );
      const res = r.rows[0].res;
      const ok = res.ok === false && res.divergencia_valor === true && Number(res.delivery_fee) === 30.00 && Number(res.adicional_pagamento_fee) === 5.00;
      check('Onda2 · cross-tenant: OUTRA_LOJA usa sua PRÓPRIA config (30.00/5.00), nunca a de STORE (10.00/2.00)', ok, JSON.stringify(res));
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
