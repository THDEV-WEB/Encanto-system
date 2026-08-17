// Suite de verificacao da REF-AUTH-TENANT-01 · Onda 3 (custom_access_token_hook) — "Testes da fase".
// Testa a FUNCAO em isolamento (chamada direta com jsonb de evento, formato real documentado pela
// Supabase: {user_id, claims, authentication_method}) dentro de BEGIN...ROLLBACK, com fixtures reais
// (2 sessoes reais e simultaneas da mesma pessoa) e sinteticas (loja inativa). A prova de que o Hook
// esta de fato LIGADO na emissao de token real do GoTrue (Dashboard, fora do alcance de SQL) e feita
// a parte, documentada no relatorio da onda — este script cobre tudo que e verificavel via SQL.
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

const USER_DUAL      = 'cbd7db65-f2dc-4f13-977b-e76671c41eb6';
const SESSION_A      = '8ce71896-83c6-4b74-861b-d3f9855b5caf'; // sessao real
const SESSION_B      = 'd9a57a33-ca0e-4983-b913-08c9b82b0144'; // OUTRA sessao real, mesma pessoa
const ENCANTO        = '8604324d-0529-443d-aa79-4337057bfa01';
const BAR            = '776a01c8-f836-417a-a957-a0e1109f90a2';
const LOJA_INATIVA   = '22222222-2222-4222-8222-222222222222'; // sintetica, so dentro da tx

const evento = (sub, sessionId, extra = {}) => JSON.stringify({
  user_id: sub,
  claims: { sub, session_id: sessionId, role: 'authenticated', ...extra },
  authentication_method: 'password',
});

