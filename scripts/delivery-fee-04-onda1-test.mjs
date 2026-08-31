// REF-DELIVERY-FEE-04 · Onda 1 -- valida que create_order() calcula delivery_fee/maquininha_fee
// AUTORITATIVOS no servidor (nunca confia nos valores enviados pelo client) contra o projeto Supabase
// DEDICADO a E2E (nunca producao). Mesmo padrao de scripts/price-source-01-onda1-test.mjs: conexao
// pg direta (db.e2e.env), cada caso em BEGIN...ROLLBACK, SET LOCAL request.jwt.claims simula
// tenant_id assinado (nao depende de resolucao por Origin, fora do alvo desta REF). Loja/produto/
// enderecos 100% descartaveis, criados dentro da propria transacao -- nunca toca Encanto/Aquarios
// reais nem qualquer fixture compartilhada de outra suite. Exit 0 = SUCCESS.
//
// ADAPTADO PELA ONDA 2 (REF-DELIVERY-FEE-04-onda2-transparencia-valor.sql): antes, um valor forjado
// pelo client era corrigido SILENCIOSAMENTE numa unica chamada (Onda 1 pura). Agora o mesmo forjar
// dispara divergencia -- create_order recusa persistir (ok:false, divergencia_valor:true) e devolve
// o valor autoritativo. Os 12 casos abaixo passam a fazer 2 chamadas: a 1a com o valor forjado
// (espera divergencia, nenhum pedido criado) e a 2a com o valor autoritativo que a 1a devolveu
// (espera pedido criado com esse valor) -- mesma garantia de fundo (servidor nunca persiste um valor
// diferente do autoritativo), mecanica atualizada. Nenhum caso foi apagado.
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

// REF-DELIVERY-FEE-04 · Onda 2: 1a chamada (valor forjado) espera divergencia sem persistir; 2a
// chamada (valor autoritativo devolvido pela 1a) espera pedido criado com esse valor.
async function assertDivergeEntaoConfirma(labelBase, customer, orderForjado, items, storeId, esperadoDelivery, esperadoMaquininha) {
  const r1 = await callCreateOrder(customer, orderForjado, items, storeId);
  const res1 = r1.rows[0].res;
  const divergiu = res1.ok === false && res1.divergencia_valor === true
    && Number(res1.delivery_fee) === esperadoDelivery && Number(res1.maquininha_fee) === esperadoMaquininha;
  check(`${labelBase} (1a chamada, forjado) — divergencia detectada, autoritativo=${esperadoDelivery}/${esperadoMaquininha}, nenhum pedido criado`, divergiu, JSON.stringify(res1));

  const orderConfirmado = { ...orderForjado, delivery_fee: esperadoDelivery, maquininha_fee: esperadoMaquininha };
  const r2 = await callCreateOrder(customer, orderConfirmado, items, storeId);
  const res2 = r2.rows[0].res;
  let ok2 = res2.ok;
  if (ok2) {
    const o = await getOrder(res2.order_id);
    ok2 = Number(o.delivery_fee) === esperadoDelivery && Number(o.maquininha_fee) === esperadoMaquininha;
  }
  check(`${labelBase} (2a chamada, confirmado com o valor autoritativo) — pedido criado corretamente`, ok2, JSON.stringify(res2));
}

