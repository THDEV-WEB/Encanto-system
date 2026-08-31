// REF-ADDRESS-GEO-INTEGRITY-01 · Onda 3 -- prova de INTEGRACAO: uma unica sequencia de chamadas a
// create_order() que forca as 8 propriedades pedidas a coexistirem na MESMA versao da funcao,
// dentro do MESMO cenario (nao 8 suites separadas provando 1 coisa cada -- isso ja existe em
// delivery-fee-04/price-source-01/price-hardening-01/address-geo-integrity-01-onda2). Projeto E2E
// dedicado, BEGIN...ROLLBACK, dados descartaveis. Exit 0 = SUCCESS.
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
async function setJwt(sub, tenantId) {
  const claims = { ...(sub ? { sub } : {}), ...(tenantId ? { tenant_id: tenantId } : {}) };
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
}
const telefone = () => `397${(n++).toString().padStart(8, '0')}`;
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
const LOJA_Y_LAT = -23.5500, LOJA_Y_LNG = -46.6300; // Sao Paulo -- bem longe de X, prova isolamento
const PERTO_X_LAT = -26.9060, PERTO_X_LNG = -48.6060;   // ~0.9km de X -> faixa 1
const PERTO_Y_LAT = -23.5560, PERTO_Y_LNG = -46.6360;   // ~0.9km de Y -> faixa 1 (config DIFERENTE)

