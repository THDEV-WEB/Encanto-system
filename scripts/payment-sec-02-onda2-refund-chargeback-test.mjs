// REF-PAYMENT-SEC-02 · Onda 2 -- valida contra o banco (E2E dedicado, NUNCA producao) o achado
// HIGH-02: refunded/charged_back agora sao mapeados corretamente (via _processar_webhook_payment_
// intent chamado com o status interno JA mapeado -- o mapeamento em si vive nos .ts das Edge
// Functions, testado por leitura de codigo/grep aqui) e revertem o selo de fidelidade quando
// aplicavel. Cobre os testes obrigatorios 6, 7, 8 da secao "Testes obrigatorios":
//   6. refund reverte corretamente
//   7. chargeback reverte corretamente
//   8. refund repetido nao duplica reversao
// + regressao: recompensa JA RESGATADA neste pedido -> estorno NAO restaura o resgate (mesmo
//   precedente ja aprovado por loyalty_void_on_cancel pro caso "resgate + cancelamento")
// + regressao: pedido SEM selo concedido (ex.: metodo fisico nunca creditou por outro motivo) ->
//   estorno e' um no-op seguro pro lado da fidelidade (nada pra reverter)
// + regressao: em_contestacao (disputa aberta, sem resultado) NAO reverte nada sozinho (so' estorno
//   efetivo reverte)
// Exit 0 = SUCCESS.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ENV_PATH = process.argv.includes('--prod')
  ? 'C:/Users/00thi/.encanto/db.env'
  : 'C:/Users/00thi/.encanto/db.e2e.env';
if (process.argv.includes('--prod')) { console.error('ABORTADO: este script nunca roda contra producao.'); process.exit(2); }

