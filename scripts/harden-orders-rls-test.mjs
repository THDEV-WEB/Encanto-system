// Suite de RLS de PEDIDOS (HARDEN-ORDERS-RLS) — Etapa "Testes da fase".
// Via SET LOCAL ROLE anon/authenticated em BEGIN..ROLLBACK (net-zero). Prova:
//  - anon NÃO acessa orders/customers/order_items/order_events/v_order_reconciliation direto (42501, grants revogados);
//    cobre SELECT/INSERT/UPDATE/DELETE (a checagem de privilégio precede a RLS -> 42501 mesmo em UPDATE/DELETE);
//  - camada D-GRANTS provada por metadados (has_table_privilege('anon',...) = false), independente do 42501 em runtime;
//  - anon AINDA cria pedido via RPC create_order (SECURITY DEFINER) — checkout intacto + idempotência;
//  - authenticated (admin) lê (getPedidos-equiv, hermético) e altera status (setStatus) e roda orders_health / lê a view;
//  - auditoria SECURITY DEFINER de create_order: secdef/owner/search_path=pg_catalog,public/sem-EXECUTE-dinâmico/ACL(anon sim, PUBLIC não).
// Emite RELATÓRIO REPRODUZÍVEL + AUTOAUDITÁVEL. Exit 0 = SUCCESS; exit 1 = FAILED.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire('C:\\Users\\00thi\\.encanto\\package.json');
const pg = require('pg');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = 'C:\\Users\\00thi\\.encanto\\db.env';
const SCRIPT_NAME = 'test:orders-rls';

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

const R = []; const out = (s = '') => R.push(s);
let passes = 0, failures = 0;
const startedMs = Date.now(), startedIso = isoUtc();

const REQ = "'1f1f1f1f-2e2e-3d3d-4c4c-5b5b5b5b5b5b'::uuid";
const P_CUST = `'{"name":"__ord_rls_test","phone":"38900000001"}'::jsonb`;   // REQ-01: telefone válido ≥10 díg. (DDD+número)
const P_ORDER = `'{"total":"10.00","status":"recebido","payment_method":"dinheiro","address":"rua teste 1"}'::jsonb`;
const P_ITEMS = `'[{"nome_produto":"__ord_rls_item","quantity":"1","price":"10.00"}]'::jsonb`;

