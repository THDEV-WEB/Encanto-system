// Suite de verificacao da REF-LOYALTY-02 · Onda 6 (re-debita a recompensa resgatada quando um
// pedido -- que ja teve o resgate restaurado pela Onda 5 -- e' REABERTO). Mesmo estilo/rigor de
// scripts/loyalty-02-onda5-test.mjs. BEGIN...ROLLBACK contra o E2E, loja/cliente/pedidos
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

const STORE_ID = '10ada005-aaaa-4000-8000-000000000002'; // ficticia, dedicada a Onda 6 (nao colide com Onda 5)

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
const PRODUCT_ID = '10ada005-bbbb-4000-8000-000000000002';
const ADMIN_PERSONA = 'bc45ac7f-948a-4571-8df9-ce544757bcad'; // e2e-admin-b@teste.encanto.local (real, existe hoje no E2E)
async function setRole(role, sub, tenantId) {
  const claims = { ...(sub ? { sub } : {}), ...(tenantId ? { tenant_id: tenantId } : {}), role };
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  await client.query(`SET LOCAL ROLE ${role}`);
}
async function resetRole() { await client.query(`RESET ROLE`); await client.query(`SELECT set_config('request.jwt.claims', '{}', true)`); }
async function callCreateOrder(usarRecompensa, phone, nome) {
  await setRole('authenticated', ADMIN_PERSONA, STORE_ID);
  const customer = { name: nome, phone };
  const order = { payment_method: 'dinheiro', address: 'Retirada na loja - teste', retirada: true, tipo_pedido: 'retirada',
    ...(usarRecompensa ? { usar_recompensa_fidelidade: true } : {}) };
  const items = [{ product_id: PRODUCT_ID, nome_produto: 'Produto Onda6 (fake)', quantity: 1 }];
  const r = await client.query(`SELECT public.create_order($1::jsonb, $2::jsonb, $3::jsonb, NULL, $4::uuid) AS r`,
    [JSON.stringify(customer), JSON.stringify(order), JSON.stringify(items), STORE_ID]);
  await resetRole();
  return r.rows[0].r;
}
async function contaDe(customerId) {
  const r = await client.query(`SELECT stamps, rewards_redeemed FROM public.loyalty_accounts WHERE customer_id=$1`, [customerId]);
  return r.rows[0];
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

  out('=== CAMADA B — REGRESSAO da Onda 5 (100% intocada) ===');
  await client.query(`INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_ID}', 'loja-loyalty02-onda6', 'Loja Onda6 (fake, REF-LOYALTY-02)', NULL, 'ativo')`);
  await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ('${STORE_ID}', 'loyalty_enabled', 'true')`);
  await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ('${STORE_ID}', 'loyalty_required', '5')`);
  await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ('${STORE_ID}', 'loyalty_discount', '30')`);
  await client.query(`INSERT INTO public.products (id, nome, preco, categoria_id, disponivel, store_id) VALUES ('${PRODUCT_ID}', 'Produto Onda6 (fake)', 20.00, NULL, true, '${STORE_ID}')`);

  const custB = await client.query(`INSERT INTO public.customers (name, phone, store_id) VALUES ('Cliente B (fake)', '47966671001', '${STORE_ID}') RETURNING id`);
  const customerB = custB.rows[0].id;
  await client.query(`INSERT INTO public.loyalty_accounts (customer_id, store_id, stamps) VALUES ($1, '${STORE_ID}', 0)`, [customerB]);

  await check('B1', 'REGRESSAO: selo GANHO revertido ao cancelar e restaurado ao reabrir (logica intocada)', async () => {
    const orderId = await novoPedido(customerB);
    await client.query(`SELECT public.loyalty_grant($1, $2)`, [customerB, orderId]);
    await client.query(`UPDATE public.orders SET status='cancelado' WHERE id=$1`, [orderId]);
    await client.query(`UPDATE public.orders SET status='recebido' WHERE id=$1`, [orderId]);
    const acc = await contaDe(customerB);
    const ok = acc.stamps === 1; // ganhou, cancelou (0), reabriu (1 de novo)
    return { ok, detail: JSON.stringify(acc) };
  });

  await check('B2', 'REGRESSAO: pedido sem NENHUM evento de fidelidade cancelado+reaberto -> no-op seguro (nenhum branch novo dispara)', async () => {
    const antes = await contaDe(customerB);
    const orderId = await novoPedido(customerB);
    await client.query(`UPDATE public.orders SET status='cancelado' WHERE id=$1`, [orderId]);
    await client.query(`UPDATE public.orders SET status='recebido' WHERE id=$1`, [orderId]);
    const depois = await contaDe(customerB);
    const evCount = await client.query(`SELECT count(*)::int AS n FROM public.loyalty_events WHERE order_id=$1 AND origem LIKE 'cancel_trigger_resgate%'`, [orderId]);
    const ok = antes.stamps === depois.stamps && antes.rewards_redeemed === depois.rewards_redeemed && evCount.rows[0].n === 0;
    return { ok, detail: JSON.stringify({ antes, depois, eventosResgate: evCount.rows[0].n }) };
  });
  out('');

  out('=== CAMADA C — NOVO: re-debito ao reabrir pedido resgatado ===');

  // ── C1: fluxo feliz — resgata, cancela (Onda5 restaura), reabre (Onda6 re-debita) ──
  const custC = await client.query(`INSERT INTO public.customers (name, phone, store_id) VALUES ('Cliente C (fake)', '47966671002', '${STORE_ID}') RETURNING id`);
  const customerC = custC.rows[0].id;
  await client.query(`INSERT INTO public.loyalty_accounts (customer_id, store_id, stamps, rewards_redeemed) VALUES ($1, '${STORE_ID}', 5, 0)`, [customerC]);
  let orderC;
  await check('C1', 'NOVO: pedido resgatado (create_order real) -> cancelado (Onda5 restaura) -> REABERTO (Onda6 re-debita de volta)', async () => {
    const res = await callCreateOrder(true, '47966671002', 'Cliente C (fake)');
    if (!res.ok) return { ok: false, detail: 'create_order com recompensa falhou: ' + JSON.stringify(res) };
    orderC = res.order_id;
    const posResgate = await contaDe(customerC);
    await client.query(`UPDATE public.orders SET status='cancelado' WHERE id=$1`, [orderC]);
    const posCancelar = await contaDe(customerC);
    await client.query(`UPDATE public.orders SET status='recebido' WHERE id=$1`, [orderC]);
    const posReabrir = await contaDe(customerC);
    const ev = await client.query(`SELECT tipo, delta, origem FROM public.loyalty_events WHERE order_id=$1 AND origem='cancel_trigger_resgate_revert'`, [orderC]);
    const ok = posResgate.stamps === 0 && posResgate.rewards_redeemed === 1
      && posCancelar.stamps === 5 && posCancelar.rewards_redeemed === 0
      && posReabrir.stamps === 0 && posReabrir.rewards_redeemed === 1
      && ev.rows.length === 1 && ev.rows[0].tipo === 'adjustment' && ev.rows[0].delta === -5;
    return { ok, detail: JSON.stringify({ posResgate, posCancelar, posReabrir, evento: ev.rows[0] }) };
  });

  // ── C2: idempotencia — cancela e reabre de novo o MESMO pedido -> nao re-debita 2x ──
  await check('C2', 'IDEMPOTENCIA: mesmo pedido cancela e reabre de novo -> NAO restaura nem re-debita 2x', async () => {
    await client.query(`UPDATE public.orders SET status='cancelado' WHERE id=$1`, [orderC]); // ja restaurado antes (Onda5 idempotente) -> nao restaura de novo
    const posCancelar2 = await contaDe(customerC);
    await client.query(`UPDATE public.orders SET status='recebido' WHERE id=$1`, [orderC]); // ja revertido antes (Onda6 idempotente) -> nao re-debita de novo
    const posReabrir2 = await contaDe(customerC);
    const evRevert = await client.query(`SELECT count(*)::int AS n FROM public.loyalty_events WHERE order_id=$1 AND origem='cancel_trigger_resgate_revert'`, [orderC]);
    const evRestore = await client.query(`SELECT count(*)::int AS n FROM public.loyalty_events WHERE order_id=$1 AND origem='cancel_trigger_resgate'`, [orderC]);
    const ok = posCancelar2.stamps === 0 && posReabrir2.stamps === 0 && evRevert.rows[0].n === 1 && evRestore.rows[0].n === 1;
    return { ok, detail: JSON.stringify({ posCancelar2, posReabrir2, eventosRevert: evRevert.rows[0].n, eventosRestore: evRestore.rows[0].n }) };
  });

  // ── C3: FAIL-CLOSED — cliente ja gastou os selos restaurados em outro resgate antes de reabrir ──
  const custD = await client.query(`INSERT INTO public.customers (name, phone, store_id) VALUES ('Cliente D (fake)', '47966671003', '${STORE_ID}') RETURNING id`);
  const customerD = custD.rows[0].id;
  await client.query(`INSERT INTO public.loyalty_accounts (customer_id, store_id, stamps, rewards_redeemed) VALUES ($1, '${STORE_ID}', 5, 0)`, [customerD]);
  await check('C3', 'FAIL-CLOSED: cliente gasta os selos restaurados em OUTRO resgate antes de reabrir -> NAO debita (evitaria saldo negativo), so registra pendencia', async () => {
    const resA = await callCreateOrder(true, '47966671003', 'Cliente D (fake)');
    if (!resA.ok) return { ok: false, detail: 'create_order (pedido A) falhou: ' + JSON.stringify(resA) };
    const orderA = resA.order_id;
    await client.query(`UPDATE public.orders SET status='cancelado' WHERE id=$1`, [orderA]); // Onda5 restaura: stamps volta a 5
    const posRestaurar = await contaDe(customerD);
    const resB = await callCreateOrder(true, '47966671003', 'Cliente D (fake)'); // cliente gasta os 5 restaurados num pedido B diferente
    if (!resB.ok) return { ok: false, detail: 'create_order (pedido B) falhou: ' + JSON.stringify(resB) };
    const posGastarDeNovo = await contaDe(customerD);
    await client.query(`UPDATE public.orders SET status='recebido' WHERE id=$1`, [orderA]); // reabre o pedido A -> sem saldo pra re-debitar
    const posReabrirA = await contaDe(customerD);
    const evPendente = await client.query(`SELECT tipo, delta, origem FROM public.loyalty_events WHERE order_id=$1 AND origem='cancel_trigger_resgate_revert_pendente'`, [orderA]);
    const evRevertReal = await client.query(`SELECT count(*)::int AS n FROM public.loyalty_events WHERE order_id=$1 AND origem='cancel_trigger_resgate_revert'`, [orderA]);
    const ok = posRestaurar.stamps === 5
      && posGastarDeNovo.stamps === 0 && posGastarDeNovo.rewards_redeemed === 1
      && posReabrirA.stamps === 0 // NAO foi pro negativo, NAO debitou
      && evPendente.rows.length === 1 && evPendente.rows[0].delta === 0
      && evRevertReal.rows[0].n === 0; // nenhum revert real aconteceu
    return { ok, detail: JSON.stringify({ posRestaurar, posGastarDeNovo, posReabrirA, pendente: evPendente.rows[0], revertsReais: evRevertReal.rows[0].n }) };
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
  console.log('ETAPA — TESTES DA FASE (REF-LOYALTY-02 · Onda 6)');
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
