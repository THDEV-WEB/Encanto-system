// Suite de verificacao da REF-SAAS-01 · Onda 5 (admin multi-loja — backend). Mesmo rigor das ondas
// anteriores. Exigencia central desta onda, por pedido explicito do dono: A UI NUNCA E MECANISMO DE
// SEGURANCA — a selecao de loja no client define so o contexto operacional; a autorizacao real
// continua sendo garantida pelo banco (RLS/RPCs). Provado abaixo com teste negativo explicito: um
// admin que INFORMA o p_store_id de uma loja que nao administra e negado mesmo assim.
//
// Camada A: estrutural. Camada B: comportamental — SET LOCAL ROLE + request.jwt.claims dentro de
// BEGIN...ROLLBACK. Lojas B/C e seus admins/pedidos/clientes sao ficticios, desfeitos pelo ROLLBACK.
// Exit 0 = SUCCESS.
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

const ADMIN_REAL_USER_ID  = 'b9dc7626-af9c-4ab5-95f7-3207e6469129'; // admin real de producao (encanto)
const ADMIN_B             = 'ce7ece01-266c-42b1-a9db-8051da24d7f5'; // admin de UMA loja so (loja B)
const MULTI_STORE_ADMIN   = 'cbd7db65-f2dc-4f13-977b-e76671c41eb6'; // admin vinculado a lojas B e C
const STRANGER            = '4fa5541f-989f-4b8d-89b4-7b45a59d8f4e'; // autenticado, zero vinculo admin

const STORE_B_ID    = '11111111-5555-4000-8000-000000000001';
const STORE_C_ID    = '11111111-5555-4000-8000-000000000002';
const CUSTOMER_B_ID = '11111111-6666-4000-8000-000000000001';
const CUSTOMER_C_ID = '11111111-6666-4000-8000-000000000002';
const ORDER_B_ID    = '11111111-7777-4000-8000-000000000001';
const ORDER_C_ID    = '11111111-7777-4000-8000-000000000002';

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
async function callRpc(id, desc, sql, params, checkFn) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  let result = null, rows = null, errMsg = null;
  try { const r = await client.query(sql, params); result = r.rows[0]; rows = r.rows; await client.query(`RELEASE SAVEPOINT ${sp}`); }
  catch (e) { errMsg = redact(e.message).split('\n')[0]; await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); }
  const { ok, detail } = checkFn(result, errMsg, rows);
  record(id, desc, ok ? 'PASS' : 'FAIL', detail);
  return { result, rows, errMsg };
}

function setupSql(encantoId) {
  return [
    `INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_B_ID}', 'loja-b-teste-onda5', 'Loja B (fake, teste Onda 5)', NULL, 'ativo')`,
    `INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_C_ID}', 'loja-c-teste-onda5', 'Loja C (fake, teste Onda 5)', NULL, 'ativo')`,
    `INSERT INTO public.admins (user_id, store_id) VALUES ('${ADMIN_B}', '${STORE_B_ID}')`,
    `INSERT INTO public.admins (user_id, store_id) VALUES ('${MULTI_STORE_ADMIN}', '${STORE_B_ID}')`,
    `INSERT INTO public.admins (user_id, store_id) VALUES ('${MULTI_STORE_ADMIN}', '${STORE_C_ID}')`,
    `INSERT INTO public.customers (id, name, phone, store_id) VALUES ('${CUSTOMER_B_ID}', 'Cliente Loja B (fake onda5)', '47944440001', '${STORE_B_ID}')`,
    `INSERT INTO public.customers (id, name, phone, store_id) VALUES ('${CUSTOMER_C_ID}', 'Cliente Loja C (fake onda5)', '47944440002', '${STORE_C_ID}')`,
    `INSERT INTO public.orders (id, customer_id, total, payment_method, address, store_id) VALUES ('${ORDER_B_ID}', '${CUSTOMER_B_ID}', 40.00, 'pix', 'Rua B, 1', '${STORE_B_ID}')`,
    `INSERT INTO public.orders (id, customer_id, total, payment_method, address, store_id) VALUES ('${ORDER_C_ID}', '${CUSTOMER_C_ID}', 50.00, 'pix', 'Rua C, 1', '${STORE_C_ID}')`,
  ];
}
const SUPER_ADMIN_SETUP = `INSERT INTO public.super_admins (user_id) VALUES ('${ADMIN_REAL_USER_ID}')`;

