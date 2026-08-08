// Suite de verificacao da REF-SAAS-01 · Onda 4.1 (pedidos + fidelidade concedida automaticamente).
// Mesmo rigor das Ondas 2/3, por exigencia permanente do dono: teste positivo E negativo, isolamento
// entre lojas provado por comportamento real (nao por inspecao), regressao contra o fluxo real de
// checkout/cancelamento/reconciliacao.
//
// Achado central desta subfase: as policies de leitura propria de orders/order_items/loyalty_* NAO
// filtravam por loja desde a Onda 3 (que permitiu a mesma pessoa ter customer em 2 lojas) -- um
// vazamento real de historico de pedidos entre lojas. Provado e fechado aqui.
//
// Camada A: estrutural. Camada B: comportamental — SET LOCAL ROLE + request.jwt.claims dentro de
// BEGIN...ROLLBACK. Loja B, seus pedidos/clientes/fidelidade e seu admin sao ficticios, inseridos no
// inicio de cada transacao e desfeitos pelo ROLLBACK — nunca persistem. Exit 0 = SUCCESS.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = 'C:/Users/00thi/.encanto/db.env';

const envGet = (txt, k) => { const m = txt.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
function loadConn() {
  let txt; try { txt = readFileSync(ENV_PATH, 'utf8'); } catch { console.error('ERRO: db.env nao encontrado'); process.exit(2); }
  const host = envGet(txt, 'PGHOST'); const user = envGet(txt, 'PGUSER');
  const password = envGet(txt, 'PGPASSWORD'); if (!password) { console.error('ERRO: PGPASSWORD vazio'); process.exit(2); }
  return { cfg: { host, port: Number(envGet(txt, 'PGPORT') || 5432), user, password, database: envGet(txt, 'PGDATABASE') || 'postgres' }, secret: password, host, user };
}
function projectRef(host, user) { let m = (user || '').match(/postgres\.([a-z0-9]{16,})/i); if (m) return m[1]; m = (host || '').match(/(?:^|\.)([a-z0-9]{16,})\.supabase\./i); return m ? m[1] : '(n/d)'; }
const git = (a) => { try { return execSync('git ' + a, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return '(n/d)'; } };
const isoUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const { cfg, secret, host, user } = loadConn();
const redact = s => { let r = String(s); if (secret) r = r.split(secret).join('[REDACTED]'); return r; };
const client = new pg.Client({ ...cfg, ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

const ADMIN_REAL_USER_ID = 'b9dc7626-af9c-4ab5-95f7-3207e6469129'; // admin real de producao (loja encanto)
const ADMIN_B            = 'ce7ece01-266c-42b1-a9db-8051da24d7f5'; // vira admin da loja B FICTICIA
const SAME_PERSON        = '27bd5049-60e5-4980-abe9-3bd7942a6c31'; // cliente com pedido/fidelidade em 2 lojas
const STRANGER           = '4fa5541f-989f-4b8d-89b4-7b45a59d8f4e'; // autenticado, zero customer/admin

const STORE_B_ID      = 'dddddddd-bbbb-4000-8000-000000000001';
const CUSTOMER_A_ID   = 'dddddddd-1111-4000-8000-00000000000a';
const CUSTOMER_B_ID   = 'dddddddd-1111-4000-8000-00000000000b';
const ORDER_A_ID      = 'dddddddd-2222-4000-8000-00000000000a';
const ORDER_B_ID      = 'dddddddd-2222-4000-8000-00000000000b';
const ORDER_ITEM_A_ID = 'dddddddd-3333-4000-8000-00000000000a';
const ORDER_ITEM_B_ID = 'dddddddd-3333-4000-8000-00000000000b';

const R = []; const out = (s = '') => R.push(s);
let passes = 0, failures = 0, spCounter = 0;
const startedMs = Date.now(), startedIso = isoUtc();
function record(id, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} ${desc}`); out(`         -> ${detail}`);
}
async function tx(role, sub, setupSql, fn) {
  try {
    await client.query('BEGIN');
    for (const s of (setupSql || [])) await client.query(s);
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(sub ? { sub, role } : { role })]);
    await client.query(`SET LOCAL ROLE ${role}`);
    return await fn();
  } finally { await client.query('ROLLBACK').catch(() => {}); }
}
async function txSuper(setupSql, fn) {
  try {
    await client.query('BEGIN');
    for (const s of (setupSql || [])) await client.query(s);
    return await fn();
  } finally { await client.query('ROLLBACK').catch(() => {}); }
}
async function expectRows(id, desc, sql, params, expected) {
  const r = await client.query(sql, params);
  const ok = r.rowCount === expected;
  record(id, desc, ok ? 'PASS' : 'FAIL', `rows=${r.rowCount} (esperado ${expected})`);
}
async function attempt(id, desc, sql, params, allow) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  let rowCount = null, errMsg = null;
  try { const r = await client.query(sql, params); rowCount = r.rowCount; await client.query(`RELEASE SAVEPOINT ${sp}`); }
  catch (e) { errMsg = redact(e.message).split('\n')[0]; await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); }
  const ok = allow ? (errMsg === null && rowCount >= 1) : (errMsg !== null || rowCount === 0);
  record(id, desc, ok ? 'PASS' : 'FAIL', errMsg ? `negado por erro: ${errMsg}` : `linhas afetadas=${rowCount}`);
  return { rowCount, errMsg };
}
async function callRpc(id, desc, sql, params, checkFn) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  let result = null, errMsg = null;
  try { const r = await client.query(sql, params); result = r.rows[0]; await client.query(`RELEASE SAVEPOINT ${sp}`); }
  catch (e) { errMsg = redact(e.message).split('\n')[0]; await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); }
  const { ok, detail } = checkFn(result, errMsg);
  record(id, desc, ok ? 'PASS' : 'FAIL', detail);
  return result;
}

function setupSql(encantoId) {
  return [
    `INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_B_ID}', 'loja-b-teste-onda41', 'Loja B (fake, teste Onda 4.1)', NULL, 'ativo')`,
    `INSERT INTO public.admins (user_id, store_id) VALUES ('${ADMIN_B}', '${STORE_B_ID}')`,
    `INSERT INTO public.customers (id, name, phone, auth_user_id, store_id) VALUES ('${CUSTOMER_A_ID}', 'Pessoa X (fake onda41)', '47988880001', '${SAME_PERSON}', '${encantoId}')`,
    `INSERT INTO public.customers (id, name, phone, auth_user_id, store_id) VALUES ('${CUSTOMER_B_ID}', 'Pessoa X (fake onda41, loja B)', '47988880001', '${SAME_PERSON}', '${STORE_B_ID}')`,
    // INSERT em orders dispara de verdade trg_orders_audit_ins (cria order_events PEDIDO_CRIADO) e
    // trg_enc_order_notify (enfileira notification_outbox) -- testamos o comportamento REAL do
    // trigger, nao um fixture artificial.
    `INSERT INTO public.orders (id, customer_id, total, status, payment_method, address, store_id) VALUES ('${ORDER_A_ID}', '${CUSTOMER_A_ID}', 50.00, 'recebido', 'pix', 'Rua A, 1', '${encantoId}')`,
    `INSERT INTO public.orders (id, customer_id, total, status, payment_method, address, store_id) VALUES ('${ORDER_B_ID}', '${CUSTOMER_B_ID}', 60.00, 'recebido', 'pix', 'Rua B, 1', '${STORE_B_ID}')`,
    `INSERT INTO public.order_items (id, order_id, quantity, price, nome_produto, store_id) VALUES ('${ORDER_ITEM_A_ID}', '${ORDER_A_ID}', 1, 50.00, 'Item A', '${encantoId}')`,
    `INSERT INTO public.order_items (id, order_id, quantity, price, nome_produto, store_id) VALUES ('${ORDER_ITEM_B_ID}', '${ORDER_B_ID}', 1, 60.00, 'Item B', '${STORE_B_ID}')`,
    `INSERT INTO public.loyalty_accounts (customer_id, stamps, store_id) VALUES ('${CUSTOMER_A_ID}', 1, '${encantoId}')`,
    `INSERT INTO public.loyalty_accounts (customer_id, stamps, store_id) VALUES ('${CUSTOMER_B_ID}', 2, '${STORE_B_ID}')`,
    `INSERT INTO public.loyalty_events (customer_id, order_id, tipo, delta, stamps_after, origem, store_id) VALUES ('${CUSTOMER_A_ID}', '${ORDER_A_ID}', 'earned', 1, 1, 'create_order', '${encantoId}')`,
    `INSERT INTO public.loyalty_events (customer_id, order_id, tipo, delta, stamps_after, origem, store_id) VALUES ('${CUSTOMER_B_ID}', '${ORDER_B_ID}', 'earned', 1, 2, 'create_order', '${STORE_B_ID}')`,
  ];
}
const SUPER_ADMIN_SETUP = `INSERT INTO public.super_admins (user_id) VALUES ('${ADMIN_REAL_USER_ID}')`;

try {
  out('===================================================================');
  out(' SUITE — REF-SAAS-01 · Onda 4.1 (pedidos + fidelidade) — RELATORIO');
  out('===================================================================');
  out('Camada A: somente leitura. Camada B: simulacao de sessao dentro de BEGIN...ROLLBACK (mutacao liquida = 0).');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessao ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  const encantoId = (await client.query(`SELECT id FROM public.stores WHERE slug = 'encanto'`)).rows[0].id;
  out('— Loja encanto resolvida (fora de qualquer sessao simulada, como superuser): ' + encantoId + ' —');
  // Producao ja tem pedidos reais (nao e uma base vazia) -- as asserções de admin real usam este
  // numero + 1 (o pedido fake desta suite), em vez de assumir "1" como se o banco comecasse do zero.
  const realOrdersTotal = (await client.query(`SELECT count(*)::int AS n FROM public.orders`)).rows[0].n;
  out('— Contagem real de pedidos em producao (fora de sessao simulada): ' + realOrdersTotal + ' —');
  out('');

  // ---------------- Camada A: estrutural ----------------
  out('— A1: store_id NOT NULL nas 6 tabelas desta subfase —');
  {
    const r = await client.query(`
      SELECT table_name, is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND column_name='store_id'
        AND table_name IN ('orders','order_items','order_events','loyalty_accounts','loyalty_events','notification_outbox')
      ORDER BY table_name`);
    const ok = r.rows.length === 6 && r.rows.every(x => x.is_nullable === 'NO');
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A1 store_id NOT NULL nas 6 tabelas`); out(`         -> ${JSON.stringify(r.rows)}`);
  }
  out('');

  out('— A2: create_order tem exatamente 1 overload (5 args, com p_store_id) — nao repetiu o incidente da Onda 3 —');
  {
    const r = await client.query(`SELECT pg_get_function_identity_arguments(oid) AS args FROM pg_proc WHERE proname='create_order' AND pronamespace='public'::regnamespace`);
    const ok = r.rows.length === 1 && r.rows[0].args.includes('p_store_id');
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A2 create_order com 1 overload so, incluindo p_store_id`); out(`         -> ${JSON.stringify(r.rows)}`);
  }
  out('');

  out('— A3: orders_health tem exatamente 1 overload (1 arg, com p_store_id) —');
  {
    const r = await client.query(`SELECT pg_get_function_identity_arguments(oid) AS args FROM pg_proc WHERE proname='orders_health' AND pronamespace='public'::regnamespace`);
    const ok = r.rows.length === 1 && r.rows[0].args.includes('p_store_id');
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A3 orders_health com 1 overload so, incluindo p_store_id`); out(`         -> ${JSON.stringify(r.rows)}`);
  }
  out('');

  out('— A4: policies de escrita admin das 6 tabelas citam is_admin_of; leituras proprias citam store_id —');
  {
    const r = await client.query(`
      SELECT polrelid::regclass::text AS tabela, polname, pg_get_expr(polqual, polrelid) AS using_expr
      FROM pg_policy
      WHERE polrelid IN ('public.orders'::regclass,'public.order_items'::regclass,'public.order_events'::regclass,
                          'public.loyalty_accounts'::regclass,'public.loyalty_events'::regclass,'public.notification_outbox'::regclass)`);
    const adminPolicies = r.rows.filter(x => /admin/i.test(x.polname));
    const clientPolicies = r.rows.filter(x => /proprio|read_own/i.test(x.polname));
    const okAdmin = adminPolicies.every(x => x.using_expr.includes('is_admin_of'));
    const okClient = clientPolicies.every(x => x.using_expr.includes('store_id'));
    const ok = okAdmin && okClient && adminPolicies.length === 5 && clientPolicies.length === 5;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A4 policies das 6 tabelas atualizadas`); out(`         -> admin=${adminPolicies.length}(ok=${okAdmin}) cliente=${clientPolicies.length}(ok=${okClient})`);
  }
  out('');

  // ---------------- Camada B: comportamental ----------------

  out('— CHECKOUT-P1: create_order (anon) SEM p_store_id cria pedido/cliente/fidelidade com store_id=encanto (regressao) —');
  // loyalty_enabled esta 'false' em producao agora (config operacional real, nao bug) -- forcado a
  // 'true' SO dentro desta transacao (ROLLBACK desfaz) pra exercitar o caminho de concessao de selo
  // de forma deterministica, sem depender do toggle real do dono.
  await tx('anon', null, [`INSERT INTO public.settings (chave, valor) VALUES ('loyalty_enabled','true') ON CONFLICT (chave) DO UPDATE SET valor='true'`], async () => {
    const payload = { p_customer: { name: 'Cliente Checkout Onda41', phone: '47977770001' },
      p_order: { total: 33.0, payment_method: 'pix', address: 'Rua Checkout, 1' },
      p_items: [{ nome_produto: 'Item Checkout', quantity: 1, price: 33.0 }] };
    const r = await client.query(`SELECT public.create_order($1::jsonb,$2::jsonb,$3::jsonb) AS r`,
      [JSON.stringify(payload.p_customer), JSON.stringify(payload.p_order), JSON.stringify(payload.p_items)]);
    const res = r.rows[0].r;
    await client.query('RESET ROLE');
    let ok = false, detail = {};
    if (res?.ok) {
      const o = await client.query(`SELECT store_id FROM public.orders WHERE id = $1`, [res.order_id]);
      const oi = await client.query(`SELECT store_id FROM public.order_items WHERE order_id = $1`, [res.order_id]);
      const ev = await client.query(`SELECT tipo, store_id FROM public.order_events WHERE order_id = $1 ORDER BY created_at`, [res.order_id]);
      const cust = await client.query(`SELECT id, store_id FROM public.customers WHERE phone = '47977770001'`);
      const la = await client.query(`SELECT stamps, store_id FROM public.loyalty_accounts WHERE customer_id = $1`, [cust.rows[0]?.id]);
      ok = o.rows[0]?.store_id === encantoId && oi.rows.every(x => x.store_id === encantoId)
        && ev.rows.some(x => x.tipo === 'PEDIDO_CRIADO' && x.store_id === encantoId)
        && cust.rows[0]?.store_id === encantoId && la.rows[0]?.store_id === encantoId && la.rows[0]?.stamps === 1;
      detail = { order: o.rows[0], items: oi.rows, events: ev.rows, customer: cust.rows[0], loyalty: la.rows[0] };
    }
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] CHECKOUT-P1 pedido/itens/evento/cliente/fidelidade todos com store_id=encanto`);
    out(`         -> resultado=${JSON.stringify(res)} · detalhe=${JSON.stringify(detail)}`);
  });
  out('');

  out('— CHECKOUT-P2: create_order (anon) COM p_store_id=lojaB cria tudo isolado na loja B —');
  await tx('anon', null, [`INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_B_ID}', 'loja-b-teste-onda41', 'Loja B (fake, teste Onda 4.1)', NULL, 'ativo')`], async () => {
    const payload = { p_customer: { name: 'Cliente Checkout B Onda41', phone: '47977770002' },
      p_order: { total: 44.0, payment_method: 'pix', address: 'Rua Checkout B, 1' },
      p_items: [{ nome_produto: 'Item Checkout B', quantity: 1, price: 44.0 }] };
    const r = await client.query(`SELECT public.create_order($1::jsonb,$2::jsonb,$3::jsonb, NULL, $4) AS r`,
      [JSON.stringify(payload.p_customer), JSON.stringify(payload.p_order), JSON.stringify(payload.p_items), STORE_B_ID]);
    const res = r.rows[0].r;
    await client.query('RESET ROLE');
    let ok = false;
    if (res?.ok) {
      const o = await client.query(`SELECT store_id FROM public.orders WHERE id = $1`, [res.order_id]);
      ok = o.rows[0]?.store_id === STORE_B_ID;
    }
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] CHECKOUT-P2 pedido explicito na loja B fica isolado la`);
    out(`         -> resultado=${JSON.stringify(res)}`);
  });
  out('');

  out('— ISOLAMENTO: a mesma pessoa (SAME_PERSON) so ve, via RLS, pedidos/itens/eventos/fidelidade da PROPRIA loja —');
  await tx('authenticated', SAME_PERSON, setupSql(encantoId), async () => {
    // Consulta no MESMO formato vulneravel de antes da correcao (sem filtro de loja no WHERE) --
    // a garantia agora vem inteiramente da RLS, nao da query.
    await expectRows('ISO-orders-P', 've o proprio pedido de encanto', `SELECT 1 FROM public.orders WHERE customer_id IN (SELECT id FROM public.customers WHERE auth_user_id = $1) AND id = $2`, [SAME_PERSON, ORDER_A_ID], 1);
    await expectRows('ISO-orders-N', 'NAO ve o pedido da loja B, mesmo sendo a mesma pessoa', `SELECT 1 FROM public.orders WHERE customer_id IN (SELECT id FROM public.customers WHERE auth_user_id = $1) AND id = $2`, [SAME_PERSON, ORDER_B_ID], 0);
    await expectRows('ISO-items-P', 've os itens do proprio pedido', `SELECT 1 FROM public.order_items WHERE id = $1`, [ORDER_ITEM_A_ID], 1);
    await expectRows('ISO-items-N', 'NAO ve os itens do pedido da loja B', `SELECT 1 FROM public.order_items WHERE id = $1`, [ORDER_ITEM_B_ID], 0);
    await expectRows('ISO-events-P', 've os eventos do proprio pedido (PEDIDO_CRIADO via trigger real)', `SELECT 1 FROM public.order_events WHERE order_id = $1 AND tipo = 'PEDIDO_CRIADO'`, [ORDER_A_ID], 1);
    await expectRows('ISO-events-N', 'NAO ve os eventos do pedido da loja B', `SELECT 1 FROM public.order_events WHERE order_id = $1`, [ORDER_B_ID], 0);
    await expectRows('ISO-loyacc-P', 've a propria conta de fidelidade (encanto)', `SELECT 1 FROM public.loyalty_accounts WHERE customer_id = $1`, [CUSTOMER_A_ID], 1);
    await expectRows('ISO-loyacc-N', 'NAO ve a conta de fidelidade da loja B, mesma pessoa', `SELECT 1 FROM public.loyalty_accounts WHERE customer_id = $1`, [CUSTOMER_B_ID], 0);
    await expectRows('ISO-loyev-P', 've o proprio evento de fidelidade (encanto)', `SELECT 1 FROM public.loyalty_events WHERE customer_id = $1`, [CUSTOMER_A_ID], 1);
    await expectRows('ISO-loyev-N', 'NAO ve o evento de fidelidade da loja B', `SELECT 1 FROM public.loyalty_events WHERE customer_id = $1`, [CUSTOMER_B_ID], 0);
  });
  out('');

  out('— Sessao: stranger (autenticado, zero customer/admin em qualquer loja) —');
  await tx('authenticated', STRANGER, setupSql(encantoId), async () => {
    await expectRows('STRANGER-orders', 'nao ve pedido alheio', `SELECT 1 FROM public.orders WHERE id = $1`, [ORDER_A_ID], 0);
    await attempt('STRANGER-upd', 'nao consegue atualizar pedido alheio', `UPDATE public.orders SET observacoes='x' WHERE id = $1`, [ORDER_A_ID], false);
    await callRpc('STRANGER-health', 'orders_health NEGA pra autenticado que nao e admin (fecha o achado de seguranca pre-existente)',
      `SELECT public.orders_health($1) AS r`, [encantoId],
      (row, err) => ({ ok: err !== null && err.includes('apenas administradores'), detail: err || JSON.stringify(row) }));
  });
  out('');

  out('— Sessao: anon (sem autenticacao) —');
  await tx('anon', null, setupSql(encantoId), async () => {
    await attempt('ANON-orders', 'anon nao consegue ler orders (sem grant, mesmo achado da Onda 3 p/ customers)', `SELECT 1 FROM public.orders WHERE id = $1`, [ORDER_A_ID], false);
    await attempt('ANON-health', 'anon nao consegue nem chamar orders_health (sem EXECUTE grant)', `SELECT public.orders_health($1) AS r`, [encantoId], false);
  });
  out('');

  out('— Sessao: admin real (encanto) —');
  await tx('authenticated', ADMIN_REAL_USER_ID, setupSql(encantoId), async () => {
    await expectRows('ADMINA-orders-P', 'admin real ve pedido de encanto (regressao)', `SELECT 1 FROM public.orders WHERE id = $1`, [ORDER_A_ID], 1);
    await expectRows('ADMINA-orders-N', 'admin real NAO ve pedido da loja B (isolamento)', `SELECT 1 FROM public.orders WHERE id = $1`, [ORDER_B_ID], 0);
    await attempt('ADMINA-upd-P', 'admin real atualiza pedido de encanto (regressao)', `UPDATE public.orders SET observacoes='editado' WHERE id = $1`, [ORDER_A_ID], true);
    await attempt('ADMINA-upd-N', 'admin real NAO consegue atualizar pedido da loja B', `UPDATE public.orders SET observacoes='invasao' WHERE id = $1`, [ORDER_B_ID], false);
    await callRpc('ADMINA-health', 'orders_health da propria loja retorna pedidos_total = real+1 (banco de producao, nao vazio)',
      `SELECT public.orders_health($1) AS r`, [encantoId],
      (row) => ({ ok: row?.r?.pedidos_total === realOrdersTotal + 1, detail: `pedidos_total=${row?.r?.pedidos_total} esperado=${realOrdersTotal + 1}` }));
    // admin_orders_search nao e SECURITY DEFINER -- herda a RLS do chamador. Com centenas de pedidos
    // reais de encanto, o teste correto e "o pedido fake aparece" (presenca), nao "e o unico" (banco
    // de producao nunca esta vazio).
    const searchRows = await client.query(`SELECT id FROM public.admin_orders_search(NULL, NULL, 200, NULL, NULL)`);
    const okSearch = searchRows.rows.some(x => x.id === ORDER_A_ID) && !searchRows.rows.some(x => x.id === ORDER_B_ID);
    record('ADMINA-search', 'admin_orders_search inclui o pedido de encanto e NUNCA inclui o da loja B', okSearch ? 'PASS' : 'FAIL', `total_rows=${searchRows.rowCount}`);
    const statsRow = await client.query(`SELECT public.admin_orders_stats() AS s`);
    const okStats = statsRow.rows[0].s.total_geral === realOrdersTotal + 1;
    record('ADMINA-stats', 'admin_orders_stats conta real+1 (regressao + isolamento)', okStats ? 'PASS' : 'FAIL', JSON.stringify(statsRow.rows[0].s));
  });
  out('');

  out('— Sessao: admin ficticio da loja B —');
  // NOTA: esta persona (ADMIN_B) e um auth.users REAL que tambem e cliente de verdade da Encanto (com
  // pedidos reais la, nada a ver com o teste) -- por isso a policy "Cliente le proprios orders" mostra
  // o historico REAL dela tambem, corretamente. O teste checa presenca/ausencia dos ids fake, nao uma
  // contagem exata (que dependeria de quantos pedidos reais essa pessoa especifica ja fez).
  await tx('authenticated', ADMIN_B, setupSql(encantoId), async () => {
    await expectRows('ADMINB-orders-P', 'admin B ve pedido da propria loja', `SELECT 1 FROM public.orders WHERE id = $1`, [ORDER_B_ID], 1);
    await expectRows('ADMINB-orders-N', 'admin B NAO ve pedido de encanto', `SELECT 1 FROM public.orders WHERE id = $1`, [ORDER_A_ID], 0);
    await attempt('ADMINB-upd-P', 'admin B atualiza pedido da propria loja', `UPDATE public.orders SET observacoes='editado B' WHERE id = $1`, [ORDER_B_ID], true);
    await attempt('ADMINB-upd-N', 'admin B NAO consegue atualizar pedido de encanto', `UPDATE public.orders SET observacoes='invasao B' WHERE id = $1`, [ORDER_A_ID], false);
    await callRpc('ADMINB-health', 'orders_health da loja B retorna pedidos_total correto (so o da loja B, loja ficticia sem historico)',
      `SELECT public.orders_health($1) AS r`, [STORE_B_ID],
      (row) => ({ ok: row?.r?.pedidos_total === 1, detail: JSON.stringify(row?.r) }));
    const searchRows = await client.query(`SELECT id FROM public.admin_orders_search(NULL, NULL, 200, NULL, NULL)`);
    const okSearch = searchRows.rows.some(x => x.id === ORDER_B_ID) && !searchRows.rows.some(x => x.id === ORDER_A_ID);
    record('ADMINB-search', 'admin_orders_search (admin B) inclui o pedido da loja B e nunca o de encanto', okSearch ? 'PASS' : 'FAIL', `total_rows=${searchRows.rowCount}`);
  });
  out('');

  out('— Sessao: super admin ficticio —');
  await tx('authenticated', ADMIN_REAL_USER_ID, [...setupSql(encantoId), SUPER_ADMIN_SETUP], async () => {
    await expectRows('SUPER-orders', 'super admin ve pedido da loja B mesmo sem linha em admins', `SELECT 1 FROM public.orders WHERE id = $1`, [ORDER_B_ID], 1);
    await attempt('SUPER-upd', 'super admin atualiza pedido da loja B', `UPDATE public.orders SET observacoes='super' WHERE id = $1`, [ORDER_B_ID], true);
    await callRpc('SUPER-health', 'orders_health de qualquer loja funciona pro super admin',
      `SELECT public.orders_health($1) AS r`, [STORE_B_ID],
      (row) => ({ ok: row?.r?.pedidos_total === 1, detail: JSON.stringify(row?.r) }));
  });
  out('');

  out('— REGRAS DE NEGOCIO: cancelar pedido reverte selo (loyalty_void_on_cancel); reabrir restaura —');
  await tx('authenticated', ADMIN_REAL_USER_ID, setupSql(encantoId), async () => {
    await client.query(`UPDATE public.orders SET status = 'cancelado' WHERE id = $1`, [ORDER_A_ID]);
    const afterCancel = await client.query(`SELECT stamps FROM public.loyalty_accounts WHERE customer_id = $1`, [CUSTOMER_A_ID]);
    const revokedEvent = await client.query(`SELECT store_id FROM public.loyalty_events WHERE order_id = $1 AND tipo = 'revoked'`, [ORDER_A_ID]);
    const okCancel = afterCancel.rows[0]?.stamps === 0 && revokedEvent.rowCount === 1 && revokedEvent.rows[0].store_id === encantoId;
    record('CANCEL-revoke', 'cancelar reverte o selo e registra loyalty_events com store_id correto', okCancel ? 'PASS' : 'FAIL', `stamps=${afterCancel.rows[0]?.stamps} · evento=${JSON.stringify(revokedEvent.rows)}`);

    await client.query(`UPDATE public.orders SET status = 'recebido' WHERE id = $1`, [ORDER_A_ID]);
    const afterReopen = await client.query(`SELECT stamps FROM public.loyalty_accounts WHERE customer_id = $1`, [CUSTOMER_A_ID]);
    const adjEvent = await client.query(`SELECT store_id FROM public.loyalty_events WHERE order_id = $1 AND tipo = 'adjustment'`, [ORDER_A_ID]);
    const okReopen = afterReopen.rows[0]?.stamps === 1 && adjEvent.rowCount === 1 && adjEvent.rows[0].store_id === encantoId;
    record('CANCEL-reopen', 'reabrir restaura o selo e registra loyalty_events com store_id correto', okReopen ? 'PASS' : 'FAIL', `stamps=${afterReopen.rows[0]?.stamps} · evento=${JSON.stringify(adjEvent.rows)}`);
  });
  out('');

  out('— admin_adjust_loyalty: admin real ajusta encanto (permitido), NEGA ajustar loja B (isolamento) —');
  await tx('authenticated', ADMIN_REAL_USER_ID, setupSql(encantoId), async () => {
    await callRpc('ADJ-P', 'admin real ajusta fidelidade de cliente de encanto', `SELECT public.admin_adjust_loyalty($1, 1, 'teste') AS r`, [CUSTOMER_A_ID],
      (row) => ({ ok: row?.r?.ok === true, detail: JSON.stringify(row?.r) }));
    await callRpc('ADJ-N', 'admin real NAO consegue ajustar fidelidade de cliente da loja B', `SELECT public.admin_adjust_loyalty($1, 1, 'invasao') AS r`, [CUSTOMER_B_ID],
      (row) => ({ ok: row?.r?.ok === false && row?.r?.error === 'sem permissao', detail: JSON.stringify(row?.r) }));
  });
  out('');

  out('— RECONCILIACAO: reconcile_orders registra order_events com store_id correto para pedido divergente —');
  await tx('authenticated', ADMIN_REAL_USER_ID, [...setupSql(encantoId),
    // forca uma divergencia real: total do pedido != soma dos itens
    `UPDATE public.orders SET total = 999.99 WHERE id = '${ORDER_A_ID}'`,
  ], async () => {
    await client.query(`SELECT public.reconcile_orders($1)`, [ORDER_A_ID]);
    const ev = await client.query(`SELECT store_id FROM public.order_events WHERE order_id = $1 AND tipo = 'RECONCILIACAO_DIVERGENTE'`, [ORDER_A_ID]);
    const ok = ev.rowCount === 1 && ev.rows[0].store_id === encantoId;
    record('RECONCILE', 'reconcile_orders registra divergencia com store_id da propria loja', ok ? 'PASS' : 'FAIL', JSON.stringify(ev.rows));
  });
  out('');

  out('— REGRESSAO-01: zero mutacao liquida em producao apos toda a suite —');
  {
    const r = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.stores WHERE id = '${STORE_B_ID}') AS loja_b,
        (SELECT count(*)::int FROM public.admins WHERE store_id = '${STORE_B_ID}') AS admin_b,
        (SELECT count(*)::int FROM public.super_admins WHERE user_id = '${ADMIN_REAL_USER_ID}') AS super_admin,
        (SELECT count(*)::int FROM public.orders WHERE id IN ('${ORDER_A_ID}','${ORDER_B_ID}')) AS pedidos_fake,
        (SELECT count(*)::int FROM public.customers WHERE id IN ('${CUSTOMER_A_ID}','${CUSTOMER_B_ID}')) AS clientes_fake,
        (SELECT count(*)::int FROM public.customers WHERE phone IN ('47977770001','47977770002')) AS clientes_checkout`);
    const row = r.rows[0];
    const ok = Object.values(row).every(n => n === 0);
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] REGRESSAO-01 zero mutacao liquida`); out(`         -> ${JSON.stringify(row)}`);
  }
  out('');

  out('— Resumo —  PASS: ' + passes + '  ·  FAIL: ' + failures);
  out('— Fingerprint — commit ' + git('rev-parse HEAD') + ' · branch ' + git('rev-parse --abbrev-ref HEAD') + ' · Node ' + process.version + ' · ' + (Date.now() - startedMs) + ' ms · started ' + startedIso);
  out('');

  const body = R.join('\n');
  const sha = createHash('sha256').update(body, 'utf8').digest('hex');
  console.log(body);
  console.log('— Execution Report SHA256 —\n  ' + sha + '\n');
  const state = failures ? 'FAILED' : 'SUCCESS';
  console.log('====================================');
  console.log('ETAPA — TESTES DA FASE (REF-SAAS-01 · Onda 4.1)');
  console.log('STATE: ' + state + ' · PASS=' + passes + ' FAIL=' + failures);
  console.log('Camada B roda em BEGIN...ROLLBACK — mutacao liquida ZERO');
  console.log('====================================');
  if (failures) process.exitCode = 1;
} catch (e) {
  console.log(R.join('\n'));
  console.error('SUITE ERROR: ' + redact(e && e.message ? e.message : e));
  console.log('STATE:\nFAILED');
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
