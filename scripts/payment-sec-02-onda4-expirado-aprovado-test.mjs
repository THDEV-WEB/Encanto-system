// REF-PAYMENT-SEC-02 · Onda 4 -- valida contra o banco (E2E dedicado, NUNCA producao) a transicao
// expirado->aprovado (achado MEDIUM-02 da REF-PAYMENT-SEC-01). Reconstroi o incidente real
// (pedido a9c06490..., producao, 2026-09-10): payment_intent expira (job dos 15min), DEPOIS chega um
// webhook de aprovacao real (atrasado). Confirma: (1) a transicao agora e aceita, (2) o pedido NAO e
// reaberto automaticamente (nunca reescreve orders.status sozinho), (3) o FATO financeiro fica
// registrado em orders.payment_status, (4) um log WARN de reconciliacao e gravado, (5) idempotencia
// continua valendo (webhook duplicado depois da aprovacao tardia -> 1 unico efeito), (6) regressao
// total das transicoes ja existentes (pendente->aprovado, pendente->recusado, etc.).
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

async function main() {
  await client.connect();
  const STORE = randomUUID();

  console.log('==========================================================================');
  console.log(' REF-PAYMENT-SEC-02 (Onda 4) · expirado -> aprovado, sem reabrir pedido (E2E)');
  console.log('==========================================================================\n');

  await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,$2,'Loja Teste SEC02 Onda4','ativo')`, [STORE, `payment-sec-02-onda4-${Date.now()}`]);

  const novoPedidoExpirado = async (mpPaymentId) => {
    const orderId = randomUUID();
    const piId = randomUUID();
    await client.query(
      `INSERT INTO public.orders (id, total, status, payment_method, address, store_id, tipo_pedido, origem_pedido, payment_status)
       VALUES ($1,2.00,'cancelado','pix','Retirada na loja',$2,'retirada','storefront','expirado')`,
      [orderId, STORE]
    );
    await client.query(
      `INSERT INTO public.payment_intents (id, store_id, order_id, amount, status, status_detail, mp_payment_id)
       VALUES ($1,$2,$3,2.00,'expirado',NULL,$4)`,
      [piId, STORE, orderId, mpPaymentId]
    );
    return { orderId, piId };
  };

  try {
    // ══ RECONSTRUCAO DO INCIDENTE REAL: expirado -> webhook de aprovacao atrasado chega ═════════
    await withTx(async () => {
      const mpId = `mp-onda4-incidente-${Date.now()}`;
      const { orderId, piId } = await novoPedidoExpirado(mpId);
      const res = await processarWebhook(mpId, 'aprovado', STORE, 'accredited', { id: mpId, status: 'approved' });
      check('Teste 14 · EXPIRED -> webhook APPROVED atrasado -> transicao ACEITA (nao mais recusada)',
        res.ok === true && res.status === 'aprovado', JSON.stringify(res));

      const pi = await client.query(`SELECT status FROM public.payment_intents WHERE id = $1`, [piId]);
      check('payment_intent reflete o FATO real: status = aprovado', pi.rows[0].status === 'aprovado', JSON.stringify(pi.rows[0]));

      const order = await client.query(`SELECT status, payment_status FROM public.orders WHERE id = $1`, [orderId]);
      check('Pedido NAO e reaberto automaticamente -- status continua "cancelado" (nunca reescrito sozinho)',
        order.rows[0].status === 'cancelado', JSON.stringify(order.rows[0]));
      check('MAS o fato financeiro fica registrado -- payment_status agora reflete "aprovado" (nunca se perde a informacao)',
        order.rows[0].payment_status === 'aprovado', JSON.stringify(order.rows[0]));

      const log = await client.query(
        `SELECT level, message FROM public.application_logs WHERE entity_id = $1 AND context = 'webhook_reconciliacao' ORDER BY created_at DESC LIMIT 1`,
        [orderId]
      );
      check('Log de RECONCILIACAO NECESSARIA gravado (nivel warn, visivel pro admin)',
        log.rows.length === 1 && log.rows[0].level === 'warn' && log.rows[0].message.includes('RECONCILIACAO NECESSARIA'),
        JSON.stringify(log.rows[0]));
    });

    // ── Idempotencia: webhook duplicado APOS a aprovacao tardia -> 1 unico efeito ────────────────
    await withTx(async () => {
      const mpId = `mp-onda4-replay-${Date.now()}`;
      const { orderId } = await novoPedidoExpirado(mpId);
      await processarWebhook(mpId, 'aprovado', STORE, 'accredited', { id: mpId, status: 'approved' });
      const antes = await client.query(`SELECT count(*)::int n FROM public.application_logs WHERE entity_id = $1 AND context = 'webhook_reconciliacao'`, [orderId]);
      const res2 = await processarWebhook(mpId, 'aprovado', STORE, 'accredited', { id: mpId, status: 'approved' });
      const depois = await client.query(`SELECT count(*)::int n FROM public.application_logs WHERE entity_id = $1 AND context = 'webhook_reconciliacao'`, [orderId]);
      check('Webhook duplicado (mesmo status "aprovado" de novo) -> idempotente, nao duplica o log de reconciliacao',
        res2.ok === true && res2.idempotente === true && depois.rows[0].n === antes.rows[0].n, JSON.stringify({ res2, antes: antes.rows[0].n, depois: depois.rows[0].n }));
    });

    // ── Frontend NUNCA pode forcar isso -- so' existe caminho via _processar_webhook_payment_intent,
    // que exige mp_payment_id ja gravado + assinatura ja validada rio acima (mp-webhook); nao ha RPC
    // publica que aceite "de/para" livre. Confirma que a RPC continua sem GRANT pra anon/authenticated.
    await withTx(async () => {
      const r = await client.query(`
        SELECT grantee FROM information_schema.routine_privileges
        WHERE routine_schema='public' AND routine_name='_processar_webhook_payment_intent' AND grantee IN ('anon','authenticated')
      `);
      check('_processar_webhook_payment_intent continua SEM grant pra anon/authenticated (so service_role/postgres)',
        r.rows.length === 0, JSON.stringify(r.rows));
    });

    // ══ REGRESSAO: todas as transicoes ja existentes continuam intactas ══════════════════════════
    const casosRegressao = [
      ['pendente', 'aprovado', true], ['pendente', 'recusado', true], ['pendente', 'expirado', true],
      ['aprovado', 'estornado', true], ['aprovado', 'em_contestacao', true], ['em_contestacao', 'estornado', true],
      ['em_contestacao', 'aprovado', true],
      // continuam INVALIDAS (nunca liberadas por esta onda)
      ['recusado', 'aprovado', false], ['expirado', 'recusado', false], ['aprovado', 'pendente', false],
    ];
    for (const [de, para, esperado] of casosRegressao) {
      await withTx(async () => {
        const r = await client.query(`SELECT public._transicao_payment_status_valida($1::text, $2::text) AS ok`, [de, para]);
        check(`Regressao transicao ${de} -> ${para} = ${esperado}`, r.rows[0].ok === esperado, JSON.stringify(r.rows[0]));
      });
    }

    // ── Regressao: fluxo NORMAL (pendente -> aprovado, pedido ainda aguardando_pagamento) continua
    // reabrindo/aprovando o pedido normalmente -- o "IF NOT FOUND" novo nao interfere no caso comum. ──
    await withTx(async () => {
      const mpId = `mp-onda4-normal-${Date.now()}`;
      const orderId = randomUUID();
      const piId = randomUUID();
      await client.query(
        `INSERT INTO public.orders (id, total, status, payment_method, address, store_id, tipo_pedido, origem_pedido)
         VALUES ($1,2.00,'aguardando_pagamento','pix','Retirada na loja',$2,'retirada','storefront')`,
        [orderId, STORE]
      );
      await client.query(
        `INSERT INTO public.payment_intents (id, store_id, order_id, amount, status, mp_payment_id) VALUES ($1,$2,$3,2.00,'pendente',$4)`,
        [piId, STORE, orderId, mpId]
      );
      const res = await processarWebhook(mpId, 'aprovado', STORE, 'accredited', { id: mpId, status: 'approved' });
      const order = await client.query(`SELECT status, payment_status FROM public.orders WHERE id = $1`, [orderId]);
      const log = await client.query(`SELECT count(*)::int n FROM public.application_logs WHERE entity_id = $1 AND context = 'webhook_reconciliacao'`, [orderId]);
      check('Regressao · fluxo NORMAL (pendente->aprovado, pedido aguardando) continua aprovando/reabrindo igual antes, SEM log de reconciliacao',
        res.ok === true && order.rows[0].status === 'recebido' && order.rows[0].payment_status === 'aprovado' && log.rows[0].n === 0,
        JSON.stringify({ res, order: order.rows[0], logs: log.rows[0].n }));
    });

    console.log(`\n${pass} passaram, ${fail} falharam.`);
  } finally {
    await client.query(`DELETE FROM public.payment_intents WHERE store_id = $1`, [STORE]);
    await client.query(`DELETE FROM public.orders WHERE store_id = $1`, [STORE]);
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
