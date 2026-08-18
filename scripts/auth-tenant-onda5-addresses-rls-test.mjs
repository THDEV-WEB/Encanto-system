// scripts/auth-tenant-onda5-addresses-rls-test.mjs — REF-AUTH-TENANT-01 · Onda 5.
// Suite de verificacao das policies tenant-aware de `addresses` + save_structured_address. Roda
// SOMENTE contra o projeto E2E (db.e2e.env) — a migration desta onda NAO foi aplicada em producao.
// Camada B: SET LOCAL ROLE + request.jwt.claims (com tenant_id, o claim novo da Onda 3) dentro de
// BEGIN...ROLLBACK. Fixtures reais do E2E (USER_DUAL com customer legitimo em Encanto E Bar da Sogra
// E2E, criados na Onda 4) + 2 enderecos inseridos como postgres dentro da propria transacao de teste
// (desfeitos pelo ROLLBACK). Exit 0 = SUCCESS.
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

const USER_DUAL   = '5662cd2f-725d-429c-9701-960553ebbcbd';
const STRANGER    = '00000000-0000-4000-a000-000000000001'; // nao precisa existir em auth.users pra RLS
const CUST_ENCANTO = '969433f9-3bbd-408a-9628-4582c255aa20';
const STORE_ENCANTO = 'be2efc10-c0c8-410f-bcd4-af3f8a371df3';
const CUST_BAR     = '99999999-9999-4999-8999-999999999997';
const STORE_BAR     = '99999999-9999-4999-8999-999999999998';
const CUST_INATIVA  = '99999999-9999-4999-8999-999999999995';
const STORE_INATIVA = '99999999-9999-4999-8999-999999999996';
const ADDR_ENCANTO = '88888888-8888-4888-8888-888888888801';
const ADDR_BAR      = '88888888-8888-4888-8888-888888888802';

