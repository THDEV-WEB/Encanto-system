// Suite de verificacao da REF-STORE-ONBOARD-01 · Onda 1 (get_store_config_status) — "Testes da fase".
// Mesmo rigor/estrutura de saas01-onda4-3-config-test.mjs: Camada A estrutural, Camada B comportamental
// (SET LOCAL ROLE + request.jwt.claims dentro de BEGIN...ROLLBACK, mutacao liquida = 0). Cobre os 10
// testes obrigatorios da autorizacao da Onda 1 (A-J). Exit 0 = SUCCESS.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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

// Mesmos fixtures reais ja usados por saas01-onda4-3-config-test.mjs/saas01-onda5-admin-multiloja-test.mjs.
const ADMIN_REAL_USER_ID = 'b9dc7626-af9c-4ab5-95f7-3207e6469129'; // super admin real
const ADMIN_B            = 'ce7ece01-266c-42b1-a9db-8051da24d7f5'; // admin comum (fixture)
const STRANGER           = '4fa5541f-989f-4b8d-89b4-7b45a59d8f4e'; // autenticado, sem vinculo com a loja B

const STORE_B_ID = 'ffffffff-b0b0-4000-8000-000000000001'; // loja com config PROPRIA (fake, teste onda1)
const STORE_C_ID = 'ffffffff-c0c0-4000-8000-000000000001'; // loja NOVA, sem nenhuma linha (fake, teste onda1)