const R = []; const out = (s = '') => R.push(s);
let passes = 0, failures = 0, spCounter = 0;
const startedMs = Date.now(), startedIso = isoUtc();
function record(id, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} ${desc}`); out(`         -> ${detail}`);
}
async function callHook(id, desc, eventJson, checkFn) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  let result = null, errMsg = null;
  try { const r = await client.query(`SELECT public.custom_access_token_hook($1::jsonb) AS r`, [eventJson]); result = r.rows[0].r; await client.query(`RELEASE SAVEPOINT ${sp}`); }
  catch (e) { errMsg = redact(e.message).split('\n')[0]; await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); }
  const { ok, detail } = checkFn(result, errMsg);
  record(id, desc, ok ? 'PASS' : 'FAIL', detail);
  return result;
}

try {
  out('==================================================================');
  out(' SUITE — REF-AUTH-TENANT-01 · Onda 3 (custom_access_token_hook) — RELATORIO');
  out('==================================================================');
  out('Testa a FUNCAO em isolamento dentro de BEGIN...ROLLBACK. A prova de que o Hook esta LIGADO');
  out('na emissao real de token (Dashboard) e feita a parte — fora do alcance de SQL.');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessao ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  await client.query('BEGIN');

  out('— ITEM 1: tenant ativo (Encanto) na sessao A — claim tenant_id correto —');
  await client.query(`INSERT INTO public.active_tenant (session_id, auth_user_id, store_id) VALUES ($1,$2,$3)`, [SESSION_A, USER_DUAL, ENCANTO]);
  await callHook('ITEM1', 'sessao A com active_tenant=Encanto -> claims.tenant_id=Encanto', evento(USER_DUAL, SESSION_A),
    (r, err) => ({ ok: err === null && r?.claims?.tenant_id === ENCANTO, detail: err || JSON.stringify(r?.claims) }));
  out('');

  out('— ITEM 2: sessao SEM active_tenant nenhum — claim AUSENTE —');
  await callHook('ITEM2', 'sessao sem nenhuma linha em active_tenant -> tenant_id nao aparece', evento(USER_DUAL, '33333333-3333-4333-8333-333333333333'),
    (r, err) => ({ ok: err === null && !Object.prototype.hasOwnProperty.call(r?.claims || {}, 'tenant_id'), detail: err || JSON.stringify(r?.claims) }));
  out('');

  out('— ITEM 3: claims SEM session_id — claim AUSENTE (nao explode) —');
  await callHook('ITEM3', 'claims sem session_id -> tenant_id nao aparece, sem erro', JSON.stringify({ user_id: USER_DUAL, claims: { sub: USER_DUAL, role: 'authenticated' }, authentication_method: 'password' }),
    (r, err) => ({ ok: err === null && !Object.prototype.hasOwnProperty.call(r?.claims || {}, 'tenant_id'), detail: err || JSON.stringify(r?.claims) }));
  out('');

  out('— ITEM 4: loja INATIVA com active_tenant apontando pra ela — claim AUSENTE (fail-closed) —');
  await client.query(`INSERT INTO public.stores (id, slug, nome, status) VALUES ($1,'loja-inativa-teste-onda3-prod','Loja Inativa (teste onda3)','suspenso')`, [LOJA_INATIVA]);
  await client.query(`INSERT INTO public.active_tenant (session_id, auth_user_id, store_id) VALUES ($1,$2,$3)`, [SESSION_B, USER_DUAL, LOJA_INATIVA]);
  await callHook('ITEM4', 'active_tenant aponta pra loja inativa -> tenant_id NAO emitido mesmo assim', evento(USER_DUAL, SESSION_B),
    (r, err) => ({ ok: err === null && !Object.prototype.hasOwnProperty.call(r?.claims || {}, 'tenant_id'), detail: err || JSON.stringify(r?.claims) }));
  out('');

  out('— ITEM 5: event malformado ({}) — nao explode, devolve algo coerente —');
  await callHook('ITEM5', 'event vazio -> sem excecao', '{}',
    (r, err) => ({ ok: err === null, detail: err || JSON.stringify(r) }));
  out('');

  out('— ITEM 6: DUAS sessoes REAIS e simultaneas da MESMA pessoa — claims INDEPENDENTES —');
  await client.query(`DELETE FROM public.active_tenant WHERE session_id = $1`, [SESSION_B]); // limpa a loja inativa do ITEM4
  await client.query(`INSERT INTO public.active_tenant (session_id, auth_user_id, store_id) VALUES ($1,$2,$3)`, [SESSION_B, USER_DUAL, BAR]);
  {
    const rA = await client.query(`SELECT public.custom_access_token_hook($1::jsonb) AS r`, [evento(USER_DUAL, SESSION_A)]);
    const rB = await client.query(`SELECT public.custom_access_token_hook($1::jsonb) AS r`, [evento(USER_DUAL, SESSION_B)]);
    const tA = rA.rows[0].r?.claims?.tenant_id, tB = rB.rows[0].r?.claims?.tenant_id;
    const ok = tA === ENCANTO && tB === BAR;
    record('ITEM6', 'sessao A -> tenant_id=Encanto, sessao B -> tenant_id=Bar, mesma pessoa, sem disputa', ok ? 'PASS' : 'FAIL', JSON.stringify({ tA, tB }));
  }
  out('');

  out('— ITEM 7: manipular customer_id/store_id/tenant_id nas claims de ENTRADA nao muda o resultado —');
  await callHook('ITEM7', 'claims de entrada com tenant_id/customer_id/store_id forjados sao IGNORADOS - resultado vem so de active_tenant', evento(USER_DUAL, SESSION_A, { tenant_id: BAR, customer_id: '99999999-9999-4999-8999-999999999999', store_id: BAR }),
    (r, err) => ({ ok: err === null && r?.claims?.tenant_id === ENCANTO, detail: err || JSON.stringify(r?.claims) }));
  out('');

  out('— ITEM 8: PII — resultado nunca ganha customer_id/telefone/email/endereco —');
  {
    const r = await client.query(`SELECT public.custom_access_token_hook($1::jsonb) AS r`, [evento(USER_DUAL, SESSION_A)]);
    const chaves = Object.keys(r.rows[0].r?.claims || {});
    const proibidas = ['customer_id', 'telefone', 'phone', 'email', 'endereco', 'address', 'name', 'nome'];
    const vazou = chaves.filter((k) => proibidas.includes(k));
    record('ITEM8', 'nenhuma chave de PII nas claims resultantes (so tenant_id foi adicionado)', vazou.length === 0 ? 'PASS' : 'FAIL', JSON.stringify({ chaves, vazou }));
  }
  out('');

  await client.query('ROLLBACK');

  out('— ITEM 9: GRANTS — anon/authenticated negados, supabase_auth_admin permitido —');
  {
    const r = await client.query(`
      SELECT string_agg(grantee, ',' ORDER BY grantee) AS grantees
      FROM information_schema.routine_privileges
      WHERE routine_schema='public' AND routine_name='custom_access_token_hook' AND privilege_type='EXECUTE'`);
    const grantees = r.rows[0]?.grantees || '';
    const ok = grantees.includes('supabase_auth_admin') && !grantees.includes('anon') && !grantees.includes('authenticated');
    record('ITEM9', 'EXECUTE so pra supabase_auth_admin/postgres/service_role', ok ? 'PASS' : 'FAIL', JSON.stringify({ grantees }));
  }
  out('');

  out('— ITEM 10: SECURITY DEFINER + search_path seguro —');
  {
    const r = await client.query(`
      SELECT p.prosecdef, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='custom_access_token_hook'`);
    const row = r.rows[0];
    const cfgOk = (row?.proconfig || []).join(';').includes('search_path=pg_catalog, public');
    const ok = row?.prosecdef === true && cfgOk;
    record('ITEM10', 'SECURITY DEFINER=true, search_path fixo', ok ? 'PASS' : 'FAIL', JSON.stringify(row));
  }
  out('');

  out('— REGRESSAO: active_tenant/stores sem residuo dos testes —');
  {
    const r = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.active_tenant WHERE session_id IN ($1,$2)) AS linhas_teste,
        (SELECT count(*)::int FROM public.stores WHERE id = $3) AS loja_teste`, [SESSION_A, SESSION_B, LOJA_INATIVA]);
    const row = r.rows[0];
    const ok = row.linhas_teste === 0 && row.loja_teste === 0;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] REGRESSAO zero residuo`); out(`         -> ${JSON.stringify(row)}`);
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
  console.log('ETAPA — TESTES DA FASE (REF-AUTH-TENANT-01 · Onda 3)');
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
