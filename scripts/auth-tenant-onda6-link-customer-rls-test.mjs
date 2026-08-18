// scripts/auth-tenant-onda6-link-customer-rls-test.mjs — REF-AUTH-TENANT-01 · Onda 6.
// Suite de verificacao de link_customer_to_auth com validacao de tenant_id. Roda SOMENTE contra o
// projeto E2E (db.e2e.env) — a migration desta onda NAO foi aplicada em producao.
// Camada B: SET LOCAL ROLE + request.jwt.claims (com/sem tenant_id) dentro de BEGIN...ROLLBACK.
// Fixtures reais do E2E (USER_DUAL com customer legitimo em Encanto E Bar da Sogra E2E, da Onda 4) +
// customers extras inseridos como postgres dentro da propria transacao de teste (desfeitos pelo
// ROLLBACK). Exit 0 = SUCCESS.
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
// link_customer_to_auth ESCREVE em customers.auth_user_id (FK real p/ auth.users) -- ao contrario dos
// testes de addresses/activate_tenant (RLS pura, so LEITURA de auth.uid()), aqui precisa de auth.users
// DE VERDADE. So existem 3 no projeto E2E; reaproveita os fixtures de admin como "pessoas distintas"
// (nenhuma logica de is_admin_of/admins entra em jogo nestes testes, so auth.uid() puro).
const STRANGER       = '1265c4c1-32b8-4125-9831-25cf57541dc5'; // ADMIN_FIXTURE — usado so como auth.uid() de "outra pessoa", zero customer previo (confirmado)
const STRANGER_NOVO  = 'bc45ac7f-948a-4571-8df9-ce544757bcad'; // ADMIN_B_FIXTURE — pessoa sem NENHUM customer em lugar nenhum (confirmado)
const CUST_ENCANTO   = '969433f9-3bbd-408a-9628-4582c255aa20';
const STORE_ENCANTO  = 'be2efc10-c0c8-410f-bcd4-af3f8a371df3';
const CUST_BAR       = '99999999-9999-4999-8999-999999999997';
const STORE_BAR      = '99999999-9999-4999-8999-999999999998';
const STORE_INATIVA  = '99999999-9999-4999-8999-999999999996';

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
  out(' SUITE — REF-AUTH-TENANT-01 · Onda 6 (link_customer_to_auth tenant-aware) — E2E');
  out('==================================================================');
  out('Camada B: simulacao de sessao (com/sem tenant_id nas claims) dentro de BEGIN...ROLLBACK.');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' (E2E) · sessao ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  await client.query('BEGIN');
  // Fixtures extras SO desta transacao (desfeitas pelo ROLLBACK): stranger com customer proprio em
  // Encanto (anti-takeover) + convidado com HISTORICO (requer_verificacao) + telefone real e conhecido
  // do CUST_BAR pra provar que nem posse legitima do proprio telefone atravessa o tenant errado.
  const STRANGER_CUST_ENCANTO = '77777777-7777-4777-8777-777777777701';
  const GUEST_HIST_CUST       = '77777777-7777-4777-8777-777777777702';
  const GUEST_HIST_ORDER      = '77777777-7777-4777-8777-777777777703';
  await client.query(`INSERT INTO public.customers (id, name, phone, auth_user_id, store_id) VALUES ($1,'Stranger Encanto','47900000001',$2,$3)`, [STRANGER_CUST_ENCANTO, STRANGER, STORE_ENCANTO]);
  await client.query(`INSERT INTO public.customers (id, name, phone, auth_user_id, store_id) VALUES ($1,'Guest com Historico','47900000002',NULL,$2)`, [GUEST_HIST_CUST, STORE_ENCANTO]);
  await client.query(`INSERT INTO public.orders (id, customer_id, total, status, payment_method, address) VALUES ($1,$2,10,'recebido','dinheiro','Rua Teste')`, [GUEST_HIST_ORDER, GUEST_HIST_CUST]);
  await client.query(`UPDATE public.customers SET phone='47900000200' WHERE id=$1`, [CUST_BAR]); // normaliza pra um valor que a RPC realmente consegue comparar

  // ── SESSAO ENCANTO (auth.uid=USER_DUAL, tenant_id=Encanto) ──
  await comoRole('authenticated', USER_DUAL, STORE_ENCANTO);

  await callRpc('ITEM1', 'tenant=Encanto + p_store_id=Encanto -> ALLOW (atualiza o proprio customer)',
    `SELECT public.link_customer_to_auth($1, NULL, NULL, $2) AS r`, ['47900000101', STORE_ENCANTO],
    (row) => { const r = row?.r; return { ok: r?.ok === true && r?.status === 'atualizado' && r?.customer_id === CUST_ENCANTO, detail: JSON.stringify(r) }; });

  await callRpc('ITEM2', 'tenant=Encanto + p_store_id=Bar -> DENY (loja invalida), mesmo loja existindo de verdade',
    `SELECT public.link_customer_to_auth($1, NULL, NULL, $2) AS r`, ['47900000102', STORE_BAR],
    (row) => { const r = row?.r; return { ok: r?.ok === false && r?.error === 'loja invalida', detail: JSON.stringify(r) }; });

  await callRpc('ITEM5', 'tenant=Encanto + p_store_id=Bar usando o TELEFONE REAL do proprio customer da Bar -> DENY (posse legitima do outro tenant nao atravessa)',
    `SELECT public.link_customer_to_auth($1, NULL, NULL, $2) AS r`, ['47900000200', STORE_BAR],
    (row) => { const r = row?.r; return { ok: r?.ok === false && r?.error === 'loja invalida', detail: JSON.stringify(r) }; });

  await callRpc('ITEM6', 'tenant=Encanto + telefone ja vinculado a OUTRO auth.uid() (na mesma loja) -> DENY (anti-takeover preservado com tenant presente)',
    `SELECT public.link_customer_to_auth($1, NULL, NULL, $2) AS r`, ['47900000001', STORE_ENCANTO],
    (row) => { const r = row?.r; return { ok: r?.ok === false && r?.error === 'telefone ja vinculado a outra conta', detail: JSON.stringify(r) }; });

  await callRpc('ITEM9', 'tenant=Encanto + telefone de convidado COM HISTORICO -> requer_verificacao (REF-LOYALTY-01a preservada com tenant presente)',
    `SELECT public.link_customer_to_auth($1, NULL, NULL, $2) AS r`, ['47900000002', STORE_ENCANTO],
    (row) => { const r = row?.r; return { ok: r?.ok === false && r?.status === 'requer_verificacao', detail: JSON.stringify(r) }; });

  // ── STRANGER_NOVO: zero customer em qualquer loja, tenant=Encanto, cria novo (caso c) normalmente ──
  await comoRole('authenticated', STRANGER_NOVO, STORE_ENCANTO);
  await callRpc('ITEM-CRIA', 'tenant=Encanto + pessoa nova (zero customer) -> ALLOW cria (caso c continua funcionando com tenant presente)',
    `SELECT public.link_customer_to_auth($1, NULL, 'Novo Onda6', $2) AS r`, ['47900000300', STORE_ENCANTO],
    (row) => { const r = row?.r; return { ok: r?.ok === true && r?.status === 'criado', detail: JSON.stringify(r) }; });

  // ── SESSAO BAR (mesma pessoa, tenant_id=Bar) ──
  await comoRole('authenticated', USER_DUAL, STORE_BAR);
  await callRpc('ITEM3', 'tenant=Bar + p_store_id=Bar -> ALLOW (atualiza o customer da Bar, mesma pessoa)',
    `SELECT public.link_customer_to_auth($1, NULL, NULL, $2) AS r`, ['47900000104', STORE_BAR],
    (row) => { const r = row?.r; return { ok: r?.ok === true && r?.status === 'atualizado' && r?.customer_id === CUST_BAR, detail: JSON.stringify(r) }; });

  await callRpc('ITEM4', 'tenant=Bar + p_store_id=Encanto -> DENY (loja invalida) — mesma pessoa, tenant errado',
    `SELECT public.link_customer_to_auth($1, NULL, NULL, $2) AS r`, ['47900000105', STORE_ENCANTO],
    (row) => { const r = row?.r; return { ok: r?.ok === false && r?.error === 'loja invalida', detail: JSON.stringify(r) }; });

  // ── SEM TENANT (Hook desligado / sessao fora do fluxo normal) — fluxo LEGADO precisa continuar identico ──
  await comoRole('authenticated', USER_DUAL, undefined); // sem chave tenant_id nas claims (nao so null)
  await callRpc('ITEM7', 'sem tenant_id + p_store_id=Encanto explicito -> ALLOW (comportamento legado preservado, igual antes desta onda)',
    `SELECT public.link_customer_to_auth($1, NULL, NULL, $2) AS r`, ['47900000106', STORE_ENCANTO],
    (row) => { const r = row?.r; return { ok: r?.ok === true && r?.status === 'atualizado' && r?.customer_id === CUST_ENCANTO, detail: JSON.stringify(r) }; });

  await callRpc('ITEM7b', 'sem tenant_id + p_store_id OMITIDO -> cai no DEFAULT default_store_id()=Encanto (regressao do fluxo pre-tenant)',
    `SELECT public.link_customer_to_auth($1, NULL, NULL) AS r`, ['47900000107'],
    (row) => { const r = row?.r; return { ok: r?.ok === true && r?.status === 'atualizado' && r?.customer_id === CUST_ENCANTO, detail: JSON.stringify(r) }; });

  await callRpc('ITEM8', 'sem tenant_id + telefone ja vinculado a OUTRO auth.uid() -> DENY (anti-takeover nao depende do tenant)',
    `SELECT public.link_customer_to_auth($1, NULL, NULL, $2) AS r`, ['47900000001', STORE_ENCANTO],
    (row) => { const r = row?.r; return { ok: r?.ok === false && r?.error === 'telefone ja vinculado a outra conta', detail: JSON.stringify(r) }; });

  // ── loja INATIVA — mesma logica de defesa em profundidade documentada na Onda 5: a funcao em si nao
  //    reconfirma stores.status (quem garante isso e o Hook nunca emitir esse claim, Onda 3) ──
  await comoRole('authenticated', STRANGER_NOVO, STORE_INATIVA);
  await callRpc('ITEM14', 'tenant=loja INATIVA + p_store_id=loja INATIVA -> ALLOW na RPC (Hook e quem garante que esse claim nunca existe de verdade, ja provado na Onda 3; documentado como limitacao de camada)',
    `SELECT public.link_customer_to_auth($1, NULL, 'Inativa Onda6', $2) AS r`, ['47900000301', STORE_INATIVA],
    (row) => { const r = row?.r; return { ok: r?.ok === true && r?.status === 'criado', detail: 'RPC permite (nao reconfirma stores.status) — protecao real e o Hook, ja confirmado na Onda 3; ver Riscos/Limitacoes' }; });

  await client.query('ROLLBACK');
  out('');
  out('— Transacao de teste desfeita (ROLLBACK) — nenhum customer/pedido de teste persistiu —');
  out('');

  // ── GRANTS: anon/PUBLIC nao tem mais EXECUTE ──
  {
    const r = await client.query(`SELECT grantee FROM information_schema.routine_privileges WHERE routine_schema='public' AND routine_name='link_customer_to_auth' ORDER BY grantee`);
    const grantees = r.rows.map(x => x.grantee).sort();
    const esperado = ['authenticated', 'postgres', 'service_role'].sort();
    const ok = JSON.stringify(grantees) === JSON.stringify(esperado);
    record('ITEM12', 'EXECUTE de link_customer_to_auth restrito a authenticated/postgres/service_role (anon/PUBLIC revogados)', ok ? 'PASS' : 'FAIL', JSON.stringify(grantees));
  }
  {
    await client.query('BEGIN');
    await comoRole('anon', null);
    let errMsg = null;
    try { await client.query(`SELECT public.link_customer_to_auth('47900000999', NULL, NULL) AS r`); }
    catch (e) { errMsg = redact(e.message).split('\n')[0]; }
    await client.query('ROLLBACK');
    const ok = errMsg !== null && /permission denied/i.test(errMsg);
    record('ITEM12b', 'anon tentando chamar link_customer_to_auth -> permission denied (EXECUTE revogado, nem chega no auth.uid())', ok ? 'PASS' : 'FAIL', errMsg || 'sem erro (FALHA GRAVE)');
  }

  // ── ADMIN/SUPER ADMIN nao tocados nesta onda ──
  {
    const r = await client.query(`SELECT p.proname, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('admin_link_customer_to_auth','is_admin_of','is_super_admin')`);
    const ok = r.rows.length === 3 && r.rows.every((x) => x.prosecdef === true);
    record('ITEM15/16', 'admin_link_customer_to_auth/is_admin_of/is_super_admin continuam SECURITY DEFINER, nao tocadas nesta onda', ok ? 'PASS' : 'FAIL', JSON.stringify(r.rows));
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
  console.log('ETAPA — TESTES DA FASE (REF-AUTH-TENANT-01 · Onda 6 · E2E)');
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