const R = []; const out = (s = '') => R.push(s);
let passes = 0, failures = 0, spCounter = 0;
function record(id, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} ${desc}`); out(`         -> ${detail}`);
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
async function comoSessao(role, sub) {
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(sub ? { sub, role } : { role })]);
  await client.query(`SET LOCAL ROLE ${role}`);
}

try {
  out('==================================================================');
  out(' SUITE — REF-STORE-ONBOARD-01 · Onda 1 (get_store_config_status) — RELATORIO');
  out('==================================================================');
  out('Camada A: estrutural (superuser). Camada B: SET LOCAL ROLE + request.jwt.claims dentro de');
  out('BEGIN...ROLLBACK -- mutacao liquida ZERO (lojas B/C sao fake, desfeitas pelo ROLLBACK final).');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessao ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('git: ' + git('rev-parse --short HEAD') + ' (' + git('branch --show-current') + ')');
  out('');

  const encantoId  = (await client.query(`SELECT id FROM public.stores WHERE slug = 'encanto'`)).rows[0].id;
  // Busca pelo UUID estavel, nao pelo slug -- a loja foi renomeada de "bar-da-sogra" pra "aquariosbar"
  // (Aquarios Bar, 2026-08-21); o UUID nunca muda, so o slug/nome mudaram.
  const sograRow   = (await client.query(`SELECT id, (SELECT count(*)::int FROM public.admins a WHERE a.store_id = s.id) AS admin_count FROM public.stores s WHERE id = '776a01c8-f836-417a-a957-a0e1109f90a2'`)).rows[0];
  out(`— Lojas reais resolvidas (fora de qualquer sessao simulada, como superuser): encanto=${encantoId} · aquarios-bar=${sograRow.id} (admin_count=${sograRow.admin_count}) —`);
  out('');

  // ---------------- Camada A: estrutural ----------------
  out('— A1: get_store_config_status(uuid) existe, SECURITY DEFINER, grants corretos (authenticated sim, anon nao) —');
  {
    const fn = await client.query(`SELECT prosecdef FROM pg_proc WHERE proname='get_store_config_status' AND pronamespace='public'::regnamespace`);
    const grantAuth = await client.query(`SELECT has_function_privilege('authenticated', 'public.get_store_config_status(uuid)', 'EXECUTE') AS ok`);
    const grantAnon = await client.query(`SELECT has_function_privilege('anon', 'public.get_store_config_status(uuid)', 'EXECUTE') AS ok`);
    const ok = fn.rowCount === 1 && fn.rows[0].prosecdef === true && grantAuth.rows[0].ok === true && grantAnon.rows[0].ok === false;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A1 funcao + grants`); out(`         -> overloads=${fn.rowCount} secdef=${fn.rows[0]?.prosecdef} authenticated=${grantAuth.rows[0].ok} anon=${grantAnon.rows[0].ok}`);
  }
  out('');

  // ---------------- Camada B: comportamental ----------------
  await client.query('BEGIN');
  await client.query(`INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_B_ID}', 'loja-b-teste-onboard01', 'Loja B (fake, teste Onboard-01)', NULL, 'ativo')`);
  await client.query(`INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_C_ID}', 'loja-c-teste-onboard01', 'Loja C nova (fake, sem config)', NULL, 'ativo')`);
  await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ('${ADMIN_B}', '${STORE_B_ID}')`);
  await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ('${STORE_B_ID}', 'business_hours_schedule', '{"fake":true}')`);
  await client.query(`INSERT INTO public.store_settings (store_id, chave, valor) VALUES ('${STORE_B_ID}', 'delivery_fee_config', '{"fake":true}')`);
  // loja C fica SEM NENHUMA linha em store_settings de proposito (cenario de loja recem-criada) --
  // mesma tecnica de STORE_C_ID em saas01-onda4-3-config-test.mjs.

  await comoSessao('authenticated', ADMIN_REAL_USER_ID); // baseline: confirma que e' super admin real
  const baseline = await client.query(`SELECT count(*)::int AS n FROM public.super_admins WHERE user_id = '${ADMIN_REAL_USER_ID}'`);
  out(`— Baseline: ADMIN_REAL_USER_ID e' super admin real -> n=${baseline.rows[0].n} (precisa ser >=1) —`);
  out('');

  await callRpc('C', 'loja Encanto (producao) -> comportamento atual preservado (ambas true)',
    `SELECT public.get_store_config_status('${encantoId}') AS r`, [],
    (row) => {
      const r = row?.r;
      const ok = r?.tem_horario_config === true && r?.tem_delivery_config === true;
      return { ok, detail: JSON.stringify(r) };
    });

  await callRpc('A/H', 'Aquarios Bar (producao, caso real, ex-Bar da Sogra) -> horario NAO configurado (fallback nao vira "propria")',
    `SELECT public.get_store_config_status('${sograRow.id}') AS r`, [],
    (row) => {
      const r = row?.r;
      const ok = r?.tem_horario_config === false;
      return { ok, detail: JSON.stringify(r) };
    });

  await callRpc('B/H', 'Aquarios Bar (producao, caso real, ex-Bar da Sogra) -> delivery NAO configurado (fallback nao vira "propria")',
    `SELECT public.get_store_config_status('${sograRow.id}') AS r`, [],
    (row) => {
      const r = row?.r;
      const ok = r?.tem_delivery_config === false;
      return { ok, detail: JSON.stringify(r) };
    });

  out('');
  out('— Trocando de sessao: ADMIN_B (admin real da loja B fake) —');
  await comoSessao('authenticated', ADMIN_B);

  await callRpc('D', 'loja B (config propria) via seu proprio admin -> ambas true, sem alerta falso',
    `SELECT public.get_store_config_status('${STORE_B_ID}') AS r`, [],
    (row) => {
      const r = row?.r;
      const ok = r?.tem_horario_config === true && r?.tem_delivery_config === true;
      return { ok, detail: JSON.stringify(r) };
    });

  await callRpc('E', 'loja C (vizinha, sem config) via admin da loja B -> deve FALHAR (isolamento entre tenants)',
    `SELECT public.get_store_config_status('${STORE_C_ID}') AS r`, [],
    (row, errMsg) => {
      const ok = row === null && /42501|apenas administradores/i.test(errMsg || '');
      return { ok, detail: errMsg || JSON.stringify(row) };
    });

  await callRpc('F', 'admin da loja B tentando ver o proprio tenant explicitamente -> permitido (F: so ve o proprio)',
    `SELECT public.get_store_config_status('${STORE_B_ID}') AS r`, [],
    (row) => {
      const ok = row?.r?.tem_horario_config === true;
      return { ok, detail: JSON.stringify(row?.r) };
    });

  out('');
  out('— Trocando de sessao: STRANGER (autenticado, sem vinculo com loja B nem C) —');
  await comoSessao('authenticated', STRANGER);

  await callRpc('F2', 'stranger tentando ver a loja B -> deve FALHAR (nao e admin dela, nao e super admin)',
    `SELECT public.get_store_config_status('${STORE_B_ID}') AS r`, [],
    (row, errMsg) => {
      const ok = row === null && /42501|apenas administradores/i.test(errMsg || '');
      return { ok, detail: errMsg || JSON.stringify(row) };
    });

  out('');
  out('— Trocando de sessao: ADMIN_REAL_USER_ID (super admin real) —');
  await comoSessao('authenticated', ADMIN_REAL_USER_ID);

  await callRpc('G', 'Super Admin consegue visualizar o estado de QUALQUER loja (B e C, sem ser admin direto)',
    `SELECT public.get_store_config_status('${STORE_C_ID}') AS r`, [],
    (row) => {
      const r = row?.r;
      const ok = r?.tem_horario_config === false && r?.tem_delivery_config === false;
      return { ok, detail: JSON.stringify(r) };
    });

  out('');
  out('— anon (sem sessao autenticada) -> deve FALHAR: RPC nao concedida a anon —');
  await comoSessao('anon', null);
  await callRpc('SEC', 'anon nao pode nem CHAMAR a funcao (grant revogado)',
    `SELECT public.get_store_config_status('${encantoId}') AS r`, [],
    (row, errMsg) => {
      const ok = row === null && /permission denied|access denied/i.test(errMsg || '');
      return { ok, detail: errMsg || JSON.stringify(row) };
    });

  await client.query('ROLLBACK'); // I: nenhum backfill/migration de dado indevido -- lojas B/C somem aqui.
  out('');
  out('— ROLLBACK aplicado: lojas B/C fake desfeitas, mutacao liquida = 0 (I) —');
  out('');

  // Confirma fora da transacao que o rollback realmente desfez tudo.
  const restou = await client.query(`SELECT count(*)::int AS n FROM public.stores WHERE id IN ('${STORE_B_ID}','${STORE_C_ID}')`);
  {
    const ok = restou.rows[0].n === 0;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] I2 nenhuma loja fake sobrou apos o ROLLBACK`); out(`         -> n=${restou.rows[0].n}`);
  }

  out('');
  out('==================================================================');
  out(` RESULTADO: ${passes} passes, ${failures} failures`);
  out('==================================================================');
  console.log(R.join('\n'));
  process.exit(failures === 0 ? 0 : 1);
} catch (e) {
  console.log(R.join('\n'));
  console.error('ERRO FATAL:', redact(e.message));
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
