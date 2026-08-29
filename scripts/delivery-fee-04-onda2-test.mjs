// REF-DELIVERY-FEE-04 · Onda 2 -- valida que create_order() NAO persiste silenciosamente um pedido
// quando delivery_fee/maquininha_fee declarados pelo client divergem do valor AUTORITATIVO
// (_resolve_delivery_fee, Onda 1): devolve ok:false + divergencia_valor:true + os valores corretos,
// SEM criar orders/order_items/notification_outbox/loyalty_events -- so' persiste quando o client
// declara (ou reconfirma) o valor que o servidor de fato calculou. Mesmo padrao de conexao pg direta
// (db.e2e.env) + BEGIN...ROLLBACK do script da Onda 1 -- nunca toca producao nem Encanto/Aquarios
// reais. Cobre os 16 cenarios pedidos. Exit 0 = SUCCESS.
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

const telefone = () => `387${(n++).toString().padStart(8, '0')}`;

function callCreateOrder(customer, order, items, storeId, requestId = null) {
  return client.query(
    `SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, $5::uuid, $4::uuid) AS res`,
    [JSON.stringify(customer), JSON.stringify(order), JSON.stringify(items), storeId, requestId]
  );
}
async function contarOrders(storeId) {
  const r = await client.query(`SELECT count(*)::int AS n FROM public.orders WHERE store_id = $1`, [storeId]);
  return r.rows[0].n;
}
async function contarNotificacoes(storeId) {
  const r = await client.query(
    `SELECT count(*)::int AS n FROM public.notification_outbox no JOIN public.orders o ON o.id = no.order_id WHERE o.store_id = $1`,
    [storeId]);
  return r.rows[0].n;
}
async function contarLoyaltyEvents(phone) {
  const r = await client.query(
    `SELECT count(*)::int AS n FROM public.loyalty_events le JOIN public.customers c ON c.id = le.customer_id WHERE c.phone = $1`,
    [phone]);
  return r.rows[0].n;
}
async function getOrder(orderId) {
  const r = await client.query(`SELECT delivery_fee, maquininha_fee, total FROM public.orders WHERE id = $1`, [orderId]);
  return r.rows[0];
}

// ── Coordenadas (mesmas do script da Onda 1) — loja em (-26.9000,-48.6000). PERTO ~0.9km (faixa1,
// valor 10.00). Config: ativo, maquininha ativo 2.00.
const LOJA_LAT = -26.9000, LOJA_LNG = -48.6000;
const PERTO_LAT = -26.9060, PERTO_LNG = -48.6060;
const FAIXAS = [{ de: 0, ate: 5, valor: 10.00 }, { de: 5.1, ate: 10, valor: 20.00 }];

