// Suite de validacao — REF-SEC-DATA-01-harden-critical (R1+R2+R7+R3).
// Via SET LOCAL ROLE authenticated em BEGIN..ROLLBACK (net-zero) + checagens de metadado
// (has_function_privilege/has_table_privilege), nunca executando de verdade as 4 funcoes cron-only
// como owner (evita qualquer risco de side-effect real, mesmo dentro de rollback). Prova:
//  - authenticated NAO chama purge_old_logs/reconcile_orders/reconcile_and_alert/check_alert_thresholds
//    (42501, EXECUTE revogado) — a checagem de privilegio precede a execucao do corpo da funcao;
//  - authenticated NAO consegue TRUNCATE em admins/super_admins/customers (42501, grants revogados);
//  - authenticated AINDA chama uma RPC legitima que sempre pode chamar (get_my_loyalty) — grants nao
//    regrediram alem do escopo pretendido;
//  - postgres (dono das 4 funcoes) mantem EXECUTE implicito nelas (prova por metadado, sem executar —
//    confirma que o cron nao quebra);
//  - tabela NOVA criada dentro da mesma transacao ja nasce sem TRUNCATE/REFERENCES/TRIGGER pra
//    anon/authenticated (prova que o ALTER DEFAULT PRIVILEGES pegou).
// Emite RELATORIO REPRODUZIVEL + AUTOAUDITAVEL. Exit 0 = SUCCESS; exit 1 = FAILED.
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
const SCRIPT_NAME = 'test:sec-data-01';

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

