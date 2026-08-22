// Suite de verificacao da REF-AUTH-TENANT-01 · Onda 2 (activate_tenant) — "Testes da fase".
// Cobre: autorizacao real (customer+loja ativa, nao so store_id existir), ausencia estrutural de
// parametro de session_id/auth_user_id, mensagem unica pra loja inexistente/inativa/sem vinculo
// (anti-enumeracao), concorrencia entre 2 sessoes reais da MESMA pessoa, troca legitima de tenant,
// grants (anon negado, authenticated permitido), SECURITY DEFINER + search_path seguro.
//
// Camada B: SET LOCAL ROLE + request.jwt.claims (com session_id incluso) dentro de BEGIN...ROLLBACK.
// Loja Bar da Sogra ainda nao tem customer real -- cria-se um customer SINTETICO reaproveitando um
// auth_user_id REAL (mesma tecnica ja validada nas auditorias SEC-01/UX-01/SEC-02), desfeito pelo
// ROLLBACK. Loja "inativa" tambem e sintetica (INSERT temporario em stores). Exit 0 = SUCCESS.
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

// Fixtures reais desta sessao (UUIDs opacos, sem PII): USER_DUAL tem 2 sessoes REAIS simultaneas
// (perfeito pro teste de concorrencia) e customer real na Encanto -- ganha customer SINTETICO na Bar
// da Sogra so dentro da tx. USER_ENCANTO_ONLY so tem customer na Encanto (prova o DENY cross-tenant
// sem vinculo). STRANGER nao tem nenhum customer.
const USER_DUAL          = 'cbd7db65-f2dc-4f13-977b-e76671c41eb6';
const SESSION_DUAL_A     = '8ce71896-83c6-4b74-861b-d3f9855b5caf'; // sessao real de USER_DUAL
const SESSION_DUAL_B     = 'd9a57a33-ca0e-4983-b913-08c9b82b0144'; // OUTRA sessao real, mesma pessoa
const USER_ENCANTO_ONLY  = 'ce7ece01-266c-42b1-a9db-8051da24d7f5';
const SESSION_ENCANTO_ONLY = '02056060-c3e6-477d-a04e-f8e40e5855e8';
const STRANGER            = '4fa5541f-989f-4b8d-89b4-7b45a59d8f4e';
const SESSION_STRANGER    = 'bb21b082-c166-4f47-888a-8080c796231e'; // sessao real de STRANGER

const ENCANTO = '8604324d-0529-443d-aa79-4337057bfa01';
const BAR     = '776a01c8-f836-417a-a957-a0e1109f90a2';
const LOJA_INATIVA_ID = '00000000-0000-4000-a000-000000000099'; // sintetica, so dentro da tx