async function main() {
  await client.connect();

  const STORE = randomUUID();
  const OUTRA_LOJA = randomUUID();
  const PROD = randomUUID();
  const END_PERTO = randomUUID();
  const END_OUTRA_LOJA = randomUUID();

  console.log('==========================================================================');
  console.log(' REF-DELIVERY-FEE-04 (Onda 2) · transparencia do valor recalculado -- create_order (E2E)');
  console.log('==========================================================================\n');

  await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste DF04-Onda2','ativo')`, [STORE, `delivery-fee-04-onda2-${Date.now()}`]);
  await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Outra Loja DF04-Onda2','ativo')`, [OUTRA_LOJA, `delivery-fee-04-onda2-outra-${Date.now()}`]);
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
       ($1,$4,'Rua Perto','1',$2,$3),
       ($5,$6,'Rua Outra Loja','2',$2,$3)`,
    [END_PERTO, PERTO_LAT, PERTO_LNG, STORE, END_OUTRA_LOJA, OUTRA_LOJA]
  );

  const item = () => [{ product_id: PROD, nome_produto: 'Produto Teste', quantity: 1, price: 10.00, preco_unitario: 10.00 }];

  try {
    // ── 1. Valor frontend = servidor -> pedido criado normalmente (sem divergencia). ──────────────
    await withTx(async () => {
      await comoLoja(STORE);
      const phone = telefone();
      const r = await callCreateOrder(
        { name: 'S1', phone },
        { payment_method: 'cartao_debito', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 10.00, maquininha_fee: 2.00 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      let ok = res.ok === true && !res.divergencia_valor;
      if (ok) { const o = await getOrder(res.order_id); ok = Number(o.delivery_fee) === 10.00 && Number(o.maquininha_fee) === 2.00; }
      check('1. valor declarado = autoritativo (10.00/2.00) -> pedido criado normalmente, sem divergencia', ok, JSON.stringify(res));
    });

    // ── 2. Valor frontend MENOR -> divergencia detectada, NENHUM pedido criado. ────────────────────
    await withTx(async () => {
      await comoLoja(STORE);
      const antes = await contarOrders(STORE);
      const r = await callCreateOrder(
        { name: 'S2', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 1.00, maquininha_fee: 0 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      const depois = await contarOrders(STORE);
      const ok = res.ok === false && res.divergencia_valor === true
        && Number(res.delivery_fee) === 10.00 && Number(res.maquininha_fee) === 0
        && depois === antes; // nenhum pedido novo criado
      check('2. valor declarado MENOR (1.00 vs 10.00 real) -> divergencia, contagem de orders inalterada', ok, JSON.stringify(res) + ` orders antes=${antes} depois=${depois}`);
    });

    // ── 3. Valor frontend MAIOR -> divergencia detectada, NENHUM pedido criado. ────────────────────
    await withTx(async () => {
      await comoLoja(STORE);
      const antes = await contarOrders(STORE);
      const r = await callCreateOrder(
        { name: 'S3', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 999.00, maquininha_fee: 0 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      const depois = await contarOrders(STORE);
      const ok = res.ok === false && res.divergencia_valor === true
        && Number(res.delivery_fee) === 10.00 && depois === antes;
      check('3. valor declarado MAIOR (999.00 vs 10.00 real) -> divergencia, contagem de orders inalterada', ok, JSON.stringify(res) + ` orders antes=${antes} depois=${depois}`);
    });

    // ── 4. Cliente confirma o novo valor -> nova tentativa, servidor recalcula, pedido criado. ─────
    await withTx(async () => {
      await comoLoja(STORE);
      const phone = telefone();
      const r1 = await callCreateOrder(
        { name: 'S4', phone },
        { payment_method: 'dinheiro', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 0, maquininha_fee: 0 },
        item(), STORE,
      );
      const div = r1.rows[0].res;
      const r2 = await callCreateOrder(
        { name: 'S4', phone },
        { payment_method: 'dinheiro', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: div.delivery_fee, maquininha_fee: div.maquininha_fee },
        item(), STORE,
      );
      const res2 = r2.rows[0].res;
      let ok = res2.ok === true;
      if (ok) { const o = await getOrder(res2.order_id); ok = Number(o.delivery_fee) === 10.00 && Number(o.maquininha_fee) === 0; }
      check('4. confirma com o valor autoritativo devolvido -> pedido criado com 10.00/0', ok, JSON.stringify(res2));
    });

    // ── 5. Cliente RECUSA (nunca reenvia) -> nenhum pedido criado. ─────────────────────────────────
    await withTx(async () => {
      await comoLoja(STORE);
      const phone = telefone();
      const antes = await contarOrders(STORE);
      await callCreateOrder(
        { name: 'S5', phone },
        { payment_method: 'dinheiro', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 0, maquininha_fee: 0 },
        item(), STORE,
      );
      // cliente recusa -- nao reenvia. Confirma que nao existe NENHUM pedido para este telefone.
      const r = await client.query(`SELECT count(*)::int AS n FROM public.orders o JOIN public.customers c ON c.id=o.customer_id WHERE c.phone=$1`, [phone]);
      const depois = await contarOrders(STORE);
      check('5. cliente recusa o novo valor (nunca reenvia) -> nenhum pedido criado para esse telefone', r.rows[0].n === 0 && depois === antes, `pedidos do telefone=${r.rows[0].n}`);
    });

    // ── 6. 2a tentativa tenta adulterar DE NOVO (nao usa o valor autoritativo devolvido) -> diverge de novo. ──
    await withTx(async () => {
      await comoLoja(STORE);
      const phone = telefone();
      const r1 = await callCreateOrder(
        { name: 'S6', phone },
        { payment_method: 'dinheiro', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 0, maquininha_fee: 0 },
        item(), STORE,
      );
      const div1 = r1.rows[0].res;
      const r2 = await callCreateOrder(
        { name: 'S6', phone },
        { payment_method: 'dinheiro', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 5.00, maquininha_fee: 0 }, // adultera de novo, NAO usa o 10.00 devolvido
        item(), STORE,
      );
      const div2 = r2.rows[0].res;
      const ok = div1.ok === false && div1.divergencia_valor === true
        && div2.ok === false && div2.divergencia_valor === true && Number(div2.delivery_fee) === 10.00;
      check('6. 2a tentativa adultera de novo (5.00, ignora o 10.00 devolvido) -> servidor prevalece, diverge de novo', ok, JSON.stringify({ div1, div2 }));
    });

    // ── 7. Maquininha divergente (delivery correto, maquininha forjado). ───────────────────────────
    await withTx(async () => {
      await comoLoja(STORE);
      const r = await callCreateOrder(
        { name: 'S7', phone: telefone() },
        { payment_method: 'cartao_credito', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 10.00, maquininha_fee: 0 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      const ok = res.ok === false && res.divergencia_valor === true && Number(res.delivery_fee) === 10.00 && Number(res.maquininha_fee) === 2.00;
      check('7. maquininha divergente sozinha (declarado 0, real 2.00) -> divergencia correta', ok, JSON.stringify(res));
    });

    // ── 8. Delivery + maquininha divergentes SIMULTANEAMENTE. ──────────────────────────────────────
    await withTx(async () => {
      await comoLoja(STORE);
      const r = await callCreateOrder(
        { name: 'S8', phone: telefone() },
        { payment_method: 'cartao_credito', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 1.00, maquininha_fee: 1.00 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      const ok = res.ok === false && res.divergencia_valor === true && Number(res.delivery_fee) === 10.00 && Number(res.maquininha_fee) === 2.00;
      check('8. delivery E maquininha divergentes ao mesmo tempo -> devolve os 2 valores autoritativos', ok, JSON.stringify(res));
    });

    // ── 9. Retirada: cliente declara honestamente 0/0 -> NENHUMA divergencia indevida. ─────────────
    await withTx(async () => {
      await comoLoja(STORE);
      const r = await callCreateOrder(
        { name: 'S9', phone: telefone() },
        { payment_method: 'cartao_credito', address: 'Retirada na loja', retirada: true, delivery_fee: 0, maquininha_fee: 0 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      let ok = res.ok === true && !res.divergencia_valor;
      if (ok) { const o = await getOrder(res.order_id); ok = Number(o.delivery_fee) === 0 && Number(o.maquininha_fee) === 0; }
      check('9. retirada com valor honesto (0/0) -> nenhuma divergencia indevida, cria normal', ok, JSON.stringify(res));
    });

    // ── 10. Endereco INVALIDO (uuid aleatorio, nao existe) -> tratado como sem-coordenadas. ─────────
    await withTx(async () => {
      await comoLoja(STORE);
      const r = await callCreateOrder(
        { name: 'S10', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Endereco fantasma', endereco_id: randomUUID(), delivery_fee: 999, maquininha_fee: 0 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      const ok = res.ok === false && res.divergencia_valor === true && Number(res.delivery_fee) === 0;
      check('10. endereco_id inexistente -> tratado como sem-coordenadas, diverge contra fee forjado', ok, JSON.stringify(res));
    });

    // ── 11. Endereco de OUTRA loja -> mesma anti-enumeracao, fluxo de divergencia funciona igual. ──
    await withTx(async () => {
      await comoLoja(STORE);
      const r = await callCreateOrder(
        { name: 'S11', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Tentando outra loja', endereco_id: END_OUTRA_LOJA, delivery_fee: 999, maquininha_fee: 0 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      const ok = res.ok === false && res.divergencia_valor === true && Number(res.delivery_fee) === 0;
      check('11. endereco_id de OUTRA loja -> tratado como sem-coordenadas, diverge contra fee forjado', ok, JSON.stringify(res));
    });

    // ── 12. Cross-tenant: o fluxo de divergencia/confirmacao de STORE nunca vaza pra OUTRA_LOJA. ────
    await withTx(async () => {
      await client.query(
        `INSERT INTO public.store_settings (store_id, chave, valor) VALUES
           ($1,'company_info', $2::text),
           ($1,'delivery_fee_config', $3::text)`,
        [OUTRA_LOJA, JSON.stringify({ lojaLat: LOJA_LAT, lojaLng: LOJA_LNG }),
         JSON.stringify({ version: 1, ativo: true, maquininha: { ativo: true, valor: 5.00 }, faixas: [{ de: 0, ate: 5, valor: 99.00 }] })]
      );
      const prodOutra = randomUUID();
      await client.query(`INSERT INTO public.products (id, nome, preco, categoria_id, disponivel, store_id) VALUES ($1,'Produto Outra',10.00,NULL,true,$2)`, [prodOutra, OUTRA_LOJA]);
      await comoLoja(OUTRA_LOJA);
      const r = await callCreateOrder(
        { name: 'S12', phone: telefone() },
        { payment_method: 'cartao_debito', address: 'Rua Outra Loja, 2', endereco_id: END_OUTRA_LOJA, delivery_fee: 10.00, maquininha_fee: 2.00 }, // valores da OUTRA loja seriam 99/5
        [{ product_id: prodOutra, nome_produto: 'Produto Outra', quantity: 1, price: 10.00, preco_unitario: 10.00 }], OUTRA_LOJA,
      );
      const res = r.rows[0].res;
      const ok = res.ok === false && res.divergencia_valor === true && Number(res.delivery_fee) === 99.00 && Number(res.maquininha_fee) === 5.00;
      check('12. cross-tenant: OUTRA_LOJA diverge contra a SUA PRÓPRIA tabela (99/5), nunca a de STORE (10/2)', ok, JSON.stringify(res));
    });

    // ── 13. Fidelidade: 0 loyalty_events na tentativa divergente, exatamente 1 na confirmada. ───────
    // loyalty_grant (REF-LOYALTY-01) só acumula quando store_settings.loyalty_enabled='true' -- loja
    // descartável nunca teve essa chave, então habilita só para este teste (escopado à própria
    // transação, revertido no ROLLBACK -- não afeta os demais cenários).
    await withTx(async () => {
      await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ($1,'loyalty_enabled','true')`, [STORE]);
      await comoLoja(STORE);
      const phone = telefone();
      const r1 = await callCreateOrder(
        { name: 'S13', phone },
        { payment_method: 'dinheiro', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 0, maquininha_fee: 0 },
        item(), STORE,
      );
      const div = r1.rows[0].res;
      const eventosAposDivergencia = await contarLoyaltyEvents(phone);
      const r2 = await callCreateOrder(
        { name: 'S13', phone },
        { payment_method: 'dinheiro', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: div.delivery_fee, maquininha_fee: div.maquininha_fee },
        item(), STORE,
      );
      const res2 = r2.rows[0].res;
      const eventosAposConfirmacao = await contarLoyaltyEvents(phone);
      const ok = eventosAposDivergencia === 0 && res2.ok === true && eventosAposConfirmacao === 1;
      check('13. fidelidade: 0 loyalty_events na divergencia, exatamente 1 apos confirmar', ok, `divergencia=${eventosAposDivergencia} confirmado=${eventosAposConfirmacao}`);
    });

    // ── 14. Notificacao: notification_outbox vazio apos tentativa divergente. ──────────────────────
    await withTx(async () => {
      await comoLoja(STORE);
      const antes = await contarNotificacoes(STORE);
      await callCreateOrder(
        { name: 'S14', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 0, maquininha_fee: 0 },
        item(), STORE,
      );
      const depois = await contarNotificacoes(STORE);
      check('14. notification_outbox: nenhuma linha nova apos tentativa divergente (trigger nunca disparou)', depois === antes, `antes=${antes} depois=${depois}`);
    });

    // ── 15. Idempotencia/retry: 2a chamada CONFIRMADA com o MESMO request_id nao duplica o pedido. ──
    await withTx(async () => {
      await comoLoja(STORE);
      const phone = telefone();
      const reqId = randomUUID();
      const r1 = await callCreateOrder(
        { name: 'S15', phone },
        { payment_method: 'dinheiro', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 10.00, maquininha_fee: 0 },
        item(), STORE, reqId,
      );
      const res1 = r1.rows[0].res;
      const r2 = await callCreateOrder(
        { name: 'S15', phone },
        { payment_method: 'dinheiro', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 10.00, maquininha_fee: 0 },
        item(), STORE, reqId, // MESMO request_id -- simula retry de rede da confirmacao
      );
      const res2 = r2.rows[0].res;
      const contagem = await client.query(`SELECT count(*)::int AS n FROM public.orders WHERE request_id = $1`, [reqId]);
      const ok = res1.ok === true && res2.ok === true && res2.idempotent === true && res1.order_id === res2.order_id && contagem.rows[0].n === 1;
      check('15. retry com o MESMO request_id apos sucesso -> idempotente, 1 pedido so', ok, JSON.stringify({ res1, res2, n: contagem.rows[0].n }));
    });

    // ── 16. Manipulacao de total: total mentiroso e sempre ignorado (regressao, nao relacionada a divergencia de fee). ──
    await withTx(async () => {
      await comoLoja(STORE);
      const r = await callCreateOrder(
        { name: 'S16', phone: telefone() },
        { payment_method: 'dinheiro', address: 'Rua Perto, 1', endereco_id: END_PERTO, delivery_fee: 10.00, maquininha_fee: 0, total: 1.00 },
        item(), STORE,
      );
      const res = r.rows[0].res;
      let ok = res.ok === true;
      if (ok) { const o = await getOrder(res.order_id); ok = Number(o.total) === 20.00; } // 10 (item) + 10 (delivery), nunca 1.00
      check('16. total mentiroso (1.00) no payload -> sempre ignorado, servidor grava 20.00 (10 item + 10 entrega)', ok, JSON.stringify(res));
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