async function tx(role, fn) {
  try {
    await client.query('BEGIN');
    if (role === 'authenticated') await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: '00000000-0000-0000-0000-0000000000ff', role: 'authenticated' })]);
    await client.query(`SET LOCAL ROLE ${role}`);
    return await fn();
  } finally { await client.query('ROLLBACK').catch(() => {}); }
}
function record(id, role, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} <${role}> ${desc}`); out(`         -> ${detail}`);
}
// authenticated DEVE ser barrado por privilegio (42501) — checagem de EXECUTE/TRUNCATE precede
// qualquer efeito da funcao/comando, entao e seguro tentar de verdade dentro do rollback.
async function expectDenied(id, desc, sql) {
  let verdict = 'FAIL', detail = '';
  await tx('authenticated', async () => {
    try { await client.query(sql); detail = 'NAO foi negado (esperava 42501)'; verdict = 'FAIL'; }
    catch (e) { if (e.code === '42501') { verdict = 'PASS'; detail = 'permission denied (42501): ' + redact(e.message).split('\n')[0]; }
      else { verdict = 'FAIL'; detail = `negado por outro motivo (esperava 42501): code=${e.code} ${redact(e.message).split('\n')[0]}`; } }
  });
  record(id, 'authenticated', desc, verdict, detail);
}

const FUNCS = ['purge_old_logs(integer,integer)', 'reconcile_orders(uuid)', 'reconcile_and_alert()', 'check_alert_thresholds()'];
const CRON_TABLES = ['address_gazetteer', 'adicionais', 'admins', 'application_logs', 'categories', 'customers',
  'loyalty_accounts', 'loyalty_events', 'notification_outbox', 'order_events', 'order_items', 'orders',
  'product_collections', 'products', 'settings', 'store_settings', 'stores', 'super_admins'];

try {
  out('==================================================================');
  out(' SUITE DE VALIDACAO — REF-SEC-DATA-01-HARDEN-CRITICAL — RELATORIO');
  out('==================================================================');
  out('SET LOCAL ROLE authenticated em BEGIN..ROLLBACK + checagens de metadado. Nenhuma escrita persiste.');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessão ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  out('— R1+R2+R7 · AUTHENTICATED · chamada direta as 4 funcoes cron-only DEVE ser negada —');
  await expectDenied('F1', 'purge_old_logs(0,0)',        `SELECT public.purge_old_logs(0, 0)`);
  await expectDenied('F2', 'reconcile_orders(null)',     `SELECT public.reconcile_orders(NULL)`);
  await expectDenied('F3', 'reconcile_and_alert()',      `SELECT public.reconcile_and_alert()`);
  await expectDenied('F4', 'check_alert_thresholds()',   `SELECT public.check_alert_thresholds()`);
  out('');

  out('— R3 · AUTHENTICATED · TRUNCATE direto DEVE ser negado (amostra representativa) —');
  await expectDenied('T1', 'TRUNCATE admins',       `TRUNCATE public.admins`);
  await expectDenied('T2', 'TRUNCATE super_admins', `TRUNCATE public.super_admins`);
  await expectDenied('T3', 'TRUNCATE customers',    `TRUNCATE public.customers`);
  await expectDenied('T4', 'TRUNCATE orders',       `TRUNCATE public.orders`);
  out('');

  out('— D-GRANTS (defesa em profundidade): metadado confirma TRUNCATE ausente nas 18 tabelas —');
  {
    const r = await client.query(
      `SELECT unnest($1::text[]) AS tbl,
              has_table_privilege('anon', 'public.' || unnest($1::text[]), 'TRUNCATE') AS anon_tr,
              has_table_privilege('authenticated', 'public.' || unnest($1::text[]), 'TRUNCATE') AS auth_tr`,
      [CRON_TABLES]
    );
    const leaked = r.rows.filter(x => x.anon_tr || x.auth_tr);
    const ok = leaked.length === 0;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] GR1 nenhuma das 18 tabelas tem TRUNCATE pra anon/authenticated`);
    out(`         -> ${ok ? 'todas false (' + r.rowCount + ' tabelas checadas)' : 'AINDA vaza: ' + leaked.map(x => x.tbl).join(',')}`);
  }
  out('');

  out('— AUTHENTICATED · RPC legitima nao correlata (get_my_loyalty) continua funcionando —');
  {
    let v = 'FAIL', d = '';
    await tx('authenticated', async () => {
      const r = await client.query(`SELECT public.get_my_loyalty(NULL::uuid) AS res`);
      v = 'PASS'; d = 'chamada sem erro de permissao, retorno: ' + JSON.stringify(r.rows[0]?.res);
    });
    record('P1', 'authenticated', 'get_my_loyalty(null) nao regrediu', v, d);
  }
  out('');

  out('— Metadado: postgres (owner das 4 funcoes) mantem EXECUTE implicito — cron nao quebra —');
  {
    const r = await client.query(
      `SELECT unnest($1::text[]) AS fn,
              has_function_privilege('postgres', 'public.' || unnest($1::text[]), 'EXECUTE') AS can_exec`,
      [FUNCS]
    );
    const missing = r.rows.filter(x => !x.can_exec);
    const ok = missing.length === 0;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] OWN1 postgres tem EXECUTE nas 4 funcoes cron-only (owner implicito)`);
    out(`         -> ${ok ? 'todas true' : 'FALTANDO em: ' + missing.map(x => x.fn).join(',')}`);
  }
  out('');

  out('— R3 (causa raiz): tabela NOVA (dentro da tx, nunca persiste) nasce sem TRUNCATE/REFERENCES/TRIGGER —');
  {
    let v = 'FAIL', d = '';
    await client.query('BEGIN');
    try {
      await client.query('CREATE TABLE public._sec_data_01_probe (id int)');
      const r = await client.query(
        `SELECT has_table_privilege('anon','public._sec_data_01_probe','TRUNCATE') AS anon_tr,
                has_table_privilege('authenticated','public._sec_data_01_probe','TRUNCATE') AS auth_tr,
                has_table_privilege('authenticated','public._sec_data_01_probe','REFERENCES') AS auth_ref,
                has_table_privilege('authenticated','public._sec_data_01_probe','TRIGGER') AS auth_trg,
                has_table_privilege('authenticated','public._sec_data_01_probe','SELECT') AS auth_sel`
      );
      const row = r.rows[0];
      const ok = !row.anon_tr && !row.auth_tr && !row.auth_ref && !row.auth_trg && row.auth_sel === true;
      v = ok ? 'PASS' : 'FAIL';
      d = `TRUNCATE anon=${row.anon_tr} auth=${row.auth_tr} REFERENCES auth=${row.auth_ref} TRIGGER auth=${row.auth_trg} · SELECT auth=${row.auth_sel} (deve continuar true)`;
    } finally { await client.query('ROLLBACK').catch(() => {}); }
    record('D1', 'postgres(ddl)', 'ALTER DEFAULT PRIVILEGES aplicado a tabela nova', v, d);
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
  console.log('ETAPA — TESTES DA FASE (' + SCRIPT_NAME + ')');
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