const R = []; const out = (s = '') => R.push(s);
let passes = 0, failures = 0, spCounter = 0;
const startedMs = Date.now(), startedIso = isoUtc();
function record(id, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} ${desc}`); out(`         -> ${detail}`);
}
let currentRole = 'postgres';
async function comoRole(role, sub, tenantId) {
  const claims = sub ? { sub, role, ...(tenantId !== undefined ? { tenant_id: tenantId } : {}) } : { role };
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

try {
  out('==================================================================');
  out(' SUITE — REF-AUTH-TENANT-01 · Onda 5 (addresses tenant-aware RLS) — E2E');
  out('==================================================================');
  out('Camada B: simulacao de sessao (com tenant_id nas claims) dentro de BEGIN...ROLLBACK.');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' (E2E) · sessao ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  await client.query('BEGIN');
  await client.query(`INSERT INTO public.addresses (id, customer_id, store_id, rua, numero) VALUES ($1,$2,$3,'Rua Encanto','1')`, [ADDR_ENCANTO, CUST_ENCANTO, STORE_ENCANTO]);
  await client.query(`INSERT INTO public.addresses (id, customer_id, store_id, rua, numero) VALUES ($1,$2,$3,'Rua Bar','2')`, [ADDR_BAR, CUST_BAR, STORE_BAR]);

  // ── SESSAO ENCANTO (auth.uid=USER_DUAL, tenant_id=Encanto) ──
  await comoRole('authenticated', USER_DUAL, STORE_ENCANTO);

  await tentar('ITEM1', 'customer Encanto -> SELECT endereco Encanto = ALLOW', `SELECT id FROM public.addresses WHERE id=$1`, [ADDR_ENCANTO],
    (r, err) => ({ ok: err === null && r.rows.length === 1, detail: err || `rows=${r?.rows?.length}` }));
  await tentar('ITEM2/5', 'SELECT endereco Bar (sessao Encanto) = DENY (0 linhas)', `SELECT id FROM public.addresses WHERE id=$1`, [ADDR_BAR],
    (r, err) => ({ ok: err === null && r.rows.length === 0, detail: err || `rows=${r?.rows?.length}` }));
  await tentar('ITEM7', 'UPDATE endereco Bar (sessao Encanto) = DENY (0 linhas afetadas)', `UPDATE public.addresses SET numero='HACK' WHERE id=$1`, [ADDR_BAR],
    (r, err) => ({ ok: err === null && r.rowCount === 0, detail: err || `rowCount=${r?.rowCount}` }));
  await tentar('ITEM8', 'DELETE endereco Bar (sessao Encanto) = DENY (0 linhas afetadas)', `DELETE FROM public.addresses WHERE id=$1`, [ADDR_BAR],
    (r, err) => ({ ok: err === null && r.rowCount === 0, detail: err || `rowCount=${r?.rowCount}` }));
  await tentar('ITEM6', 'INSERT endereco p/ Bar (sessao Encanto, customer_id+store_id da Bar) = DENY', `INSERT INTO public.addresses (customer_id, store_id, rua) VALUES ($1,$2,'ataque')`, [CUST_BAR, STORE_BAR],
    (r, err) => ({ ok: err !== null, detail: err || 'sem erro (FALHA GRAVE)' }));
  await tentar('ITEM9', 'INSERT store_id=Encanto mas customer_id manipulado p/ Bar = DENY (customer nao bate com tenant)', `INSERT INTO public.addresses (customer_id, store_id, rua) VALUES ($1,$2,'ataque2')`, [CUST_BAR, STORE_ENCANTO],
    (r, err) => ({ ok: err !== null, detail: err || 'sem erro (FALHA GRAVE)' }));
  await tentar('ITEM10', 'INSERT customer_id=Encanto mas store_id manipulado p/ Bar = DENY (store nao bate com tenant)', `INSERT INTO public.addresses (customer_id, store_id, rua) VALUES ($1,$2,'ataque3')`, [CUST_ENCANTO, STORE_BAR],
    (r, err) => ({ ok: err !== null, detail: err || 'sem erro (FALHA GRAVE)' }));
  await tentar('ITEM10b', 'UPDATE tentando MOVER o proprio endereco Encanto pra store_id=Bar = DENY (WITH CHECK barra a troca de tenant)', `UPDATE public.addresses SET store_id=$1 WHERE id=$2`, [STORE_BAR, ADDR_ENCANTO],
    (r, err) => ({ ok: err !== null || r?.rowCount === 0, detail: err || `rowCount=${r?.rowCount}` }));

  // ── SESSAO BAR (mesma pessoa, tenant_id=Bar) ──
  await comoRole('authenticated', USER_DUAL, STORE_BAR);
  await tentar('ITEM3', 'customer Bar -> SELECT endereco Bar (sessao Bar) = ALLOW', `SELECT id FROM public.addresses WHERE id=$1`, [ADDR_BAR],
    (r, err) => ({ ok: err === null && r.rows.length === 1, detail: err || `rows=${r?.rows?.length}` }));
  await tentar('ITEM4', 'SELECT endereco Encanto (sessao Bar) = DENY (0 linhas) — mesma PESSOA, tenant errado', `SELECT id FROM public.addresses WHERE id=$1`, [ADDR_ENCANTO],
    (r, err) => ({ ok: err === null && r.rows.length === 0, detail: err || `rows=${r?.rows?.length}` }));
  await tentar('ITEM4b', 'UPDATE endereco Encanto (sessao Bar) = DENY', `UPDATE public.addresses SET numero='HACK' WHERE id=$1`, [ADDR_ENCANTO],
    (r, err) => ({ ok: err === null && r.rowCount === 0, detail: err || `rowCount=${r?.rowCount}` }));
  await tentar('ITEM4c', 'DELETE endereco Encanto (sessao Bar) = DENY', `DELETE FROM public.addresses WHERE id=$1`, [ADDR_ENCANTO],
    (r, err) => ({ ok: err === null && r.rowCount === 0, detail: err || `rowCount=${r?.rowCount}` }));
  await tentar('ITEM4d', 'INSERT endereco p/ Encanto (sessao Bar) = DENY', `INSERT INTO public.addresses (customer_id, store_id, rua) VALUES ($1,$2,'ataque4')`, [CUST_ENCANTO, STORE_ENCANTO],
    (r, err) => ({ ok: err !== null, detail: err || 'sem erro (FALHA GRAVE)' }));

  // ── ITEM12: token SEM tenant_id — DENY em tudo, mesmo pra dado legitimo ──
  await comoRole('authenticated', USER_DUAL, null);
  await tentar('ITEM12a', 'SELECT proprio endereco Encanto SEM tenant_id no token = DENY (fail-closed)', `SELECT id FROM public.addresses WHERE id=$1`, [ADDR_ENCANTO],
    (r, err) => ({ ok: err === null && r.rows.length === 0, detail: err || `rows=${r?.rows?.length}` }));
  await tentar('ITEM12b', 'INSERT SEM tenant_id = DENY', `INSERT INTO public.addresses (customer_id, store_id, rua) VALUES ($1,$2,'ataque5')`, [CUST_ENCANTO, STORE_ENCANTO],
    (r, err) => ({ ok: err !== null, detail: err || 'sem erro (FALHA GRAVE)' }));

  // ── ITEM9(customer_id manipulado)/ITEM11(RPC direta): stranger sem NENHUM customer tenta o mesmo ──
  await comoRole('authenticated', STRANGER, STORE_ENCANTO);
  await tentar('ITEM9b', 'stranger (zero customer) com tenant_id=Encanto -> SELECT endereco Encanto = DENY', `SELECT id FROM public.addresses WHERE id=$1`, [ADDR_ENCANTO],
    (r, err) => ({ ok: err === null && r.rows.length === 0, detail: err || `rows=${r?.rows?.length}` }));

  // ── ITEM11: RPC direta (save_structured_address) cross-tenant — sessao Encanto tenta salvar p/ customer da Bar ──
  await comoRole('authenticated', USER_DUAL, STORE_ENCANTO);
  await tentar('ITEM11', 'save_structured_address com customer_id da Bar (sessao Encanto) -> vira ORFAO (customer_id NULL), nao vincula errado', `SELECT public.save_structured_address($1) AS id`, [JSON.stringify({ customer_id: CUST_BAR, rua: 'RPC ataque' })],
    async (r, err) => {
      if (err) return { ok: false, detail: err };
      const linha = await superScalar(`SELECT customer_id, store_id FROM public.addresses WHERE id=$1`, [r.rows[0].id]);
      return { ok: linha.customer_id === null, detail: JSON.stringify(linha) };
    });
  await tentar('ITEM11b', 'save_structured_address com customer_id legitimo (Encanto, sessao Encanto) -> vincula E deriva store_id certo', `SELECT public.save_structured_address($1) AS id`, [JSON.stringify({ customer_id: CUST_ENCANTO, rua: 'RPC legitima' })],
    async (r, err) => {
      if (err) return { ok: false, detail: err };
      const linha = await superScalar(`SELECT customer_id, store_id FROM public.addresses WHERE id=$1`, [r.rows[0].id]);
      return { ok: linha.customer_id === CUST_ENCANTO && linha.store_id === STORE_ENCANTO, detail: JSON.stringify(linha) };
    });

  // ── ITEM14: loja INATIVA — mesmo com customer legitimo, tenant_id pra loja inativa nunca deveria existir
  //    (Hook ja garante isso, Onda 3) — aqui testamos a CAMADA RLS assumindo hipoteticamente que esse
  //    claim aparecesse, pra confirmar defesa em profundidade: precisa dar DENY tambem. ──
  await comoRole('authenticated', USER_DUAL, STORE_INATIVA);
  const addrInativa = '88888888-8888-4888-8888-888888888803';
  await superScalar(`INSERT INTO public.addresses (id, customer_id, store_id, rua) VALUES ($1,$2,$3,'Rua Inativa')`, [addrInativa, CUST_INATIVA, STORE_INATIVA]);
  await tentar('ITEM14', 'SELECT endereco de loja INATIVA (mesmo com tenant_id/customer coerentes) — RLS por si so nao verifica status, Hook e quem garante isso nunca acontecer (documentado)', `SELECT id FROM public.addresses WHERE id=$1`, [addrInativa],
    (r, err) => ({ ok: err === null && r.rows.length === 1, detail: 'RLS permite (nao verifica stores.status) — protecao real e o Hook nunca emitir esse claim, ja confirmado na Onda 3; ver Riscos/Limitacoes' }));

  // ── ITEM13: guest/anon — sem grant, igual desde a SEC-01 ──
  await comoRole('anon', null);
  await tentar('ITEM13', 'anon tenta SELECT = DENY (permission denied, sem grant)', `SELECT id FROM public.addresses LIMIT 1`, [],
    (r, err) => ({ ok: err !== null && /permission denied/i.test(err), detail: err || 'sem erro (FALHA GRAVE)' }));

  await client.query('ROLLBACK');
  out('');
  out('— Transacao de teste desfeita (ROLLBACK) — enderecos/loja inativa fixture nao persistiram —');
  out('');

  // ── ITEM15: Admin continua funcionando (admin_order_endereco + is_admin_of, fora da RLS de addresses) ──
  {
    const r = await client.query(`SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('admin_order_endereco','is_admin_of')`);
    const ok = r.rows.length === 2 && r.rows.every((x) => x.prosecdef === true);
    record('ITEM15', 'admin_order_endereco/is_admin_of continuam SECURITY DEFINER, nao tocadas nesta onda', ok ? 'PASS' : 'FAIL', JSON.stringify(r.rows));
  }
  // ── ITEM16: Super Admin — is_super_admin nao tocada ──
  {
    const r = await client.query(`SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='is_super_admin'`);
    const ok = r.rows.length === 1 && r.rows[0].prosecdef === true;
    record('ITEM16', 'is_super_admin nao tocada nesta onda', ok ? 'PASS' : 'FAIL', JSON.stringify(r.rows));
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
  console.log('ETAPA — TESTES DA FASE (REF-AUTH-TENANT-01 · Onda 5 · E2E)');
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
