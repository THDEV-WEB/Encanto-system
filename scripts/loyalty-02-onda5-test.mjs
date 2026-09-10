// Suite de verificacao da REF-LOYALTY-02 · Onda 5 (restaura recompensa resgatada quando o pedido
// que a consumiu e' cancelado) -- "Testes da fase". Mesmo estilo/rigor de
// scripts/loyalty-02-onda1-test.mjs. BEGIN...ROLLBACK contra o E2E, loja/cliente/pedidos
// ficticios. Exit 0 = SUCCESS.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = 'C:/Users/00thi/.encanto/db.e2e.env';

const envGet = (txt, k) => { const m = txt.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
function loadConn() {
  const txt = readFileSync(ENV_PATH, 'utf8');
  const host = envGet(txt, 'PGHOST'); const user = envGet(txt, 'PGUSER');
  const password = envGet(txt, 'PGPASSWORD'); if (!password) { console.error('ERRO: PGPASSWORD vazio'); process.exit(2); }
  return { cfg: { host, port: Number(envGet(txt, 'PGPORT') || 5432), user, password, database: envGet(txt, 'PGDATABASE') || 'postgres' }, secret: password, host, user };
}
function projectRef(host, user) { let m = (user || '').match(/postgres\.([a-z0-9]{16,})/i); if (m) return m[1]; m = (host || '').match(/(?:^|\.)([a-z0-9]{16,})\.supabase\./i); return m ? m[1] : '(n/d)'; }
const git = (a) => { try { return execSync('git ' + a, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return '(n/d)'; } };
const isoUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const { cfg, secret, host, user } = loadConn();
const EXPECTED_REF = 'bgzcrovskjbktdxkhemd'; // projeto E2E (encanto-e2e) -- NUNCA producao
const redact = s => { let r = String(s); if (secret) r = r.split(secret).join('[REDACTED]'); return r; };
const client = new pg.Client({ ...cfg, ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

const STORE_ID = '10ada005-aaaa-4000-8000-000000000001'; // 100% ficticia, prefixo desta REF

const R = []; const out = (s = '') => R.push(s);
let passes = 0, failures = 0, spCounter = 0;
const startedMs = Date.now(), startedIso = isoUtc();
function record(id, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} ${desc}`); out(`         -> ${detail}`);
}
async function withSavepoint(fn) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try { const r = await fn(); await client.query(`RELEASE SAVEPOINT ${sp}`); return r; }
  catch (e) { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); throw e; }
}
async function check(id, desc, fn) {
  try { const { ok, detail } = await withSavepoint(fn); record(id, desc, ok ? 'PASS' : 'FAIL', detail); }
  catch (e) { record(id, desc, 'FAIL', 'EXCECAO: ' + redact(e.message).split('\n')[0]); }
}
async function novoPedido(customerId) {
  const r = await client.query(`INSERT INTO public.orders (customer_id, total, status, payment_method, address, store_id) VALUES ($1, 25, 'recebido', 'dinheiro', 'Retirada na loja - teste', '${STORE_ID}') RETURNING id`, [customerId]);
  return r.rows[0].id;
}
// redeem_reward()/_redeem_loyalty_for_order() sao revogadas ate' da propria conexao de teste
// (mesmo achado da Onda 2) -- o unico caminho real de resgate testavel aqui e' create_order()
// com usar_recompensa_fidelidade, exatamente como um checkout de verdade faria.
const PRODUCT_ID = '10ada005-bbbb-4000-8000-000000000001';
const ADMIN_PERSONA = 'bc45ac7f-948a-4571-8df9-ce544757bcad'; // e2e-admin-b@teste.encanto.local (real, existe hoje no E2E)
async function setRole(role, sub, tenantId) {
  const claims = { ...(sub ? { sub } : {}), ...(tenantId ? { tenant_id: tenantId } : {}), role };
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  await client.query(`SET LOCAL ROLE ${role}`);
}
async function resetRole() { await client.query(`RESET ROLE`); await client.query(`SELECT set_config('request.jwt.claims', '{}', true)`); }
async function callCreateOrder(usarRecompensa) {
  await setRole('authenticated', ADMIN_PERSONA, STORE_ID);
  const customer = { name: 'Cliente Onda5 (fake)', phone: '47966670077' };
  const order = { payment_method: 'dinheiro', address: 'Retirada na loja - teste', retirada: true, tipo_pedido: 'retirada',
    ...(usarRecompensa ? { usar_recompensa_fidelidade: true } : {}) };
  const items = [{ product_id: PRODUCT_ID, nome_produto: 'Produto Onda5 (fake)', quantity: 1 }];
  const r = await client.query(`SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS r`,
    [JSON.stringify(customer), JSON.stringify(order), JSON.stringify(items), STORE_ID]);
  await resetRole();
  return r.rows[0].r;
}

try {
  await client.connect();
  const refReal = projectRef(host, user);
  out('— ALVO CONFIRMADO — host=' + host + ' user=' + user + ' project_ref=' + refReal + ' —');
  if (refReal !== EXPECTED_REF) throw new Error(`ABORTADO: project_ref real (${refReal}) difere do E2E esperado (${EXPECTED_REF})`);
  out('');

  await client.query('BEGIN');

  out('=== CAMADA A — ESTRUTURAL ===');
  await check('A1', 'loyalty_void_on_cancel continua sendo funcao de trigger, sem parametros (nao virou overload)', async () => {
    const r = await client.query(`SELECT pg_get_function_identity_arguments(oid) AS args FROM pg_proc WHERE proname='loyalty_void_on_cancel'`);
    const ok = r.rows.length === 1 && r.rows[0].args === '';
    return { ok, detail: JSON.stringify(r.rows) };
  });
  await check('A2', 'trigger trg_loyalty_void_on_cancel continua ativo em orders', async () => {
    const r = await client.query(`SELECT tgenabled FROM pg_trigger WHERE tgname='trg_loyalty_void_on_cancel'`);
    return { ok: r.rows[0]?.tgenabled === 'O', detail: JSON.stringify(r.rows[0]) };
  });
  out('');

  out('=== CAMADA B — COMPORTAMENTAL (dados 100% ficticios) ===');
  await client.query(`INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_ID}', 'loja-loyalty02-onda5', 'Loja Onda5 (fake, REF-LOYALTY-02)', NULL, 'ativo')`);
  await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ('${STORE_ID}', 'loyalty_enabled', 'true')`);
  await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ('${STORE_ID}', 'loyalty_required', '5')`);
  await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ('${STORE_ID}', 'loyalty_discount', '30')`);
  await client.query(`INSERT INTO public.products (id, nome, preco, categoria_id, disponivel, store_id) VALUES ('${PRODUCT_ID}', 'Produto Onda5 (fake)', 20.00, NULL, true, '${STORE_ID}')`);
  const cust = await client.query(`INSERT INTO public.customers (name, phone, store_id) VALUES ('Cliente Onda5 (fake)', '47966670077', '${STORE_ID}') RETURNING id`);
  const customerId = cust.rows[0].id;
  await client.query(`INSERT INTO public.loyalty_accounts (customer_id, store_id, stamps) VALUES ($1, '${STORE_ID}', 0)`, [customerId]);

  // ── B1/B2: REGRESSAO do lado GANHO (100% intocado) — cancelar reverte, reabrir restaura ──
  await check('B1', 'REGRESSAO: selo GANHO revertido ao cancelar (logica intocada)', async () => {
    const orderId = await novoPedido(customerId);
    await client.query(`SELECT public.loyalty_grant($1, $2)`, [customerId, orderId]);
    await client.query(`UPDATE public.orders SET status='cancelado' WHERE id=$1`, [orderId]);
    const acc = await client.query(`SELECT stamps FROM public.loyalty_accounts WHERE customer_id=$1`, [customerId]);
    const ev = await client.query(`SELECT tipo, delta FROM public.loyalty_events WHERE order_id=$1 ORDER BY created_at`, [orderId]);
    const ok = acc.rows[0].stamps === 0 && ev.rows.some(e => e.tipo === 'revoked' && e.delta === -1);
    return { ok, detail: JSON.stringify({ stamps: acc.rows[0].stamps, eventos: ev.rows }) };
  });

  await check('B2', 'REGRESSAO: reabrir pedido cancelado restaura o selo GANHO (logica intocada)', async () => {
    const orderId = await novoPedido(customerId);
    await client.query(`SELECT public.loyalty_grant($1, $2)`, [customerId, orderId]);
    await client.query(`UPDATE public.orders SET status='cancelado' WHERE id=$1`, [orderId]);
    await client.query(`UPDATE public.orders SET status='recebido' WHERE id=$1`, [orderId]);
    const acc = await client.query(`SELECT stamps FROM public.loyalty_accounts WHERE customer_id=$1`, [customerId]);
    const ok = acc.rows[0].stamps === 1; // ganhou, cancelou (voltou a 0), reabriu (voltou a 1)
    return { ok, detail: JSON.stringify(acc.rows[0]) };
  });

  // ── B3: NOVO — resgate cancelado restaura a recompensa ──
  await client.query(`UPDATE public.loyalty_accounts SET stamps=5, rewards_redeemed=0 WHERE customer_id=$1`, [customerId]);
  let orderResgateId;
  await check('B3', 'NOVO: pedido que RESGATOU (via create_order real) cancelado -> stamps volta a 5, rewards_redeemed volta a 0', async () => {
    const res = await callCreateOrder(true);
    if (!res.ok) return { ok: false, detail: 'create_order com recompensa falhou: ' + JSON.stringify(res) };
    orderResgateId = res.order_id;
    const antes = await client.query(`SELECT stamps, rewards_redeemed FROM public.loyalty_accounts WHERE customer_id=$1`, [customerId]);
    await client.query(`UPDATE public.orders SET status='cancelado' WHERE id=$1`, [orderResgateId]);
    const depois = await client.query(`SELECT stamps, rewards_redeemed FROM public.loyalty_accounts WHERE customer_id=$1`, [customerId]);
    const ev = await client.query(`SELECT tipo, delta, origem FROM public.loyalty_events WHERE order_id=$1 AND origem='cancel_trigger_resgate'`, [orderResgateId]);
    const ok = antes.rows[0].stamps === 0 && antes.rows[0].rewards_redeemed === 1
      && depois.rows[0].stamps === 5 && depois.rows[0].rewards_redeemed === 0
      && ev.rows.length === 1 && ev.rows[0].tipo === 'adjustment' && ev.rows[0].delta === 5;
    return { ok, detail: JSON.stringify({ antes: antes.rows[0], depois: depois.rows[0], evento: ev.rows[0] }) };
  });

  // ── B4: idempotencia — mesmo pedido cancela, reabre, cancela de novo -> NAO restaura 2x ──
  await check('B4', 'IDEMPOTENCIA: mesmo pedido resgatado reabre e cancela de novo -> NAO restaura 2x', async () => {
    // orderResgateId ja esta cancelado (de B3) com stamps=5 (ja restaurado uma vez)
    await client.query(`UPDATE public.orders SET status='recebido' WHERE id=$1`, [orderResgateId]);
    await client.query(`UPDATE public.orders SET status='cancelado' WHERE id=$1`, [orderResgateId]);
    const acc = await client.query(`SELECT stamps, rewards_redeemed FROM public.loyalty_accounts WHERE customer_id=$1`, [customerId]);
    const evCount = await client.query(`SELECT count(*)::int AS n FROM public.loyalty_events WHERE order_id=$1 AND origem='cancel_trigger_resgate'`, [orderResgateId]);
    const ok = acc.rows[0].stamps === 5 && evCount.rows[0].n === 1; // continua 5 (nao virou 10), so' 1 evento de restauracao
    return { ok, detail: JSON.stringify({ acc: acc.rows[0], eventosRestauracao: evCount.rows[0].n }) };
  });

  // ── B5: pedido sem nenhum evento de fidelidade cancelado -> no-op seguro (regressao) ──
  await check('B5', 'REGRESSAO: pedido sem nenhum evento de fidelidade cancelado -> no-op seguro (nenhum branch dispara)', async () => {
    const antes = await client.query(`SELECT stamps, rewards_redeemed FROM public.loyalty_accounts WHERE customer_id=$1`, [customerId]);
    const orderId = await novoPedido(customerId);
    await client.query(`UPDATE public.orders SET status='cancelado' WHERE id=$1`, [orderId]);
    const depois = await client.query(`SELECT stamps, rewards_redeemed FROM public.loyalty_accounts WHERE customer_id=$1`, [customerId]);
    const ok = antes.rows[0].stamps === depois.rows[0].stamps && antes.rows[0].rewards_redeemed === depois.rows[0].rewards_redeemed;
    return { ok, detail: JSON.stringify({ antes: antes.rows[0], depois: depois.rows[0] }) };
  });
  out('');

  out('— Resumo —  PASS: ' + passes + '  ·  FAIL: ' + failures);
  await client.query('ROLLBACK');
  out('— ROLLBACK aplicado — zero mutacao liquida no banco E2E —');
  out('— Fingerprint — commit ' + git('rev-parse HEAD') + ' · branch ' + git('rev-parse --abbrev-ref HEAD') + ' · Node ' + process.version + ' · ' + (Date.now() - startedMs) + ' ms · started ' + startedIso);
  out('');

  const body = R.join('\n');
  const sha = createHash('sha256').update(body, 'utf8').digest('hex');
  console.log(body);
  console.log('— Execution Report SHA256 —\n  ' + sha + '\n');
  const state = failures ? 'FAILED' : 'SUCCESS';
  console.log('====================================');
  console.log('ETAPA — TESTES DA FASE (REF-LOYALTY-02 · Onda 5)');
  console.log('STATE: ' + state + ' · PASS=' + passes + ' FAIL=' + failures);
  console.log('BEGIN...ROLLBACK — mutacao liquida ZERO');
  console.log('====================================');
  if (failures) process.exitCode = 1;
} catch (e) {
  console.log(R.join('\n'));
  console.error('SUITE ERROR: ' + redact(e && e.message ? e.message : e));
  console.log('STATE:\nFAILED');
  process.exitCode = 1;
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end().catch(() => {});
}
