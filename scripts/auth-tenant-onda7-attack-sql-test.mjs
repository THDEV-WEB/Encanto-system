// scripts/auth-tenant-onda7-attack-sql-test.mjs — REF-AUTH-TENANT-01 · Onda 7 (gate final de ataque).
// Cobre os angulos AINDA NAO testados pelas ondas anteriores: claims JWT forjadas com campos extras
// (is_admin/role/customer_id que nada le), Admin cross-tenant sobre customers/addresses pos-hardening
// (Onda5/6), enumeracao via admin_link_customer_to_auth, ativacao de loja inativa (cadeia completa via
// activate_tenant). Ataques ja cobertos exaustivamente pelas ondas anteriores (cross-tenant SELECT/
// UPDATE/DELETE/INSERT em addresses, p_store_id manipulado em link_customer_to_auth, anti-takeover de
// telefone, sessao sem tenant) sao RECONFIRMADOS rodando os scripts originais (ver relatorio final),
// nao duplicados aqui. Roda SOMENTE contra o projeto E2E. BEGIN...ROLLBACK. Exit 0 = SUCCESS.
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
  let txt; try { txt = readFileSync(ENV_PATH, 'utf8'); } catch { console.error('ERRO: db.e2e.env nao encontrado'); process.exit(2); }
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

const USER_DUAL     = '5662cd2f-725d-429c-9701-960553ebbcbd';
const ADMIN_ENCANTO = '1265c4c1-32b8-4125-9831-25cf57541dc5'; // ja e admin de Encanto (fixture real)
const ADMIN_BAR     = 'bc45ac7f-948a-4571-8df9-ce544757bcad'; // vira admin da Bar SO dentro desta tx
const CUST_ENCANTO   = '969433f9-3bbd-408a-9628-4582c255aa20';
const STORE_ENCANTO  = 'be2efc10-c0c8-410f-bcd4-af3f8a371df3';
const CUST_BAR       = '99999999-9999-4999-8999-999999999997';
const STORE_BAR      = '99999999-9999-4999-8999-999999999998';
const STORE_INATIVA  = '99999999-9999-4999-8999-999999999996';
const ADDR_ENCANTO   = '66666666-6666-4666-8666-666666666601';
const ADDR_BAR       = '66666666-6666-4666-8666-666666666602';

