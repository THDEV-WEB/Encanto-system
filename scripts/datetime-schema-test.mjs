// Suite de verificacao do pipeline de data/hora (REF-DATETIME-01) — "Testes da fase".
// Mesmo molde de address-schema-test.mjs: conecta no banco via db.env, SOMENTE LEITURA nesta
// fase (nenhum BEGIN/ROLLBACK necessario — nao ha escrita a proteger).
//
// Fase 1 (orders_health-fix): prova que orders_health() para de cortar o dia na fronteira UTC
// e volta a concordar com admin_orders_stats() (que ja fazia a conversao certa).
// Fase 2a (schema-timestamptz), quando aplicada: este arquivo ganha os checks de tipo de coluna
// + grants de admin_orders_search + dia_loja() — ver comentario ao final.
// Exit 0 = SUCCESS; exit 1 = FAILED.
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
function record(id, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} ${desc}`); out(`         -> ${detail}`);
}

try {
  out('==================================================================');
  out(' SUITE DE DATA/HORA — REF-DATETIME-01 — RELATORIO');
  out('==================================================================');
  out('Somente leitura (SELECT). Nenhuma escrita.');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, current_setting('TIMEZONE') AS tz, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessao ' + meta.who + ' · TIMEZONE=' + meta.tz + ' · ' + meta.utc + ' UTC');
  out('');

  out('— Pre-requisito: orders_health() ja tem o fix aplicado (REF-DATETIME-01-orders-health-fix.sql) —');
  {
    const src = (await client.query(`SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='orders_health'`)).rows[0]?.def || '';
    const semCurrentDate = !src.includes('current_date');
    const comFuso = src.includes("America/Sao_Paulo");
    const ok = semCurrentDate && comFuso;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] DT1 orders_health() usa AT TIME ZONE, nao current_date cru`);
    out(`         -> sem 'current_date': ${semCurrentDate} · com 'America/Sao_Paulo': ${comFuso}`);
    if (!ok) { throw new Error('Migration REF-DATETIME-01-orders-health-fix.sql ainda nao foi aplicada — abortando o restante da suite.'); }
  }
  out('');

  out('— orders_health() concorda com admin_orders_stats() no "hoje" (mesmo instante de consulta) —');
  {
    const r = (await client.query(`SELECT public.orders_health() AS h, public.admin_orders_stats() AS s`)).rows[0];
    const h = r.h, s = r.s;
    const pedidosOk = Number(h.pedidos_hoje) === Number(s.hoje_count);
    const fatOk = Number(h.faturamento_hoje) === Number(s.hoje_total);
    const ok = pedidosOk && fatOk;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] DT2 pedidos_hoje/faturamento_hoje == hoje_count/hoje_total`);
    out(`         -> orders_health: pedidos_hoje=${h.pedidos_hoje} faturamento_hoje=${h.faturamento_hoje} | admin_orders_stats: hoje_count=${s.hoje_count} hoje_total=${s.hoje_total}`);
  }
  out('');

  out('— serie_7d/serie_30d de orders_health() tem o numero certo de dias e nao usa current_date —');
  {
    const r = (await client.query(`SELECT public.orders_health() AS h`)).rows[0].h;
    const ok = Array.isArray(r.serie_7d) && r.serie_7d.length === 7 && Array.isArray(r.serie_30d) && r.serie_30d.length === 30;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] DT3 serie_7d.length=${r.serie_7d?.length} (esperado 7) · serie_30d.length=${r.serie_30d?.length} (esperado 30)`);
    out(`         -> serie_7d: ${JSON.stringify(r.serie_7d)}`);
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
  console.log('ETAPA — TESTES DA FASE (REF-DATETIME-01)');
  console.log('STATE: ' + state + ' · PASS=' + passes + ' FAIL=' + failures);
  console.log('NO WRITES (read-only)');
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

// Fase 2a (REF-DATETIME-01b-schema-timestamptz) vai ADICIONAR aqui, sem remover o que existe:
//  - checks de information_schema.columns confirmando timestamptz nas 9 colunas migradas;
//  - checks de information_schema.routine_privileges em admin_orders_search comparados ao
//    baseline capturado na auditoria (PUBLIC/anon/authenticated, alem de postgres/service_role);
//  - um check de dia_loja() com instante perto da meia-noite UTC.
