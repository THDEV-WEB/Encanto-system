// Suite do gazetteer local (REF-ADDRESS-02 · Onda 4) — "Testes da fase".
// Mesmo molde de address-schema-test.mjs/harden-orders-rls-test.mjs: SET LOCAL ROLE anon/authenticated
// em BEGIN..ROLLBACK (net-zero, nenhuma escrita persiste — exceto onde a própria migration já fez o
// seed, que é lido, nunca alterado por este teste). Prova:
//  - pg_trgm instalada; immutable_unaccent existe e é IMMUTABLE de verdade;
//  - address_gazetteer com o seed inicial (>=4 linhas);
//  - anon consegue LER via policy pública (RLS) e EXECUTAR buscar_gazetteer;
//  - anon NÃO consegue escrever direto na tabela (só authenticated, via policy);
//  - buscar_gazetteer acha "Rua João Schlei" a partir de "Rua Joao Schlay" (o achado real da Onda 0,
//    agora resolvido por camada própria, sem depender do Photon).
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

async function tx(role, fn) {
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    return await fn();
  } finally { await client.query('ROLLBACK').catch(() => {}); }
}
function record(id, role, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} <${role}> ${desc}`); out(`         -> ${detail}`);
}
async function expectDeniedGrant(id, role, desc, sql) {
  let verdict = 'FAIL', detail = '';
  await tx(role, async () => {
    try { await client.query(sql); detail = 'NAO foi negado (esperava 42501 ou RLS bloqueando)'; verdict = 'FAIL'; }
    catch (e) { if (e.code === '42501') { verdict = 'PASS'; detail = 'permission denied (42501): ' + redact(e.message).split('\n')[0]; }
      else { verdict = 'FAIL'; detail = `negado por outro motivo (esperava 42501): code=${e.code} ${redact(e.message).split('\n')[0]}`; } }
  });
  record(id, role, desc, verdict, detail);
}

try {
  out('==================================================================');
  out(' SUITE DO GAZETTEER LOCAL — REF-ADDRESS-02 · Onda 4 — RELATORIO');
  out('==================================================================');
  out('SET LOCAL ROLE anon/authenticated em BEGIN..ROLLBACK. Nenhuma escrita persiste.');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessão ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  out('— Pré-requisito: pg_trgm instalada + immutable_unaccent IMMUTABLE + tabela/seed existem —');
  {
    const ext = await client.query(`SELECT 1 FROM pg_extension WHERE extname='pg_trgm'`);
    const fn = await client.query(`SELECT provolatile FROM pg_proc WHERE proname='immutable_unaccent'`);
    const cnt = await client.query(`SELECT count(*) AS n FROM public.address_gazetteer`).catch(() => ({ rows: [{ n: -1 }] }));
    const ok = ext.rowCount === 1 && fn.rows[0]?.provolatile === 'i' && Number(cnt.rows[0]?.n) >= 4;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] SC1 pg_trgm=${ext.rowCount === 1} immutable_unaccent.provolatile=${fn.rows[0]?.provolatile} seed=${cnt.rows[0]?.n} linha(s)`);
    if (!ok) throw new Error('Migration Onda 4 não aplicada (ou seed ausente) — abortando o restante da suíte.');
  }
  out('');

  out('— ANON · leitura pública da tabela (policy nova) DEVE funcionar —');
  {
    let v = 'FAIL', d = '';
    await tx('anon', async () => {
      const r = await client.query(`SELECT cidade, tipo, nome FROM public.address_gazetteer LIMIT 5`);
      v = r.rowCount >= 1 ? 'PASS' : 'FAIL'; d = `SELECT via policy pública (${r.rowCount} linha(s))`;
    });
    record('GA1', 'anon', 'SELECT address_gazetteer (leitura pública)', v, d);
  }
  out('');

  out('— ANON · escrita DIRETA na tabela DEVE ser negada (só authenticated escreve) —');
  await expectDeniedGrant('GA2', 'anon', 'INSERT address_gazetteer direto', `INSERT INTO public.address_gazetteer(cidade,tipo,nome) VALUES ('Teste','bairro','X')`);
  out('');

  out('— ANON · buscar_gazetteer (RPC) DEVE funcionar e achar "Rua João Schlei" a partir do erro de grafia real —');
  {
    let v = 'FAIL', d = '';
    await tx('anon', async () => {
      const r = await client.query(`SELECT * FROM public.buscar_gazetteer('Rua Joao Schlay', 'Timbó', 3)`);
      const achou = r.rows.some((row) => row.nome === 'Rua João Schlei');
      v = achou ? 'PASS' : 'FAIL';
      d = achou ? `achou entre ${r.rowCount} candidato(s): ${r.rows.map((x) => `${x.nome}(${Number(x.similaridade).toFixed(2)})`).join(', ')}` : `NÃO achou — candidatos: ${JSON.stringify(r.rows)}`;
    });
    record('GA3', 'anon', 'buscar_gazetteer("Rua Joao Schlay") -> "Rua João Schlei"', v, d);
  }
  out('');

  out('— buscar_gazetteer: query sem match nenhum devolve 0 linhas, nunca lança —');
  {
    let v = 'FAIL', d = '';
    await tx('anon', async () => {
      const r = await client.query(`SELECT * FROM public.buscar_gazetteer('xyzxyzxyz123', 'Timbó', 3)`);
      v = r.rowCount === 0 ? 'PASS' : 'FAIL'; d = `${r.rowCount} linha(s) (esperado 0)`;
    });
    record('GA4', 'anon', 'buscar_gazetteer sem match -> 0 linhas', v, d);
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
  console.log('ETAPA — TESTES DA FASE (REF-ADDRESS-02 · Onda 4)');
  console.log('STATE: ' + state + ' · PASS=' + passes + ' FAIL=' + failures);
  console.log('NO PERSISTED WRITES (além do seed já aplicado pela migration)');
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