const envGet = (txt, k) => { const m = txt.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
function loadConn() {
  const txt = readFileSync(ENV_PATH, 'utf8');
  const password = envGet(txt, 'PGPASSWORD');
  if (!password) { console.error('ERRO: PGPASSWORD vazio'); process.exit(2); }
  return { host: envGet(txt, 'PGHOST'), port: Number(envGet(txt, 'PGPORT') || 5432), user: envGet(txt, 'PGUSER'), password, database: envGet(txt, 'PGDATABASE') || 'postgres' };
}
const conn = loadConn();
console.log(`Ambiente confirmado: ${conn.host} (${ENV_PATH})`);
const client = new pg.Client({ ...conn, ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  ${extra}`); }
}
async function withTx(fn) {
  await client.query('BEGIN');
  try { return await fn(); } finally { await client.query('ROLLBACK'); }
}
async function processarWebhook(mpPaymentId, novoStatus, storeId, statusDetail = null, payload = {}) {
  const r = await client.query(
    `SELECT public._processar_webhook_payment_intent($1::text, $2::text, $3::text, $4::uuid, $5::jsonb) AS res`,
    [mpPaymentId, novoStatus, statusDetail, storeId, JSON.stringify(payload)]
  );
  return r.rows[0].res;
}
async function selosDoCliente(customerId) {
  const r = await client.query(`SELECT coalesce(stamps,0) AS s FROM public.loyalty_accounts WHERE customer_id = $1`, [customerId]);
  return r.rows[0]?.s ?? 0;
}

async function main() {
  await client.connect();
  const STORE = randomUUID();

  console.log('==========================================================================');
  console.log(' REF-PAYMENT-SEC-02 (Onda 2) · refunded/charged_back revertem fidelidade (HIGH-02) (E2E)');
  console.log('==========================================================================\n');

  await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste SEC02 Onda2','ativo')`, [STORE, `payment-sec-02-onda2-${Date.now()}`]);

  // Monta um pedido JA aprovado (com 1 selo concedido), simulando o estado pos-Onda-1: order
  // 'recebido'/payment_status='aprovado', payment_intent 'aprovado', 1 evento 'earned'.
  const pedidoAprovadoComSelo = async (label) => {
    const customerId = randomUUID();
    const orderId = randomUUID();
    const mpId = `mp-onda2-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await client.query(`INSERT INTO public.customers (id, name, phone, store_id) VALUES ($1,$2,$3,$4)`, [customerId, label, `398${Math.floor(Math.random() * 1e8)}`, STORE]);
    await client.query(`INSERT INTO public.loyalty_accounts (customer_id, store_id, stamps, earned_total) VALUES ($1,$2,1,1)`, [customerId, STORE]);
    await client.query(
      `INSERT INTO public.orders (id, customer_id, total, status, payment_method, address, store_id, tipo_pedido, origem_pedido, payment_status)
       VALUES ($1,$2,20.00,'recebido','online','Retirada na loja',$3,'retirada','storefront','aprovado')`,
      [orderId, customerId, STORE]
    );
    await client.query(
      `INSERT INTO public.loyalty_events (customer_id, order_id, tipo, delta, stamps_after, origem, note, store_id) VALUES ($1,$2,'earned',1,1,'create_order','pedido valido',$3)`,
      [customerId, orderId, STORE]
    );
    await client.query(
      `INSERT INTO public.payment_intents (id, store_id, order_id, amount, status, mp_payment_id) VALUES (gen_random_uuid(),$1,$2,20.00,'aprovado',$3)`,
      [STORE, orderId, mpId]
    );
    return { customerId, orderId, mpId };
  };

  try {
    // ══ 6. REFUND reverte corretamente ══════════════════════════════════════════════════════════
    await withTx(async () => {
      const { customerId, orderId, mpId } = await pedidoAprovadoComSelo('refund1');
      const antes = await selosDoCliente(customerId);
      const res = await processarWebhook(mpId, 'estornado', STORE, 'refunded', { id: mpId, status: 'refunded' });
      const depois = await selosDoCliente(customerId);
      const order = await client.query(`SELECT payment_status, status FROM public.orders WHERE id=$1`, [orderId]);
      const evento = await client.query(`SELECT tipo, delta FROM public.loyalty_events WHERE order_id=$1 AND tipo='revoked'`, [orderId]);
      check('6. REFUND -> selo revertido (1 -> 0), payment_status=estornado, orders.status NAO reaberto/cancelado sozinho',
        res.ok === true && antes === 1 && depois === 0 && order.rows[0].payment_status === 'estornado' && order.rows[0].status === 'recebido' && evento.rows.length === 1 && Number(evento.rows[0].delta) === -1,
        JSON.stringify({ res, antes, depois, order: order.rows[0], evento: evento.rows }));
    });

    // ══ 7. CHARGEBACK reverte corretamente ══════════════════════════════════════════════════════
    await withTx(async () => {
      const { customerId, mpId } = await pedidoAprovadoComSelo('chargeback1');
      const res = await processarWebhook(mpId, 'estornado', STORE, 'charged_back', { id: mpId, status: 'charged_back' });
      const depois = await selosDoCliente(customerId);
      check('7. CHARGEBACK -> selo revertido (mesma mecanica de refund, mesmo status interno "estornado")',
        res.ok === true && depois === 0, JSON.stringify({ res, depois }));
    });

    // ══ 8. Refund REPETIDO nao duplica reversao ═════════════════════════════════════════════════
    await withTx(async () => {
      const { customerId, orderId, mpId } = await pedidoAprovadoComSelo('refund-repetido');
      await processarWebhook(mpId, 'estornado', STORE, 'refunded', { id: mpId, status: 'refunded' });
      const antesSegunda = await selosDoCliente(customerId);
      const res2 = await processarWebhook(mpId, 'estornado', STORE, 'refunded', { id: mpId, status: 'refunded' }); // mesmo webhook de novo
      const depoisSegunda = await selosDoCliente(customerId);
      const eventos = await client.query(`SELECT count(*)::int n FROM public.loyalty_events WHERE order_id=$1 AND tipo='revoked'`, [orderId]);
      check('8. REFUND repetido (webhook duplicado) -> idempotente, NAO duplica a reversao (so 1 evento revoked)',
        res2.ok === true && res2.idempotente === true && antesSegunda === 0 && depoisSegunda === 0 && eventos.rows[0].n === 1,
        JSON.stringify({ res2, antesSegunda, depoisSegunda, eventos: eventos.rows[0].n }));
    });

    // ══ REGRESSAO: recompensa JA RESGATADA -> estorno NAO restaura (mesmo precedente do cancelamento) ══
    await withTx(async () => {
      const customerId = randomUUID();
      const orderId = randomUUID();
      const mpId = `mp-onda2-resgate-${Date.now()}`;
      await client.query(`INSERT INTO public.customers (id, name, phone, store_id) VALUES ($1,'resgatado','39899999999',$2)`, [customerId, STORE]);
      await client.query(`INSERT INTO public.loyalty_accounts (customer_id, store_id, stamps, rewards_redeemed) VALUES ($1,$2,0,1)`, [customerId, STORE]);
      await client.query(
        `INSERT INTO public.orders (id, customer_id, total, status, payment_method, address, store_id, tipo_pedido, origem_pedido, payment_status, desconto_fidelidade)
         VALUES ($1,$2,10.00,'recebido','online','Retirada na loja',$3,'retirada','storefront','aprovado',10.00)`,
        [orderId, customerId, STORE]
      );
      // resgate: delta NEGATIVO (-10, mesmo formato de _redeem_loyalty_for_order), origem='create_order'
      await client.query(
        `INSERT INTO public.loyalty_events (customer_id, order_id, tipo, delta, stamps_after, origem, note, store_id, discount_pct, discount_amount) VALUES ($1,$2,'redeemed',-10,0,'create_order','recompensa 50%',$3,50,10.00)`,
        [customerId, orderId, STORE]
      );
      await client.query(`INSERT INTO public.payment_intents (id, store_id, order_id, amount, status, mp_payment_id) VALUES (gen_random_uuid(),$1,$2,10.00,'aprovado',$3)`, [STORE, orderId, mpId]);

      const antes = await selosDoCliente(customerId);
      const res = await processarWebhook(mpId, 'estornado', STORE, 'refunded', { id: mpId, status: 'refunded' });
      const depois = await selosDoCliente(customerId);
      const revoked = await client.query(`SELECT count(*)::int n FROM public.loyalty_events WHERE order_id=$1 AND tipo='revoked'`, [orderId]);
      check('REGRESSAO: pedido que RESGATOU recompensa + estornado -> NAO restaura o resgate (mesmo precedente do cancelamento), nenhum evento revoked criado',
        res.ok === true && antes === 0 && depois === 0 && revoked.rows[0].n === 0,
        JSON.stringify({ res, antes, depois, revoked: revoked.rows[0].n }));
    });

    // ══ REGRESSAO: pedido SEM selo -> estorno e' no-op seguro (nada pra reverter) ═══════════════
    await withTx(async () => {
      const customerId = randomUUID();
      const orderId = randomUUID();
      const mpId = `mp-onda2-semselo-${Date.now()}`;
      await client.query(`INSERT INTO public.customers (id, name, phone, store_id) VALUES ($1,'semselo','39888888888',$2)`, [customerId, STORE]);
      await client.query(
        `INSERT INTO public.orders (id, customer_id, total, status, payment_method, address, store_id, tipo_pedido, origem_pedido, payment_status)
         VALUES ($1,$2,10.00,'recebido','online','Retirada na loja',$3,'retirada','storefront','aprovado')`,
        [orderId, customerId, STORE]
      );
      await client.query(`INSERT INTO public.payment_intents (id, store_id, order_id, amount, status, mp_payment_id) VALUES (gen_random_uuid(),$1,$2,10.00,'aprovado',$3)`, [STORE, orderId, mpId]);
      const res = await processarWebhook(mpId, 'estornado', STORE, 'refunded', { id: mpId, status: 'refunded' });
      const order = await client.query(`SELECT payment_status FROM public.orders WHERE id=$1`, [orderId]);
      check('REGRESSAO: pedido SEM selo concedido -> estorno so registra payment_status, nao quebra nem inventa reversao',
        res.ok === true && order.rows[0].payment_status === 'estornado', JSON.stringify({ res, order: order.rows[0] }));
    });

    // ══ REGRESSAO: em_contestacao (disputa aberta) sozinho NAO reverte nada ════════════════════
    await withTx(async () => {
      const { customerId, mpId } = await pedidoAprovadoComSelo('disputa1');
      const antes = await selosDoCliente(customerId);
      const res = await processarWebhook(mpId, 'em_contestacao', STORE, 'in_mediation', { id: mpId, status: 'in_mediation' });
      const depois = await selosDoCliente(customerId);
      check('REGRESSAO: em_contestacao (disputa aberta, sem resultado) NAO reverte o selo sozinho',
        res.ok === true && antes === 1 && depois === 1, JSON.stringify({ res, antes, depois }));
    });

    // ══ Confere que o mapeamento (grep, nao E2E) foi espelhado nos 2 arquivos .ts ═══════════════
    {
      const fs = await import('node:fs');
      const webhookSrc = fs.readFileSync('C:/Projetos/Encanto/encanto-react/supabase/functions/mp-webhook/index.ts', 'utf8');
      const cobrancaSrc = fs.readFileSync('C:/Projetos/Encanto/encanto-react/supabase/functions/mp-criar-cobranca/index.ts', 'utf8');
      const temMapeamento = (src) => /case "refunded":\s*\n\s*case "charged_back":\s*\n\s*return "estornado"/.test(src) && /case "in_mediation": return "em_contestacao"/.test(src);
      check('mp-webhook/index.ts: mapearStatusMp cobre refunded/charged_back/in_mediation', temMapeamento(webhookSrc));
      check('mp-criar-cobranca/index.ts: mapearStatusMp cobre refunded/charged_back/in_mediation (mirrorado)', temMapeamento(cobrancaSrc));
    }

    console.log(`\n${pass} passaram, ${fail} falharam.`);
  } finally {
    await client.query(`DELETE FROM public.loyalty_events WHERE store_id = $1`, [STORE]);
    await client.query(`DELETE FROM public.loyalty_accounts WHERE store_id = $1`, [STORE]);
    await client.query(`DELETE FROM public.payment_intents WHERE store_id = $1`, [STORE]);
    await client.query(`DELETE FROM public.orders WHERE store_id = $1`, [STORE]);
    await client.query(`DELETE FROM public.customers WHERE store_id = $1`, [STORE]);
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