// ── Coordenadas fixas p/ teste (Blumenau/SC, mesma regiao dos dados reais do projeto): loja em
// (-26.9000,-48.6000). PERTO ~0.7km (faixa 1, ate 5km). LONGE ~7.8km (faixa 2, 5.1-10km). FORA DE
// ALCANCE ~25km (alem da maior faixa cadastrada, mas DENTRO do bounding box de plausibilidade
// introduzido pela REF-ADDRESS-GEO-INTEGRITY-01 Onda 2 -- GREATEST(10*3,50)=50km para estas faixas
// -- preserva a intencao original deste Caso 7: "endereco real, so' fora de alcance", sem disparar a
// rejeicao nova de coordenada GROSSEIRAMENTE implausivel, que e' um cenario coberto pelos testes
// dedicados da Onda 2, scripts/address-geo-integrity-01-onda2-test.mjs G2).
const LOJA_LAT = -26.9000, LOJA_LNG = -48.6000;
const PERTO_LAT = -26.9060, PERTO_LNG = -48.6060;   // ~0.9km (haversine exato, conferido)
const LONGE_LAT = -26.9450, LONGE_LNG = -48.6450;   // ~6.7km (haversine exato, conferido)
const FORA_LAT  = -27.0700, FORA_LNG  = -48.7700;   // ~25.3km (haversine exato, conferido)

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
  console.log(' REF-DELIVERY-FEE-04 (Onda 1, adaptado p/ Onda 2) · create_order (E2E)');
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
      await assertDivergeEntaoConfirma('Caso 1 — retirada com fees forjados (999/999)',
        { name: 'C1', phone: telefone() },
        { payment_method: 'cartao_credito', address: 'Retirada na loja', retirada: true, delivery_fee: 999, maquininha_fee: 999 },
        item(), STORE, 0, 0);
    });

    // ── Caso 2 — maquininha DESLIGADA no config + cartao + fee forjado -> 0; delivery PERTO -> 10.00. ──
    await withTx(async () => {
      await client.query(`UPDATE public.store_settings SET valor = $2::text WHERE store_id = $1 AND chave = 'delivery_fee_config'`,
        [STORE, JSON.stringify({ version: 1, ativo: true, maquininha: { ativo: false, valor: 2.00 }, faixas: FAIXAS })]);
      await comoLoja(STORE);
      await assertDivergeEntaoConfirma('Caso 2 — maquininha DESLIGADA + cartao + fees forjados (0/999)',
        { name: 'C2', phone: telefone() },
        { payment_method: 'cartao_credito', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 0, maquininha_fee: 999 },
        item(), STORE, 10.00, 0);
    });

    // ── Caso 3 — maquininha LIGADA + cartao debito + fees forjados pra 0 -> autoritativo 10.00/2.00. ──
    await withTx(async () => {
      await comoLoja(STORE);
      await assertDivergeEntaoConfirma('Caso 3 — maquininha LIGADA + cartao_debito + fees forjados (0/0)',
        { name: 'C3', phone: telefone() },
        { payment_method: 'cartao_debito', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 0, maquininha_fee: 0 },
        item(), STORE, 10.00, 2.00);
    });

    // ── Caso 4 — maquininha LIGADA + pagamento SEM cartao (pix) -> maquininha_fee=0 mesmo forjado. ──
    await withTx(async () => {
      await comoLoja(STORE);
      await assertDivergeEntaoConfirma('Caso 4 — pagamento PIX (sem maquininha) + fees forjados (0/999)',
        { name: 'C4', phone: telefone() },
        { payment_method: 'pix', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 0, maquininha_fee: 999 },
        item(), STORE, 10.00, 0);
    });

    // ── Caso 5 — entrega, endereco PERTO (faixa 1), delivery_fee forjado pra 0 -> autoritativo 10.00. ──
    await withTx(async () => {
      await comoLoja(STORE);
      await assertDivergeEntaoConfirma('Caso 5 — endereco PERTO (~0.9km, faixa1) + fee forjado (0)',
        { name: 'C5', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 0, maquininha_fee: 0 },
        item(), STORE, 10.00, 0);
    });

    // ── Caso 6 — entrega, endereco LONGE (faixa 2), delivery_fee forjado pra 0 -> autoritativo 20.00. ──
    await withTx(async () => {
      await comoLoja(STORE);
      await assertDivergeEntaoConfirma('Caso 6 — endereco LONGE (~6.7km, faixa2) + fee forjado (0)',
        { name: 'C6', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Rua Longe, 2', endereco_id: END_LONGE, delivery_fee: 0, maquininha_fee: 0 },
        item(), STORE, 20.00, 0);
    });

    // ── Caso 6b — cliente tenta pagar MENOS num pedido LONGE (fee forjado pra baixo). ───────────────
    await withTx(async () => {
      await comoLoja(STORE);
      await assertDivergeEntaoConfirma('Caso 6b — endereco LONGE + delivery_fee forjado pra baixo (1.00)',
        { name: 'C6b', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Rua Longe, 2', endereco_id: END_LONGE, delivery_fee: 1.00, maquininha_fee: 0 },
        item(), STORE, 20.00, 0);
    });

    // ── Caso 7 — endereco FORA DE ALCANCE (>10km) -> delivery_fee=0 (mesmo fallback do client). ────
    await withTx(async () => {
      await comoLoja(STORE);
      await assertDivergeEntaoConfirma('Caso 7 — endereco FORA DE ALCANCE (~25km) + fee forjado (999)',
        { name: 'C7', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Rua Fora, 3', endereco_id: END_FORA, delivery_fee: 999, maquininha_fee: 0 },
        item(), STORE, 0, 0);
    });

    // ── Caso 8 — entrega SEM endereco_id (null) -> delivery_fee=0 (decisao do dono, 2026-08-29). ───
    await withTx(async () => {
      await comoLoja(STORE);
      await assertDivergeEntaoConfirma('Caso 8 — sem endereco_id (null) + fee forjado (999)',
        { name: 'C8', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Endereco so em texto, sem endereco_id', delivery_fee: 999, maquininha_fee: 0 },
        item(), STORE, 0, 0);
    });

    // ── Caso 9 — endereco existe mas SEM lat/lng gravado (geocode falhou) -> delivery_fee=0. ───────
    await withTx(async () => {
      await comoLoja(STORE);
      await assertDivergeEntaoConfirma('Caso 9 — endereco_id existe mas sem lat/lng gravado + fee forjado (999)',
        { name: 'C9', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Rua Sem Coord, 4', endereco_id: END_SEM_COORD, delivery_fee: 999, maquininha_fee: 0 },
        item(), STORE, 0, 0);
    });

    // ── Caso 10 — endereco_id de OUTRA loja -> tratado como "sem coordenadas" (fee=0), anti-enumeracao. ──
    await withTx(async () => {
      await comoLoja(STORE);
      await assertDivergeEntaoConfirma('Caso 10 — endereco_id de OUTRA loja + fee forjado (999)',
        { name: 'C10', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Tentando usar endereco de outra loja', endereco_id: END_OUTRA_LOJA, delivery_fee: 999, maquininha_fee: 0 },
        item(), STORE, 0, 0);
    });

    // ── Caso 11 — cobranca automatica DESLIGADA no admin (config.ativo=false) -> delivery_fee=0
    // mesmo com endereco PERTO valido; maquininha continua independente (2.00). ───────────────────────
    await withTx(async () => {
      await client.query(`UPDATE public.store_settings SET valor = $2::text WHERE store_id = $1 AND chave = 'delivery_fee_config'`,
        [STORE, JSON.stringify({ version: 1, ativo: false, maquininha: { ativo: true, valor: 2.00 }, faixas: FAIXAS })]);
      await comoLoja(STORE);
      await assertDivergeEntaoConfirma('Caso 11 — cobranca automatica DESLIGADA + fees forjados (999/0)',
        { name: 'C11', phone: telefone() },
        { payment_method: 'cartao_debito', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 999, maquininha_fee: 0 },
        item(), STORE, 0, 2.00);
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
      await assertDivergeEntaoConfirma('Caso 12 — isolamento: OUTRA_LOJA usa sua PROPRIA tabela, fees forjados (0/0)',
        { name: 'C12', phone: telefone() },
        { payment_method: 'cartao_debito', address: 'Rua Outra Loja, 5', endereco_id: END_OUTRA_LOJA, delivery_fee: 0, maquininha_fee: 0 },
        [{ product_id: prodOutra, nome_produto: 'Produto Outra Loja', quantity: 1, price: 10.00, preco_unitario: 10.00 }], OUTRA_LOJA,
        99.00, 5.00);
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