const R = []; const out = (s = '') => R.push(s);
let passes = 0, failures = 0, spCounter = 0;
const startedMs = Date.now(), startedIso = isoUtc();
function record(id, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} ${desc}`); out(`         -> ${detail}`);
}
let currentRole = 'postgres';
async function tx(role, sub, sessionId, setupSql, fn) {
  try {
    await client.query('BEGIN');
    for (const s of (setupSql || [])) await client.query(s);
    const claims = sub ? { sub, role, session_id: sessionId ?? undefined } : { role };
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await client.query(`SET LOCAL ROLE ${role}`);
    currentRole = role;
    return await fn();
  } finally { await client.query('ROLLBACK').catch(() => {}); }
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
  let result = null, errMsg = null;
  try { const r = await client.query(sql, params); result = r.rows[0]; await client.query(`RELEASE SAVEPOINT ${sp}`); }
  catch (e) { errMsg = redact(e.message).split('\n')[0]; await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); }
  const { ok, detail } = checkFn(result, errMsg);
  record(id, desc, ok ? 'PASS' : 'FAIL', detail);
  return { result, errMsg };
}
// Customer sintetico da Bar da Sogra pra USER_DUAL -- so existe dentro da tx (ROLLBACK desfaz).
function setupCustomerBarDual() {
  return [`INSERT INTO public.customers (id, name, phone, auth_user_id, store_id)
           VALUES ('00000000-0000-4000-a000-000000000001','Teste Onda2','+5599999999999','${USER_DUAL}','${BAR}')
           ON CONFLICT DO NOTHING`];
}
// Loja sintetica INATIVA + customer sintetico de USER_DUAL vinculado a ela.
function setupLojaInativaComCustomer() {
  return [
    `INSERT INTO public.stores (id, slug, nome, status) VALUES ('${LOJA_INATIVA_ID}','loja-inativa-teste-onda2','Loja Inativa (teste)','suspenso') ON CONFLICT DO NOTHING`,
    `INSERT INTO public.customers (id, name, phone, auth_user_id, store_id)
     VALUES ('00000000-0000-4000-a000-000000000002','Teste Onda2 Inativa','+5599999999998','${USER_DUAL}','${LOJA_INATIVA_ID}')
     ON CONFLICT DO NOTHING`,
  ];
}

try {
  out('==================================================================');
  out(' SUITE — REF-AUTH-TENANT-01 · Onda 2 (activate_tenant) — RELATORIO');
  out('==================================================================');
  out('Camada B: simulacao de sessao (com session_id no claim) dentro de BEGIN...ROLLBACK.');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessao ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  out('— ITEM 1: vinculo valido (Encanto) — ALLOW, grava session_id/auth_user_id/store_id corretos —');
  await tx('authenticated', USER_ENCANTO_ONLY, SESSION_ENCANTO_ONLY, [], async () => {
    await callRpc('ITEM1-allow', 'activate_tenant(Encanto) sucede pra quem realmente e cliente la', `SELECT public.activate_tenant($1)`, [ENCANTO],
      (row, err) => ({ ok: err === null, detail: err || 'sem erro' }));
    const linha = await superScalar(`SELECT session_id, auth_user_id, store_id FROM public.active_tenant WHERE session_id=$1`, [SESSION_ENCANTO_ONLY]);
    const ok = linha?.auth_user_id === USER_ENCANTO_ONLY && linha?.store_id === ENCANTO;
    record('ITEM1-linha-correta', 'linha gravada com session/user/store certos', ok ? 'PASS' : 'FAIL', JSON.stringify(linha));
  });
  out('');

  out('— ITEM 2: vinculo valido (Bar) com customer sintetico — ALLOW —');
  await tx('authenticated', USER_DUAL, SESSION_DUAL_A, setupCustomerBarDual(), async () => {
    await callRpc('ITEM2-allow', 'activate_tenant(Bar) sucede pra quem tem customer sintetico la', `SELECT public.activate_tenant($1)`, [BAR],
      (row, err) => ({ ok: err === null, detail: err || 'sem erro' }));
  });
  out('');

  out('— ITEM 3: SEM vinculo (Encanto-only tenta ativar Bar) — DENY —');
  await tx('authenticated', USER_ENCANTO_ONLY, SESSION_ENCANTO_ONLY, [], async () => {
    await callRpc('ITEM3-deny', 'usuario sem customer na Bar recebe DENY generico', `SELECT public.activate_tenant($1)`, [BAR],
      (row, err) => ({ ok: err !== null && err.includes('tenant indisponivel'), detail: err || 'sem erro (FALHA GRAVE)' }));
  });
  out('');

  out('— ITEM 4: loja inexistente — DENY com a MESMA mensagem generica —');
  let msgInexistente = null;
  await tx('authenticated', USER_DUAL, SESSION_DUAL_A, setupCustomerBarDual(), async () => {
    const { errMsg } = await callRpc('ITEM4-deny', 'store_id aleatorio (nao existe) recebe DENY', `SELECT public.activate_tenant($1)`, ['11111111-2222-4333-8444-555555555555'],
      (row, err) => ({ ok: err !== null && err.includes('tenant indisponivel'), detail: err || 'sem erro (FALHA GRAVE)' }));
    msgInexistente = errMsg;
  });
  out('');

  out('— ITEM 5: loja existe mas INATIVA (mesmo com customer la) — DENY, MESMA mensagem —');
  let msgInativa = null;
  await tx('authenticated', USER_DUAL, SESSION_DUAL_A, setupLojaInativaComCustomer(), async () => {
    const { errMsg } = await callRpc('ITEM5-deny', 'loja inativa recebe DENY mesmo com customer vinculado', `SELECT public.activate_tenant($1)`, [LOJA_INATIVA_ID],
      (row, err) => ({ ok: err !== null && err.includes('tenant indisponivel'), detail: err || 'sem erro (FALHA GRAVE)' }));
    msgInativa = errMsg;
  });
  out('');

  out('— ITEM 6: anti-enumeracao — as 3 mensagens de DENY (sem vinculo/inexistente/inativa) sao IDENTICAS —');
  {
    let msgSemVinculo = null;
    await tx('authenticated', USER_ENCANTO_ONLY, SESSION_ENCANTO_ONLY, [], async () => {
      const { errMsg } = await callRpc('ITEM6-setup', 'coleta mensagem do caso sem-vinculo', `SELECT public.activate_tenant($1)`, [BAR], () => ({ ok: true, detail: 'coletado' }));
      msgSemVinculo = errMsg;
    });
    const ok = msgSemVinculo && msgSemVinculo === msgInexistente && msgInexistente === msgInativa;
    record('ITEM6-mensagens-iguais', 'nenhuma pista de qual motivo causou o DENY', ok ? 'PASS' : 'FAIL', JSON.stringify({ msgSemVinculo, msgInexistente, msgInativa }));
  }
  out('');

  out('— ITEM 7: p_store_id NULL — DENY —');
  await tx('authenticated', USER_ENCANTO_ONLY, SESSION_ENCANTO_ONLY, [], async () => {
    await callRpc('ITEM7-deny', 'store_id NULL recebe DENY (nao passa como "todas as lojas")', `SELECT public.activate_tenant($1)`, [null],
      (row, err) => ({ ok: err !== null && err.includes('tenant indisponivel'), detail: err || 'sem erro (FALHA GRAVE)' }));
  });
  out('');

  out('— ITEM 8: SEM parametro utilizavel pra session_id/auth_user_id — prova ESTRUTURAL da assinatura —');
  {
    const r = await client.query(`
      SELECT pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='activate_tenant'`);
    const args = r.rows[0]?.args || '';
    const ok = args === 'p_store_id uuid';
    record('ITEM8-assinatura', 'unico parametro e p_store_id -- nao ha como o caller escolher sessao/identidade', ok ? 'PASS' : 'FAIL', JSON.stringify({ args }));
  }
  out('');

  out('— ITEM 9: troca LEGITIMA de tenant — Encanto ALLOW, depois Bar ALLOW (mesma pessoa, mesma sessao) —');
  await tx('authenticated', USER_DUAL, SESSION_DUAL_A, setupCustomerBarDual(), async () => {
    await callRpc('ITEM9-encanto', 'ativa Encanto primeiro', `SELECT public.activate_tenant($1)`, [ENCANTO], (row, err) => ({ ok: err === null, detail: err || 'sem erro' }));
    const antes = await superScalar(`SELECT store_id FROM public.active_tenant WHERE session_id=$1`, [SESSION_DUAL_A]);
    await callRpc('ITEM9-troca-bar', 'troca pra Bar na MESMA sessao (nao e cross-tenant indevido, e troca legitima)', `SELECT public.activate_tenant($1)`, [BAR], (row, err) => ({ ok: err === null, detail: err || 'sem erro' }));
    const depois = await superScalar(`SELECT store_id FROM public.active_tenant WHERE session_id=$1`, [SESSION_DUAL_A]);
    const ok = antes?.store_id === ENCANTO && depois?.store_id === BAR;
    record('ITEM9-upsert-troca', 'UPSERT atualiza a MESMA linha (1 sessao = 1 tenant ativo por vez)', ok ? 'PASS' : 'FAIL', JSON.stringify({ antes, depois }));
  });
  out('');

  out('— ITEM 10: CONCORRENCIA — 2 sessoes REAIS da MESMA pessoa, tenants DIFERENTES, sem overwrite —');
  await tx('authenticated', USER_DUAL, SESSION_DUAL_A, setupCustomerBarDual(), async () => {
    await callRpc('ITEM10-sessaoA', 'sessao A ativa Encanto', `SELECT public.activate_tenant($1)`, [ENCANTO], (row, err) => ({ ok: err === null, detail: err || 'sem erro' }));

    // Troca a sessao simulada (mesma pessoa, MESMA transacao -- perderia o customer sintetico da Bar
    // se abrisse uma tx() nova) pra SESSION_DUAL_B, ativa Bar la.
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: USER_DUAL, role: 'authenticated', session_id: SESSION_DUAL_B })]);
    await callRpc('ITEM10-sessaoB', 'sessao B (mesma pessoa) ativa Bar', `SELECT public.activate_tenant($1)`, [BAR], (row, err) => ({ ok: err === null, detail: err || 'sem erro' }));

    const linhaA = await superScalar(`SELECT store_id FROM public.active_tenant WHERE session_id=$1`, [SESSION_DUAL_A]);
    const linhaB = await superScalar(`SELECT store_id FROM public.active_tenant WHERE session_id=$1`, [SESSION_DUAL_B]);
    const ok = linhaA?.store_id === ENCANTO && linhaB?.store_id === BAR;
    record('ITEM10-sem-disputa', 'sessao A continua Encanto, sessao B continua Bar -- nenhuma sobrescreveu a outra', ok ? 'PASS' : 'FAIL', JSON.stringify({ linhaA, linhaB }));
  });
  out('');

  out('— ITEM 11: STRANGER (sem nenhum customer) — DENY em qualquer loja —');
  await tx('authenticated', STRANGER, SESSION_STRANGER, [], async () => {
    await callRpc('ITEM11-deny', 'stranger recebe DENY generico ao tentar Encanto', `SELECT public.activate_tenant($1)`, [ENCANTO],
      (row, err) => ({ ok: err !== null && err.includes('tenant indisponivel'), detail: err || 'sem erro (FALHA GRAVE)' }));
  });
  out('');

  out('— ITEM 12: session_id ausente do claim — DENY ("sessao invalida", categoria distinta de tenant) —');
  await tx('authenticated', USER_ENCANTO_ONLY, null, [], async () => {
    await callRpc('ITEM12-deny', 'sem session_id no JWT -> nao grava nada', `SELECT public.activate_tenant($1)`, [ENCANTO],
      (row, err) => ({ ok: err !== null && err.includes('sessao invalida'), detail: err || 'sem erro (FALHA GRAVE)' }));
  });
  out('');

  out('— ITEM 13: session_id sintatico mas SEM linha real em auth.sessions — DENY limpo (nao FK cru) —');
  await tx('authenticated', USER_ENCANTO_ONLY, '77777777-7777-4777-8777-777777777777', [], async () => {
    await callRpc('ITEM13-deny', 'session_id inexistente em auth.sessions -> "sessao invalida", nao erro de constraint', `SELECT public.activate_tenant($1)`, [ENCANTO],
      (row, err) => ({ ok: err !== null && err.includes('sessao invalida'), detail: err || 'sem erro (FALHA GRAVE)' }));
  });
  out('');

  out('— ITEM 14: GRANTS — anon NAO tem EXECUTE, authenticated tem —');
  await tx('anon', null, null, [], async () => {
    await callRpc('ITEM14-anon-negado', 'anon recebe permission denied (sem grant de EXECUTE)', `SELECT public.activate_tenant($1)`, [ENCANTO],
      (row, err) => ({ ok: err !== null && /permission denied/i.test(err), detail: err || 'sem erro (FALHA GRAVE)' }));
  });
  {
    const r = await client.query(`
      SELECT string_agg(grantee, ',' ORDER BY grantee) AS grantees
      FROM information_schema.routine_privileges
      WHERE routine_schema='public' AND routine_name='activate_tenant' AND privilege_type='EXECUTE'`);
    const grantees = r.rows[0]?.grantees || '';
    const ok = grantees.includes('authenticated') && !grantees.includes('anon');
    record('ITEM14-grants-finais', 'EXECUTE so pra authenticated/postgres/service_role', ok ? 'PASS' : 'FAIL', JSON.stringify({ grantees }));
  }
  out('');

  out('— ITEM 15: SECURITY DEFINER + search_path seguro (protegido contra search_path injection) —');
  {
    const r = await client.query(`
      SELECT p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='activate_tenant'`);
    const row = r.rows[0];
    const cfg = (row?.proconfig || []).join(';');
    const ok = row?.prosecdef === true && cfg.includes('search_path=pg_catalog, public');
    record('ITEM15-definer-searchpath', 'SECURITY DEFINER=true, search_path fixo pg_catalog,public', ok ? 'PASS' : 'FAIL', JSON.stringify({ prosecdef: row?.prosecdef, proconfig: row?.proconfig }));
  }
  out('');

  out('— ITEM 16: LOGOUT (estrutural) — FK active_tenant.session_id -> auth.sessions ON DELETE CASCADE segue intacta —');
  {
    const r = await client.query(`
      SELECT rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.referential_constraints rc ON rc.constraint_name=tc.constraint_name AND rc.constraint_schema=tc.table_schema
      WHERE tc.table_schema='public' AND tc.table_name='active_tenant' AND tc.constraint_name='active_tenant_session_id_fkey'`);
    const ok = r.rows[0]?.delete_rule === 'CASCADE';
    record('ITEM16-cascade-logout', 'nenhum mecanismo paralelo criado -- limpeza no logout continua via CASCADE da FK (ja confirmado na Onda 1)', ok ? 'PASS' : 'FAIL', JSON.stringify(r.rows[0]));
  }
  out('');

  out('— REGRESSAO: active_tenant permanece vazia (nenhum teste persistiu linha real) —');
  {
    const r = await client.query(`SELECT count(*)::int AS n FROM public.active_tenant`);
    const ok = r.rows[0].n === 0;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] REGRESSAO active_tenant vazia`); out(`         -> ${JSON.stringify(r.rows[0])}`);
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
  console.log('ETAPA — TESTES DA FASE (REF-AUTH-TENANT-01 · Onda 2)');
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