try {
  out('===================================================================');
  out(' SUITE — REF-SAAS-01 · Onda 5 (admin multi-loja, backend) — RELATORIO');
  out('===================================================================');
  out('Camada A: somente leitura. Camada B: simulacao de sessao dentro de BEGIN...ROLLBACK (mutacao liquida = 0).');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessao ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  const encantoId = (await client.query(`SELECT id FROM public.stores WHERE slug = 'encanto'`)).rows[0].id;
  const realOrdersTotal = (await client.query(`SELECT count(*)::int AS n FROM public.orders`)).rows[0].n;
  out('— Loja encanto: ' + encantoId + ' · pedidos reais em producao: ' + realOrdersTotal + ' —');
  out('');

  // ---------------- Camada A: estrutural ----------------
  out('— A1: list_my_stores/admin_orders_search/admin_orders_stats/admin_order_endereco com assinaturas corretas —');
  {
    const r = await client.query(`
      SELECT proname, pg_get_function_identity_arguments(oid) AS args FROM pg_proc
      WHERE proname IN ('list_my_stores','admin_orders_search','admin_orders_stats','admin_order_endereco')
        AND pronamespace='public'::regnamespace ORDER BY proname`);
    const byName = Object.fromEntries(r.rows.map(x => [x.proname, x.args]));
    const counts = {}; for (const row of r.rows) counts[row.proname] = (counts[row.proname] || 0) + 1;
    const ok = Object.values(counts).every(n => n === 1) && Object.keys(counts).length === 4
      && byName.list_my_stores === ''
      && byName.admin_orders_search.includes('p_store_id')
      && byName.admin_orders_stats.includes('p_store_id')
      && byName.admin_order_endereco.includes('p_store_id');
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A1 assinaturas corretas, 1 overload cada`); out(`         -> ${JSON.stringify(byName)}`);
  }
  out('');

  // ---------------- Camada B: list_my_stores() ----------------
  out('— list_my_stores(): cada persona ve exatamente as lojas certas —');
  await tx('authenticated', ADMIN_REAL_USER_ID, setupSql(encantoId), async () => {
    await callRpc('B1', 'admin real (encanto) ve SO a propria loja', `SELECT * FROM public.list_my_stores()`, [],
      (r, err, rows) => ({ ok: rows?.length === 1 && rows[0].slug === 'encanto' && rows[0].is_super_admin === false, detail: JSON.stringify(rows) }));
  });
  await tx('authenticated', ADMIN_B, setupSql(encantoId), async () => {
    await callRpc('B2', 'admin de UMA loja (B) ve SO ela', `SELECT * FROM public.list_my_stores()`, [],
      (r, err, rows) => ({ ok: rows?.length === 1 && rows[0].store_id === STORE_B_ID, detail: JSON.stringify(rows) }));
  });
  await tx('authenticated', MULTI_STORE_ADMIN, setupSql(encantoId), async () => {
    await callRpc('B3', 'admin vinculado a MULTIPLAS lojas (B e C) ve as duas, nao encanto', `SELECT * FROM public.list_my_stores()`, [],
      (r, err, rows) => {
        const ids = (rows || []).map(x => x.store_id).sort();
        const ok = ids.length === 2 && ids.includes(STORE_B_ID) && ids.includes(STORE_C_ID) && !ids.includes(encantoId);
        return { ok, detail: JSON.stringify(rows) };
      });
  });
  await tx('authenticated', ADMIN_REAL_USER_ID, [...setupSql(encantoId), SUPER_ADMIN_SETUP], async () => {
    await callRpc('B4', 'super admin ve TODAS as lojas do sistema (inclusive sem linha em admins nelas)', `SELECT * FROM public.list_my_stores()`, [],
      (r, err, rows) => {
        const ids = (rows || []).map(x => x.store_id);
        const ok = ids.includes(encantoId) && ids.includes(STORE_B_ID) && ids.includes(STORE_C_ID) && rows.every(x => x.is_super_admin === true);
        return { ok, detail: JSON.stringify(rows) };
      });
  });
  await tx('authenticated', STRANGER, setupSql(encantoId), async () => {
    await callRpc('B5', 'usuario sem NENHUM vinculo administrativo ve zero lojas', `SELECT * FROM public.list_my_stores()`, [],
      (r, err, rows) => ({ ok: rows?.length === 0, detail: JSON.stringify(rows) }));
  });
  await tx('anon', null, setupSql(encantoId), async () => {
    await callRpc('B6', 'anon ve zero lojas', `SELECT * FROM public.list_my_stores()`, [],
      (r, err, rows) => ({ ok: (rows?.length ?? 0) === 0 || errMsgIsPermission(err), detail: err || JSON.stringify(rows) }));
  });
  out('');

  function errMsgIsPermission(err) { return !!err && /permission denied/i.test(err); }

  // ---------------- Camada B: isolamento funcional de admin_orders_search/stats/endereco ----------------
  out('— ISOLAMENTO FUNCIONAL: admin_orders_search/stats/endereco filtram pelo p_store_id explicito —');
  await tx('authenticated', ADMIN_B, setupSql(encantoId), async () => {
    await callRpc('C1', 'admin B, p_store_id=lojaB: ve o pedido da propria loja', `SELECT * FROM public.admin_orders_search(NULL,NULL,10,NULL,NULL,$1)`, [STORE_B_ID],
      (r, err, rows) => ({ ok: rows?.length === 1 && rows[0].id === ORDER_B_ID, detail: JSON.stringify(rows?.map(x => x.id)) }));
    await callRpc('C2-SEGURANCA', 'admin B INFORMA p_store_id=encanto (loja que NAO administra) -> negado por is_admin_of explicito (UI nao e seguranca)', `SELECT * FROM public.admin_orders_search(NULL,NULL,10,NULL,NULL,$1)`, [encantoId],
      (r, err, rows) => ({ ok: err !== null && err.includes('apenas administradores'), detail: err || `rows=${rows?.length} (esperava erro de permissao)` }));
    await callRpc('C3-SEGURANCA', 'admin B INFORMA p_store_id=encanto em admin_orders_stats -> negado por is_admin_of explicito', `SELECT public.admin_orders_stats($1) AS s`, [encantoId],
      (r, err) => ({ ok: err !== null && err.includes('apenas administradores'), detail: err || JSON.stringify(r?.s) }));
    await callRpc('C4-SEGURANCA', 'admin_order_endereco de um pedido de OUTRA loja -> negado por is_admin_of explicito', `SELECT public.admin_order_endereco($1, $2) AS e`, [ORDER_B_ID, encantoId],
      (r, err) => ({ ok: err !== null && err.includes('apenas administradores'), detail: err || JSON.stringify(r?.e) }));
  });
  out('');

  out('— Admin vinculado a multiplas lojas opera as duas SEM misturar dados —');
  await tx('authenticated', MULTI_STORE_ADMIN, setupSql(encantoId), async () => {
    await callRpc('C5a', 'p_store_id=lojaB: ve so o pedido da loja B', `SELECT * FROM public.admin_orders_search(NULL,NULL,10,NULL,NULL,$1)`, [STORE_B_ID],
      (r, err, rows) => ({ ok: rows?.length === 1 && rows[0].id === ORDER_B_ID, detail: JSON.stringify(rows?.map(x => x.id)) }));
    await callRpc('C5b', 'p_store_id=lojaC: ve so o pedido da loja C', `SELECT * FROM public.admin_orders_search(NULL,NULL,10,NULL,NULL,$1)`, [STORE_C_ID],
      (r, err, rows) => ({ ok: rows?.length === 1 && rows[0].id === ORDER_C_ID, detail: JSON.stringify(rows?.map(x => x.id)) }));
    await callRpc('C5c', 'p_store_id=encanto (nao administra): negado por is_admin_of explicito', `SELECT * FROM public.admin_orders_search(NULL,NULL,10,NULL,NULL,$1)`, [encantoId],
      (r, err, rows) => ({ ok: err !== null && err.includes('apenas administradores'), detail: err || `rows=${rows?.length}` }));
  });
  out('');

  out('— Super admin ficticio opera qualquer loja mesmo sem linha em admins —');
  await tx('authenticated', ADMIN_REAL_USER_ID, [...setupSql(encantoId), SUPER_ADMIN_SETUP], async () => {
    await callRpc('C6', 'super admin ve o pedido da loja B mesmo sem linha em admins la', `SELECT * FROM public.admin_orders_search(NULL,NULL,10,NULL,NULL,$1)`, [STORE_B_ID],
      (r, err, rows) => ({ ok: rows?.length === 1 && rows[0].id === ORDER_B_ID, detail: JSON.stringify(rows?.map(x => x.id)) }));
  });
  out('');

  out('— REGRESSAO: admin real (encanto), com e sem p_store_id explicito, ve os pedidos reais de producao —');
  await tx('authenticated', ADMIN_REAL_USER_ID, setupSql(encantoId), async () => {
    await callRpc('C7-explicito', 'p_store_id=encanto explicito: total_geral bate com a contagem real', `SELECT public.admin_orders_stats($1) AS s`, [encantoId],
      (r) => ({ ok: r?.s?.total_geral === realOrdersTotal, detail: `total_geral=${r?.s?.total_geral} esperado=${realOrdersTotal}` }));
    await callRpc('C8-compatibilidade', 'SEM p_store_id (como o Admin real chama HOJE, antes do frontend desta onda): DEFAULT resolve pra encanto igual', `SELECT public.admin_orders_stats() AS s`, [],
      (r) => ({ ok: r?.s?.total_geral === realOrdersTotal, detail: `total_geral=${r?.s?.total_geral} esperado=${realOrdersTotal}` }));
  });
  out('');

  out('— REGRESSAO FINAL: zero mutacao liquida em producao apos toda a suite —');
  {
    const r = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.stores WHERE id IN ('${STORE_B_ID}','${STORE_C_ID}')) AS lojas_fake,
        (SELECT count(*)::int FROM public.admins WHERE user_id IN ('${ADMIN_B}','${MULTI_STORE_ADMIN}')) AS admins_fake,
        (SELECT count(*)::int FROM public.super_admins WHERE user_id = '${ADMIN_REAL_USER_ID}') AS super_admin,
        (SELECT count(*)::int FROM public.orders WHERE id IN ('${ORDER_B_ID}','${ORDER_C_ID}')) AS pedidos_fake,
        (SELECT count(*)::int FROM public.customers WHERE id IN ('${CUSTOMER_B_ID}','${CUSTOMER_C_ID}')) AS clientes_fake`);
    const row = r.rows[0];
    const ok = Object.values(row).every(n => n === 0);
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] zero mutacao liquida`); out(`         -> ${JSON.stringify(row)}`);
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
  console.log('ETAPA — TESTES DA FASE (REF-SAAS-01 · Onda 5, backend)');
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