const R = []; const out = (s = '') => R.push(s);
let passes = 0, failures = 0, spCounter = 0;
const startedMs = Date.now(), startedIso = isoUtc();
function record(id, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} ${desc}`); out(`         -> ${detail}`);
}
let currentRole = 'postgres';
async function comoRole(role, sub, extraClaims) {
  const claims = sub ? { sub, role, ...(extraClaims || {}) } : { role };
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
  await client.query(`SET LOCAL ROLE ${role}`);
  currentRole = role;
}
async function superScalar(sql, params) {
  await client.query('RESET ROLE');
  const r = await client.query(sql, params);
  await client.query(`SET LOCAL ROLE ${currentRole}`);
  return r.rows[0];
}
async function tentar(id, desc, sql, params, checkFn) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  let result = null, errMsg = null;
  try { const r = await client.query(sql, params); result = r; await client.query(`RELEASE SAVEPOINT ${sp}`); }
  catch (e) { errMsg = redact(e.message).split('\n')[0]; await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); }
  const { ok, detail } = await checkFn(result, errMsg);
  record(id, desc, ok ? 'PASS' : 'FAIL', detail);
  return { result, errMsg };
}
async function callRpc(id, desc, sql, params, checkFn) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  let row = null, errMsg = null;
  try { const r = await client.query(sql, params); row = r.rows[0]; await client.query(`RELEASE SAVEPOINT ${sp}`); }
  catch (e) { errMsg = redact(e.message).split('\n')[0]; await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); }
  const { ok, detail } = await checkFn(row, errMsg);
  record(id, desc, ok ? 'PASS' : 'FAIL', detail);
  return { row, errMsg };
}

try {
  out('==================================================================');
  out(' SUITE — REF-AUTH-TENANT-01 · Onda 7 (ataque adversarial, itens novos) — E2E');
  out('==================================================================');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' (E2E) · sessao ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  await client.query('BEGIN');
  await client.query(`INSERT INTO public.addresses (id, customer_id, store_id, rua, numero) VALUES ($1,$2,$3,'Rua Onda7 Encanto','1')`, [ADDR_ENCANTO, CUST_ENCANTO, STORE_ENCANTO]);
  await client.query(`INSERT INTO public.addresses (id, customer_id, store_id, rua, numero) VALUES ($1,$2,$3,'Rua Onda7 Bar','2')`, [ADDR_BAR, CUST_BAR, STORE_BAR]);
  // ADMIN_BAR vira admin da Bar SO dentro desta transacao (nunca persiste) -- prova isolamento sem
  // criar fixture permanente nova.
  await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1,$2)`, [ADMIN_BAR, STORE_BAR]);

  out('— ATAQUE 5: JWT com claims EXTRAS forjadas (is_admin/role/customer_id que nenhum codigo le) —');
  await comoRole('authenticated', USER_DUAL, {
    tenant_id: STORE_ENCANTO, is_admin: true, admin: true, role_override: 'service_role',
    customer_id: CUST_BAR, store_id: STORE_BAR,
  });
  await tentar('AT5a', 'claim extra "is_admin:true" nao concede acesso a is_admin_of (so a tabela admins conta)', `SELECT public.is_admin_of($1) AS ok`, [STORE_BAR],
    (r, err) => ({ ok: err === null && r.rows[0].ok === false, detail: err || JSON.stringify(r.rows[0]) }));
  await tentar('AT5b', 'claim extra "customer_id"/"store_id" forjados no JWT nao mudam o resultado de SELECT addresses (RLS so olha tenant_id+auth.uid() reais)', `SELECT id FROM public.addresses WHERE id=$1`, [ADDR_BAR],
    (r, err) => ({ ok: err === null && r.rows.length === 0, detail: err || `rows=${r?.rows?.length}` }));
  await tentar('AT5c', 'apesar do claim "tenant_id" tambem estar presente e correto (Encanto), o endereco da Encanto continua visivel (claims extras nao quebram o funcionamento legitimo)', `SELECT id FROM public.addresses WHERE id=$1`, [ADDR_ENCANTO],
    (r, err) => ({ ok: err === null && r.rows.length === 1, detail: err || `rows=${r?.rows?.length}` }));
  out('');

  out('— ATAQUE 11: ADMIN cross-tenant (customers + addresses), Admin Encanto vs Admin Bar vs Super Admin —');
  await comoRole('authenticated', ADMIN_ENCANTO, {});
  await tentar('AT11a', 'Admin Encanto LE customer de Encanto (regressao)', `SELECT id FROM public.customers WHERE id=$1`, [CUST_ENCANTO],
    (r, err) => ({ ok: err === null && r.rows.length === 1, detail: err || `rows=${r?.rows?.length}` }));
  await tentar('AT11b', 'Admin Encanto NAO le customer da Bar (isolamento)', `SELECT id FROM public.customers WHERE id=$1`, [CUST_BAR],
    (r, err) => ({ ok: err === null && r.rows.length === 0, detail: err || `rows=${r?.rows?.length}` }));
  await tentar('AT11c', 'Admin Encanto NAO atualiza endereco da Bar (is_admin_of nega)', `UPDATE public.addresses SET numero='HACK-ADMIN' WHERE id=$1`, [ADDR_BAR],
    (r, err) => ({ ok: err === null && r.rowCount === 0, detail: err || `rowCount=${r?.rowCount}` }));
  await callRpc('AT11d', 'admin_link_customer_to_auth: Admin Encanto tentando mexer em customer da Bar -> nega (sem permissao)', `SELECT public.admin_link_customer_to_auth($1,$2) AS r`, [CUST_BAR, ADMIN_ENCANTO],
    (row) => { const r = row?.r; return { ok: r?.ok === false && r?.error === 'sem permissao', detail: JSON.stringify(r) }; });

  await comoRole('authenticated', ADMIN_BAR, {});
  await tentar('AT11e', 'Admin Bar LE customer da Bar (regressao, admin novo desta loja)', `SELECT id FROM public.customers WHERE id=$1`, [CUST_BAR],
    (r, err) => ({ ok: err === null && r.rows.length === 1, detail: err || `rows=${r?.rows?.length}` }));
  await tentar('AT11f', 'Admin Bar NAO le customer de Encanto (isolamento simetrico)', `SELECT id FROM public.customers WHERE id=$1`, [CUST_ENCANTO],
    (r, err) => ({ ok: err === null && r.rows.length === 0, detail: err || `rows=${r?.rows?.length}` }));
  out('');

  out('— ATAQUE 13: enumeracao — admin_link_customer_to_auth distingue "nao encontrado" de "sem permissao" (achado, nao corrigido nesta onda) —');
  await comoRole('authenticated', USER_DUAL, {}); // USER_DUAL nao e admin de loja nenhuma
  await callRpc('AT13a', 'customer_id INEXISTENTE -> "cliente nao encontrado"', `SELECT public.admin_link_customer_to_auth($1,$2) AS r`, ['00000000-0000-4000-a000-000000000099', USER_DUAL],
    (row) => { const r = row?.r; return { ok: r?.ok === false && r?.error === 'cliente nao encontrado', detail: JSON.stringify(r) }; });
  await callRpc('AT13b', 'customer_id EXISTENTE (da Bar) -> "sem permissao" -- MENSAGEM DIFERENTE do caso acima = oraculo de enumeracao (achado, registrado no relatorio)', `SELECT public.admin_link_customer_to_auth($1,$2) AS r`, [CUST_BAR, USER_DUAL],
    (row) => { const r = row?.r; return { ok: r?.ok === false && r?.error === 'sem permissao', detail: JSON.stringify(r) }; });
  out('');

  await client.query('ROLLBACK');
  out('— Transacao de teste desfeita (ROLLBACK) — nenhum dado de teste persistiu, admins.ADMIN_BAR nunca foi gravado de verdade —');
  out('');

  out('— ATAQUE 10 (loja inativa): activate_tenant() exige um auth.sessions REAL (nao da pra simular so');
  out('  por claims em BEGIN/ROLLBACK sem sessao de verdade) — reconfirmado via login real no script');
  out('  de ataque via API (auth-tenant-onda7-attack-real-test.mjs) + reconfirmacao da suite original');
  out('  da Onda 2 (24/24, ja cobre loja inativa/inexistente/sem vinculo com sessao real). Ver relatorio.');
  out('');

  out('— ATAQUE 12 (resumo): grants EXECUTE de todas as RPCs desta REF, confirmado ao vivo —');
  {
    const r = await client.query(`
      SELECT routine_name, string_agg(grantee, ',' ORDER BY grantee) AS grantees
      FROM information_schema.routine_privileges
      WHERE routine_schema='public' AND routine_name IN (
        'activate_tenant','custom_access_token_hook','link_customer_to_auth','admin_link_customer_to_auth',
        'save_structured_address','admin_order_endereco','is_admin_of','is_super_admin'
      ) GROUP BY routine_name ORDER BY routine_name`);
    for (const row of r.rows) out(`    ${row.routine_name}: ${row.grantees}`);
    const linkOk = r.rows.find(x => x.routine_name === 'link_customer_to_auth')?.grantees === 'authenticated,postgres,service_role';
    const activateOk = r.rows.find(x => x.routine_name === 'activate_tenant')?.grantees === 'authenticated,postgres,service_role';
    record('AT12', 'link_customer_to_auth/activate_tenant restritos a authenticated (Ondas 2/6) — admin_link_customer_to_auth/admin_order_endereco com anon no E2E = ACHADO registrado no relatorio (nao corrigido, fora do escopo desta onda, producao ja esta correta)', (linkOk && activateOk) ? 'PASS' : 'FAIL', JSON.stringify(r.rows));
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
  console.log('ETAPA — TESTES DA FASE (REF-AUTH-TENANT-01 · Onda 7 · ataque · E2E)');
  console.log('STATE: ' + state + ' · PASS=' + passes + ' FAIL=' + failures);
  console.log('====================================');
  if (failures) process.exitCode = 1;
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.log(R.join('\n'));
  console.error('SUITE ERROR: ' + redact(e && e.message ? e.message : e));
  console.log('STATE:\nFAILED');
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
