// Suite de verificacao da REF-SAAS-01 · Onda 6.3 (geocoding sem cidade fixa) — "Testes da fase".
// Escopo desta subfase e essencialmente FRONTEND (ja coberto por address.unit.mjs/address.guard.mjs/
// address-geocoding.golden.mjs, sem rede/banco) — o UNICO efeito em producao e um seed de dado
// idempotente em company_info.cidade/estado da Encanto (sem RPC/policy/schema novo). Esta suite prova:
// (1) o dado real da Encanto ficou correto (regressao); (2) a migration NUNCA sobrescreveria uma
// edicao real que o Admin ja tenha feito (idempotencia, testada em BEGIN...ROLLBACK).
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

const R = []; const out = (s = '') => R.push(s);
let passes = 0, failures = 0;
const startedMs = Date.now(), startedIso = isoUtc();
function record(id, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} ${desc}`); out(`         -> ${detail}`);
}

try {
  out('==================================================================');
  out(' SUITE — REF-SAAS-01 · Onda 6.3 (geocoding sem cidade fixa) — RELATORIO');
  out('==================================================================');
  out('Camada A: leitura direta (regressao). Camada B: idempotencia simulada em BEGIN...ROLLBACK (mutacao liquida = 0).');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessao ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  out('— A1: company_info.cidade/estado da Encanto ficaram semeados corretamente (regressao real) —');
  {
    const r = await client.query(`SELECT public.get_company_info()->>'cidade' AS cidade, public.get_company_info()->>'estado' AS estado`);
    const ok = r.rows[0].cidade === 'Timbó' && r.rows[0].estado === 'SC';
    record('A1', 'cidade=Timbó, estado=SC', ok ? 'PASS' : 'FAIL', JSON.stringify(r.rows[0]));
  }
  out('');

  out('— A2: as chaves cidade/estado moram em store_settings (por loja), não em settings (global) —');
  {
    const storeSettings = await client.query(`SELECT valor::jsonb ? 'cidade' AS tem_cidade FROM public.store_settings WHERE chave='company_info' AND store_id=(SELECT id FROM public.stores WHERE slug='encanto')`);
    const settingsGlobal = await client.query(`SELECT count(*)::int AS n FROM public.settings WHERE chave='company_info'`);
    const ok = storeSettings.rows[0]?.tem_cidade === true && settingsGlobal.rows[0].n === 0;
    record('A2', 'cidade em store_settings; settings global sem company_info', ok ? 'PASS' : 'FAIL', JSON.stringify({ storeSettings: storeSettings.rows[0], settingsGlobal: settingsGlobal.rows[0] }));
  }
  out('');

  out('— B1 (idempotência, BEGIN...ROLLBACK): re-rodar a migration NUNCA sobrescreve uma edição real do Admin —');
  try {
    await client.query('BEGIN');
    // Simula: Admin já editou a cidade institucional para outro valor (cenário real após a Onda 6.3 ir ao ar).
    await client.query(`
      UPDATE public.store_settings SET valor = (valor::jsonb || '{"cidade":"Blumenau","estado":"SC"}'::jsonb)::text
      WHERE store_id = (SELECT id FROM public.stores WHERE slug = 'encanto') AND chave = 'company_info'`);
    // Re-roda EXATAMENTE a mesma UPDATE da migration desta subfase.
    await client.query(`
      UPDATE public.store_settings
      SET valor = (valor::jsonb || jsonb_build_object('cidade', 'Timbó', 'estado', 'SC'))::text
      WHERE store_id = (SELECT id FROM public.stores WHERE slug = 'encanto')
        AND chave = 'company_info'
        AND NOT (COALESCE(valor::jsonb->>'cidade', '') <> '' OR COALESCE(valor::jsonb->>'estado', '') <> '')`);
    const r = await client.query(`SELECT valor::jsonb->>'cidade' AS cidade FROM public.store_settings WHERE store_id=(SELECT id FROM public.stores WHERE slug='encanto') AND chave='company_info'`);
    const ok = r.rows[0]?.cidade === 'Blumenau'; // NÃO deveria ter voltado para 'Timbó'
    record('B1', 'edição real do Admin (Blumenau) preservada — migration não sobrescreve', ok ? 'PASS' : 'FAIL', 'cidade=' + r.rows[0]?.cidade);
  } finally { await client.query('ROLLBACK').catch(() => {}); }
  out('');

  out('— REGRESSAO-01: após a suite, o company_info real de encanto continua exatamente o mesmo —');
  {
    const r = await client.query(`SELECT public.get_company_info()->>'cidade' AS cidade, public.get_company_info()->>'estado' AS estado`);
    const ok = r.rows[0].cidade === 'Timbó' && r.rows[0].estado === 'SC';
    record('REGRESSAO-01', 'cidade/estado de encanto inalterados', ok ? 'PASS' : 'FAIL', JSON.stringify(r.rows[0]));
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
  console.log('ETAPA — TESTES DA FASE (REF-SAAS-01 · Onda 6.3)');
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