async function counts() {
  const q = await client.query(`SELECT
    (SELECT count(*) FROM public.orders) AS orders,
    (SELECT count(*) FROM public.customers) AS customers,
    (SELECT count(*) FROM public.order_items) AS order_items`);
  return q.rows[0];
}
// AUTH-01: apos o endurecimento, a gestao de pedidos e privilegio de ADMIN. Os testes 'authenticated'
// (admin: getPedidos/setStatus/health) rodam com o JWT do admin (is_admin()=true). anon segue sem JWT.
let ADMIN_UID = null;
async function tx(role, fn) {
  try {
    await client.query('BEGIN');
    if (role === 'authenticated' && ADMIN_UID) await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ADMIN_UID, role: 'authenticated' })]);
    await client.query(`SET LOCAL ROLE ${role}`);
    return await fn();
  } finally { await client.query('ROLLBACK').catch(() => {}); }
}
function record(id, role, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} <${role}> ${desc}`); out(`         -> ${detail}`);
}
// anon DEVE ser barrado por privilégio (42501) ao tocar a tabela/view direto (grants revogados → ACL antes da RLS)
async function expectDeniedGrant(id, desc, sql) {
  let verdict = 'FAIL', detail = '';
  await tx('anon', async () => {
    try { await client.query(sql); detail = 'NAO foi negado (esperava 42501)'; verdict = 'FAIL'; }
    catch (e) { if (e.code === '42501') { verdict = 'PASS'; detail = 'permission denied (42501): ' + redact(e.message).split('\n')[0]; }
      else { verdict = 'FAIL'; detail = `negado por outro motivo (esperava 42501): code=${e.code} ${redact(e.message).split('\n')[0]}`; } }
  });
  record(id, 'anon', desc, verdict, detail);
}

try {
  out('==================================================================');
  out(' SUITE DE RLS DE PEDIDOS — HARDEN-ORDERS-RLS — RELATORIO');
  out('==================================================================');
  out('SET LOCAL ROLE anon/authenticated em BEGIN..ROLLBACK. Nenhuma escrita persiste.');
  out('');
  await client.connect();
  ADMIN_UID = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 1')).rows[0]?.id; // AUTH-01: admin p/ os testes authenticated
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessão ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');
  const before = await counts();

  out('— ANON · acesso DIRETO a tabela/view DEVE ser negado (grants revogados → 42501) —');
  await expectDeniedGrant('AO1', 'SELECT orders',                `SELECT * FROM public.orders LIMIT 1`);
  await expectDeniedGrant('AO2', 'SELECT customers',             `SELECT * FROM public.customers LIMIT 1`);
  await expectDeniedGrant('AO3', 'SELECT order_items',           `SELECT * FROM public.order_items LIMIT 1`);
  await expectDeniedGrant('AO4', 'SELECT v_order_reconciliation', `SELECT * FROM public.v_order_reconciliation LIMIT 1`);
  await expectDeniedGrant('AO5', 'SELECT order_events',          `SELECT * FROM public.order_events LIMIT 1`);
  await expectDeniedGrant('AO6', 'INSERT orders direto',         `INSERT INTO public.orders(total) VALUES (1)`);
  await expectDeniedGrant('AO7', 'UPDATE orders direto',         `UPDATE public.orders SET status=status WHERE id IS NOT NULL`);
  await expectDeniedGrant('AO8', 'DELETE order_items direto',    `DELETE FROM public.order_items WHERE false`);
  out('');

  // Camada D-GRANTS provada por metadados (independente do 42501 em runtime)
  out('— D-GRANTS (defesa em profundidade): anon SEM privilégio de tabela (has_table_privilege=false) —');
  {
    const r = (await client.query(`SELECT
      has_table_privilege('anon','public.orders','SELECT') AS orders,
      has_table_privilege('anon','public.customers','SELECT') AS customers,
      has_table_privilege('anon','public.order_items','SELECT') AS order_items,
      has_table_privilege('anon','public.order_events','SELECT') AS order_events,
      has_table_privilege('anon','public.addresses','SELECT') AS addresses,
      has_table_privilege('anon','public.v_order_reconciliation','SELECT') AS v_recon`)).rows[0];
    const anyTrue = Object.entries(r).filter(([, v]) => v === true);
    const ok = anyTrue.length === 0;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] GR1 anon não tem SELECT em nenhuma tabela/view de pedido`);
    out(`         -> ${ok ? 'todas false' : 'AINDA tem: ' + anyTrue.map(([k]) => k).join(',')}`);
  }
  out('');

  out('— ANON · checkout via RPC create_order (SECURITY DEFINER) DEVE funcionar —');
  {
    let v = 'FAIL', d = '';
    await tx('anon', async () => {
      const res = (await client.query(`SELECT public.create_order(${P_CUST}, ${P_ORDER}, ${P_ITEMS}, ${REQ}) AS res`)).rows[0]?.res;
      if (res && res.ok === true && res.order_id) { v = 'PASS'; d = 'ok=true order_id=' + res.order_id; } else { v = 'FAIL'; d = 'retorno inesperado: ' + JSON.stringify(res); }
    });
    record('AC1', 'anon', 'create_order cria pedido', v, d);
  }
  {
    let v = 'FAIL', d = '';
    await tx('anon', async () => {
      const r1 = (await client.query(`SELECT public.create_order(${P_CUST}, ${P_ORDER}, ${P_ITEMS}, ${REQ}) AS res`)).rows[0].res;
      const r2 = (await client.query(`SELECT public.create_order(${P_CUST}, ${P_ORDER}, ${P_ITEMS}, ${REQ}) AS res`)).rows[0].res;
      if (r1?.ok && r2?.ok && r2.idempotent === true && r2.order_id === r1.order_id) { v = 'PASS'; d = '2a chamada idempotent=true, mesmo order_id'; }
      else { v = 'FAIL'; d = '1=' + JSON.stringify(r1) + ' 2=' + JSON.stringify(r2); }
    });
    record('AC2', 'anon', 'create_order idempotência (mesmo request_id)', v, d);
  }
  out('');

  out('— AUTHENTICATED (admin) · lê e gerencia pedidos (herméticos: semeiam dado na própria tx) —');
  // BO1: admin lê pedido (semeado) com PII — getPedidos-equiv
  {
    let v = 'FAIL', d = '';
    await tx('authenticated', async () => {
      const cid = (await client.query(`INSERT INTO public.customers(name,phone) VALUES('__ord_admin_seed','38900000002') RETURNING id`)).rows[0].id;   // REQ-01: telefone válido
      const oid = (await client.query(`INSERT INTO public.orders(customer_id,total,status,payment_method,address) VALUES('${cid}',10,'recebido','dinheiro','rua seed') RETURNING id`)).rows[0].id;
      await client.query(`INSERT INTO public.order_items(order_id,nome_produto,quantity,price) VALUES('${oid}','__seed_item',1,10)`);
      const r = await client.query(`SELECT o.id,o.total,c.name,c.phone FROM public.orders o LEFT JOIN public.customers c ON c.id=o.customer_id LEFT JOIN public.order_items oi ON oi.order_id=o.id WHERE o.id='${oid}'`);
      v = r.rowCount >= 1 ? 'PASS' : 'FAIL'; d = `lê o pedido semeado com PII do cliente (${r.rowCount} linha)`;
    });
    record('BO1', 'authenticated', 'SELECT orders + JOIN customers/order_items (getPedidos)', v, d);
  }
  // BO2: admin altera status (setStatus) — semeado
  {
    let v = 'FAIL', d = '';
    await tx('authenticated', async () => {
      const oid = (await client.query(`INSERT INTO public.orders(total,status) VALUES(10,'recebido') RETURNING id`)).rows[0].id;
      const r = await client.query(`UPDATE public.orders SET status='preparo' WHERE id='${oid}'`);
      v = r.rowCount === 1 ? 'PASS' : 'FAIL'; d = `setStatus: UPDATE ${r.rowCount} linha`;
    });
    record('BO2', 'authenticated', 'UPDATE orders SET status (setStatus)', v, d);
  }
  // BO3: orders_health
  {
    let v = 'FAIL', d = '';
    await tx('authenticated', async () => {
      const r = await client.query(`SELECT public.orders_health() AS h`);
      v = (r.rows[0]?.h != null) ? 'PASS' : 'FAIL'; d = (r.rows[0]?.h != null) ? 'orders_health retornou' : 'null';
    });
    record('BO3', 'authenticated', 'rpc orders_health', v, d);
  }
  // BO4: lê a view (security_invoker) sem erro
  {
    let v = 'FAIL', d = '';
    await tx('authenticated', async () => {
      const r = await client.query(`SELECT * FROM public.v_order_reconciliation LIMIT 5`);
      v = 'PASS'; d = `lida sem erro via RLS do authenticated (${r.rowCount} linha(s))`;
    });
    record('BO4', 'authenticated', 'SELECT v_order_reconciliation (security_invoker)', v, d);
  }
  out('');

  // Auditoria SECURITY DEFINER de create_order (asserções por máquina)
  out('— Auditoria SECURITY DEFINER (create_order) —');
  const aud = (await client.query(`SELECT p.prosecdef AS secdef, pg_get_userbyid(p.proowner) AS owner, p.proconfig AS cfg,
      (p.prosrc ~* '\\mexecute\\M') AS sql_dinamico, COALESCE(p.proacl::text,'(default)') AS acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='create_order'`)).rows[0];
  const spOk = Array.isArray(aud.cfg) && aud.cfg.some(c => /^search_path=/.test(c) && /pg_catalog/.test(c));
  const hasAnon = /[,{]anon=X/.test(aud.acl);
  const noPublic = !/[,{]=X\//.test(aud.acl);  // entrada PUBLIC seria '=X/...' logo após { ou ,
  const auditOk = aud.secdef === true && aud.owner === 'postgres' && spOk && aud.sql_dinamico === false && hasAnon && noPublic;
  if (auditOk) passes++; else failures++;
  out(`  [${auditOk ? 'PASS' : 'FAIL'}] AUD create_order`);
  out(`         -> secdef=${aud.secdef} owner=${aud.owner} search_path=${JSON.stringify(aud.cfg)} sql_dinamico=${aud.sql_dinamico}`);
  out(`         -> EXECUTE: anon=${hasAnon} PUBLIC_removido=${noPublic} · acl=${aud.acl}`);
  out('');

  const after = await counts();
  out('— Mutação líquida (antes == depois) —');
  let drift = 0;
  for (const k of Object.keys(before)) { const eq = String(before[k]) === String(after[k]); if (!eq) drift++; out(`  ${k.padEnd(14)} : ${before[k]} -> ${after[k]} ${eq ? 'OK' : '<<< DRIFT'}`); }
  if (drift) { failures++; out('  [FALHA] mutação líquida detectada.'); } else out('  Net DB change: 0.');
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
  console.log('ETAPA — TESTES DA FASE (HARDEN-ORDERS-RLS)');
  console.log('STATE: ' + state + ' · PASS=' + passes + ' FAIL=' + failures);
  console.log('NO PERSISTED WRITES');
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