async function main() {
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, current_database() AS db")).rows[0];
  console.log(`Conectado como ${meta.who} em ${meta.db} (projeto E2E dedicado, nunca producao)\n`);
  console.log('==========================================================================');
  console.log(' REF-ADDRESS-GEO-INTEGRITY-01 · Onda 3 -- INTEGRACAO (8 propriedades juntas)');
  console.log('==========================================================================\n');

  const authUsers = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 2')).rows;
  if (authUsers.length < 2) { console.error('Precisa de >=2 usuarios em auth.users no E2E.'); process.exit(2); }
  const [AUTH_C, AUTH_D] = authUsers.map(r => r.id);

  await client.query('BEGIN');
  try {
    const STORE_X = randomUUID(), STORE_Y = randomUUID();
    const PROD_X = randomUUID(), PROD_Y = randomUUID();

    await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja X Integracao','ativo'), ($3,$4,'Loja Y Integracao','ativo')`,
      [STORE_X, `integ-x-${randomUUID()}`, STORE_Y, `integ-y-${randomUUID()}`]);
    await client.query(`INSERT INTO public.products (id, nome, preco, disponivel, store_id) VALUES ($1,'Produto X',18.50,true,$2), ($3,'Produto Y',30.00,true,$4)`,
      [PROD_X, STORE_X, PROD_Y, STORE_Y]);
    await client.query(
      `INSERT INTO public.store_settings (store_id, chave, valor) VALUES
         ($1,'company_info',$2::text), ($1,'delivery_fee_config',$3::text), ($1,'loyalty_enabled','true'), ($1,'loyalty_required','10'),
         ($4,'company_info',$5::text), ($4,'delivery_fee_config',$6::text)`,
      [STORE_X, JSON.stringify({ lojaLat: LOJA_X_LAT, lojaLng: LOJA_X_LNG }),
       JSON.stringify({ version: 1, ativo: true, maquininha: { ativo: false, valor: 0 }, faixas: [{ de: 0, ate: 5, valor: 9.00 }] }),
       STORE_Y, JSON.stringify({ lojaLat: LOJA_Y_LAT, lojaLng: LOJA_Y_LNG }),
       JSON.stringify({ version: 1, ativo: true, maquininha: { ativo: false, valor: 0 }, faixas: [{ de: 0, ate: 5, valor: 40.00 }] })] // config BEM diferente
    );

    // Telefone FIXO por customer, reutilizado em toda chamada a create_order relacionada -- o
    // upsert por (store_id,phone) dentro de create_order precisa resolver sempre o MESMO
    // customer_id ja' criado aqui (o mesmo dono do endereco), senao loyalty_events conta pro
    // customer errado (upsert cria um novo customer a cada telefone novo).
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

    // ═══ CHAMADA 1 — D tenta pedido com: endereco de OUTRO customer (C) + delivery_fee forjado +
    // item com price forjado. Prova numa unica chamada: OWNERSHIP (endereco de C e' rejeitado, nao
    // vinculado a D) + DELIVERY_FEE AUTORITATIVO (sem endereco valido -> autoritativo=0) +
    // DIVERGENCIA (D declarou 15.00, autoritativo e' 0 -> rejeita, nenhum pedido criado) — o preco
    // forjado do item nunca chega a ser avaliado porque a divergencia intercepta ANTES do loop de
    // itens (ordem real do corpo de create_order), mas a REJEICAO em si so' acontece por causa do
    // ownership ter zerado o endereco -- efeito em cadeia das duas protecoes.
    await setJwt(AUTH_D, STORE_X);
    const r1 = await callCreateOrder(
      { name: 'Customer D', phone: phoneD },
      { payment_method: 'dinheiro', address: 'Tentando endereco de C', endereco_id: endC, delivery_fee: 15.00 },
      [{ product_id: PROD_X, nome_produto: 'Produto X', quantity: 1, price: 0.01 }],
      STORE_X, REQ1
    );
    const res1 = r1.rows[0].res;
    check('1a — OWNERSHIP+DELIVERY_FEE+DIVERGENCIA juntos: endereco de C rejeitado -> autoritativo=0 -> D declarou 15 -> diverge, ok:false, NENHUM pedido criado',
      res1.ok === false && res1.divergencia_valor === true && Number(res1.delivery_fee) === 0, JSON.stringify(res1));

    // ═══ CHAMADA 2 (MESMO request_id) — D corrige: usa o PROPRIO endereco (dentro do bbox, faixa
    // paga real), declara o delivery_fee autoritativo correto (sem divergencia), mas AINDA manda
    // price forjado no item. Prova: BOUNDING BOX (distancia calculada corretamente dentro do raio,
    // faixa real aplicada) + OWNERSHIP (proprio endereco aceito) + PRECO AUTORITATIVO (0.01 forjado
    // ignorado, banco usa 18.50) + FIDELIDADE (loyalty_event so' agora, nunca na tentativa 1).
    const antesLoyalty = await countLoyaltyEvents(CUSTOMER_D);
    const r2 = await callCreateOrder(
      { name: 'Customer D', phone: phoneD },
      { payment_method: 'dinheiro', address: 'Rua de D, 2', endereco_id: endD, delivery_fee: 9.00 },
      [{ product_id: PROD_X, nome_produto: 'Produto X', quantity: 1, price: 0.01 }],
      STORE_X, REQ1
    );
    const res2 = r2.rows[0].res;
    check('2a — BBOX+OWNERSHIP+DELIVERY_FEE: proprio endereco (dentro do bbox) aceito, delivery_fee=9.00 (faixa real)',
      res2.ok === true, JSON.stringify(res2));
    const ord2 = res2.ok ? await getOrder(res2.order_id) : null;
    check('2b — endereco_id vinculado = o PROPRIO de D (ownership aceitou)', ord2?.endereco_id === endD);
    check('2c — delivery_fee persistido = 9.00 (bbox+faixa corretos)', Number(ord2?.delivery_fee) === 9.00);
    const precoItem = res2.ok ? await countOrderItemPrice(res2.order_id) : null;
    check('2d — PRECO AUTORITATIVO: price forjado (0.01) ignorado, banco gravou 18.50', precoItem === 18.50, `gravado=${precoItem}`);
    const depoisLoyalty = await countLoyaltyEvents(CUSTOMER_D);
    check('2e — FIDELIDADE: 0 loyalty_events na tentativa 1 (divergente), exatamente +1 na confirmada', antesLoyalty === 0 && depoisLoyalty === 1, `antes=${antesLoyalty} depois=${depoisLoyalty}`);

    // ═══ CHAMADA 3 (retry, MESMO request_id) — prova IDEMPOTENCIA: mesmo order_id, idempotent:true,
    // nenhuma duplicata de pedido nem de loyalty_event.
    const r3 = await callCreateOrder(
      { name: 'Customer D', phone: phoneD },
      { payment_method: 'dinheiro', address: 'Rua de D, 2', endereco_id: endD, delivery_fee: 9.00 },
      [{ product_id: PROD_X, nome_produto: 'Produto X', quantity: 1, price: 0.01 }],
      STORE_X, REQ1
    );
    const res3 = r3.rows[0].res;
    check('3a — IDEMPOTENCIA: retry mesmo request_id -> idempotent:true, mesmo order_id', res3.ok === true && res3.idempotent === true && res3.order_id === res2.order_id, JSON.stringify(res3));
    const loyaltyAposRetry = await countLoyaltyEvents(CUSTOMER_D);
    check('3b — IDEMPOTENCIA: retry NAO gera 2o loyalty_event', loyaltyAposRetry === 1, `count=${loyaltyAposRetry}`);

    // ═══ CHAMADA 4 — MESMA distancia relativa (~0.9km da propria loja), mas na LOJA Y (config
    // BEM diferente, faixa R$40 em vez de R$9). Prova ISOLAMENTO MULTI-TENANT: o bbox e a faixa
    // aplicada dependem exclusivamente da config da loja Y, nunca vazam nada de X.
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
    check('4a — ISOLAMENTO MULTI-TENANT: mesma distancia relativa, loja Y com config propria cobra R$40 (nao R$9 de X)', res4.ok === true && Number(ord4?.delivery_fee) === 40.00, JSON.stringify(res4));

    // Endereco de X (endD) usado numa chamada para a loja Y -- deve ser rejeitado (store_id nao bate).
    const r4b = await callCreateOrder(
      { name: 'Customer C em Y', phone: telefone() },
      { payment_method: 'dinheiro', address: 'Tentando endereco de X em Y', endereco_id: endD, delivery_fee: 999 },
      [{ product_id: PROD_Y, nome_produto: 'Produto Y', quantity: 1, price: 30 }],
      STORE_Y, randomUUID()
    );
    const res4b = r4b.rows[0].res;
    check('4b — ISOLAMENTO: endereco de X usado em pedido de Y -> rejeitado (store_id nao bate), autoritativo=0, diverge',
      res4b.ok === false && res4b.divergencia_valor === true && Number(res4b.delivery_fee) === 0, JSON.stringify(res4b));

    console.log(`\n${pass} passaram, ${fail} falharam.`);
  } finally {
    await client.query('ROLLBACK');
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
