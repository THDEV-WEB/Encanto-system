// Suite de RLS (NORM-06.1 / HARDEN-RLS) — Etapa "Testes da fase".
// Testa as policies via SET LOCAL ROLE anon/authenticated (RLS aplica; postgres -> role não-superuser).
// CADA teste roda em BEGIN ... ROLLBACK: nenhuma escrita persiste — mutação líquida = 0 (contagens antes/depois).
// Cobre: anon LÊ catálogo (incl. indisponíveis — D1) / anon NÃO escreve catálogo (42501) /
//        authenticated ESCREVE catálogo / authenticated CONTINUA bloqueado pelas triggers STI (F1B) /
//        checkout (customers) intacto para anon.
// Emite RELATÓRIO REPRODUZÍVEL + AUTOAUDITÁVEL. Exit 0 = SUCCESS; exit 1 = FAILED.
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
const SCRIPT_NAME = 'test:rls';

const envGet = (txt, k) => { const m = txt.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
function loadConn() {
  let txt; try { txt = readFileSync(ENV_PATH, 'utf8'); } catch { console.error('ERRO: db.env nao encontrado'); process.exit(2); }
  const host = envGet(txt, 'PGHOST'); const user = envGet(txt, 'PGUSER'); const url = envGet(txt, 'SUPABASE_DB_URL');
  if (host) { const password = envGet(txt, 'PGPASSWORD'); if (!password) { console.error('ERRO: PGPASSWORD vazio'); process.exit(2); } return { cfg: { host, port: Number(envGet(txt, 'PGPORT') || 5432), user, password, database: envGet(txt, 'PGDATABASE') || 'postgres' }, secret: password, host, user }; }
  if (url) return { cfg: { connectionString: url }, secret: url, host: url, user };
  console.error('ERRO: defina credenciais em db.env'); process.exit(2);
}
function projectRef(host, user) {
  let m = (user || '').match(/postgres\.([a-z0-9]{16,})/i); if (m) return m[1];
  m = (host || '').match(/(?:^|\.)([a-z0-9]{16,})\.supabase\./i); if (m) return m[1];
  return '(n/d)';
}
const git = (a) => { try { return execSync('git ' + a, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return '(n/d)'; } };
const isoUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const { cfg, secret, host, user } = loadConn();
const redact = s => { let r = String(s); if (secret) r = r.split(secret).join('[REDACTED]'); return r; };
const client = new pg.Client({ ...cfg, ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

const R = []; const out = (s = '') => R.push(s);
let passes = 0, failures = 0;
const startedMs = Date.now(), startedIso = isoUtc();

const TCOLL = "__rls_tcoll", TCOLL_SLUG = "__rls-tcoll";
const TBIZ = "__rls_tbiz", TBIZ_SLUG = "__rls-tbiz";
const mkColl = `INSERT INTO public.categories(id,nome,slug,tipo,estrategia,ordem,ativo) VALUES('${TCOLL}','RLS TEST COLL','${TCOLL_SLUG}','collection','manual',999,true)`;
const mkBiz = `INSERT INTO public.categories(id,nome,slug,tipo,ordem,ativo) VALUES('${TBIZ}','RLS TEST BIZ','${TBIZ_SLUG}','business',999,true)`;

async function counts() {
  const q = await client.query(`SELECT
    (SELECT count(*) FROM public.categories) AS categories,
    (SELECT count(*) FROM public.products) AS products,
    (SELECT count(*) FROM public.adicionais) AS adicionais,
    (SELECT count(*) FROM public.product_collections) AS product_collections,
    (SELECT count(*) FROM public.customers) AS customers`);
  return q.rows[0];
}
// Executa fn dentro de BEGIN; SET LOCAL ROLE <role>; ... ROLLBACK.
async function tx(role, fn) {
  try { await client.query('BEGIN'); await client.query(`SET LOCAL ROLE ${role}`); return await fn(); }
  finally { await client.query('ROLLBACK').catch(() => {}); }
}
function record(id, role, kind, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} <${role}> ${desc}`);
  out(`         -> ${detail}`);
}
// Espera SUCESSO de todas as instruções.
async function expectAllowed(id, role, desc, stmts) {
  let verdict = 'PASS', detail = 'permitido';
  await tx(role, async () => {
    for (const s of stmts) {
      try { await client.query(s); }
      catch (e) { verdict = 'FAIL'; detail = `NEGADO/erro inesperado: code=${e.code} ${redact(e.message).split('\n')[0]}`; break; }
    }
  });
  record(id, role, 'allow', desc, verdict, detail);
}
// Espera REJEIÇÃO; kind='RLS' -> 42501; kind='STI' -> 23514 + assinatura STI Ix.
async function expectDenied(id, role, kind, desc, setups, target) {
  const exp = (id.match(/I[1-4]/) || [])[0];
  let verdict = 'FAIL', detail = '';
  await tx(role, async () => {
    for (const s of setups) {
      try { await client.query(s); } catch (e) { detail = 'setup falhou: ' + redact(e.message).split('\n')[0]; verdict = 'FAIL'; return; }
    }
    try {
      await client.query(target);
      detail = `NAO foi negado (esperava ${kind})`; verdict = 'FAIL';
    } catch (e) {
      const msg = redact(e.message || '');
      if (kind === 'RLS' && e.code === '42501') { verdict = 'PASS'; detail = 'RLS negou (42501): ' + msg.split('\n')[0]; }
      else if (kind === 'STI' && new RegExp('STI ' + (exp || 'I[1-4]') + ':').test(msg)) { verdict = 'PASS'; detail = msg.split('\n')[0]; }
      else { verdict = 'FAIL'; detail = `negado por motivo INESPERADO (esperava ${kind}${exp ? '/' + exp : ''}): code=${e.code} ${msg.split('\n')[0]}`; }
    }
  });
  record(id, role, kind, desc, verdict, detail);
}

try {
  out('==================================================================');
  out(' SUITE DE RLS — NORM-06.1 / HARDEN-RLS — RELATORIO');
  out('==================================================================');
  out('Testes via SET LOCAL ROLE anon/authenticated em BEGIN..ROLLBACK. Nenhuma escrita persiste.');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, current_database() AS db, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint —');
  out('  Project ID : ' + projectRef(host, user) + ' · db ' + meta.db + ' · sessão como ' + meta.who);
  out('  Timestamp  : ' + meta.utc + ' (UTC)');
  out('');

  const before = await counts();
  const base = (await client.query("SELECT count(*) AS total, count(*) FILTER (WHERE disponivel=false) AS indispon FROM public.products")).rows[0];
  const pid = (await client.query("SELECT id FROM public.products ORDER BY id LIMIT 1")).rows[0]?.id;
  out('— Baseline (postgres, bypassa RLS) —');
  out('  products total=' + base.total + ' · indisponíveis=' + base.indispon + ' · product de apoio=' + (pid || '(n/d)'));
  out('');

  // ── ANON: leitura ──
  out('— ANON · leitura (D1: anon vê tudo, incl. indisponíveis) —');
  let anonRead = '';
  await tx('anon', async () => {
    const r = (await client.query("SELECT count(*) AS total, count(*) FILTER (WHERE disponivel=false) AS indispon FROM public.products")).rows[0];
    const ok = String(r.total) === String(base.total) && String(r.indispon) === String(base.indispon) && Number(r.indispon) > 0;
    if (ok) { passes++; anonRead = `anon lê ${r.total} produtos (== baseline), incl. ${r.indispon} indisponíveis -> D1 preservada`; out(`  [PASS] AR1·D1 <anon> lê products incl. indisponíveis`); }
    else { failures++; anonRead = `anon vê total=${r.total} indispon=${r.indispon} (esperado ${base.total}/${base.indispon})`; out(`  [FAIL] AR1·D1 <anon> leitura filtrada inesperada`); }
    out('         -> ' + anonRead);
  });
  await expectAllowed('AR2', 'anon', 'lê categories/adicionais/product_collections',
    ['SELECT 1 FROM public.categories LIMIT 1', 'SELECT 1 FROM public.adicionais LIMIT 1', 'SELECT count(*) FROM public.product_collections']);
  out('');

  // ── ANON: escrita negada (42501) ──
  out('— ANON · escrita no catálogo DEVE ser negada (RLS 42501) —');
  await expectDenied('AW1', 'anon', 'RLS', 'INSERT categories', [],
    `INSERT INTO public.categories(id,nome,slug,tipo,ordem,ativo) VALUES('__rls_x','RLS X','__rls-x','business',999,true)`);
  // AW2: UPDATE sem policy sob RLS = no-op silencioso (0 linhas), NÃO 42501 — negação se manifesta como rowCount=0.
  await (async () => {
    let v = 'FAIL', d = '';
    await tx('anon', async () => {
      const r = await client.query(`UPDATE public.products SET disponivel=disponivel WHERE id='${pid}'`);
      v = (r.rowCount === 0) ? 'PASS' : 'FAIL';
      d = `UPDATE afetou ${r.rowCount} linha(s) — RLS filtra anon (0 = negado; produto não modificado)`;
    });
    record('AW2', 'anon', 'RLS_FILTER', 'UPDATE products (disponivel) → 0 linhas', v, d);
  })();
  await expectDenied('AW3', 'anon', 'RLS', 'INSERT adicionais (aplica=NULL)', [],
    `INSERT INTO public.adicionais(nome,grupo,aplica_categoria_id) VALUES('__RLS_X','simples',NULL)`);
  out('');

  // ── AUTHENTICATED: leitura + escrita permitidas ──
  out('— AUTHENTICATED · lê e ESCREVE o catálogo (corrige bug categories/adicionais) —');
  await expectAllowed('BR1', 'authenticated', 'lê products', ['SELECT count(*) FROM public.products']);
  await expectAllowed('BW1', 'authenticated', 'INSERT + UPDATE categories', [
    `INSERT INTO public.categories(id,nome,slug,tipo,ordem,ativo) VALUES('__rls_c','RLS C','__rls-c','business',999,true)`,
    `UPDATE public.categories SET descricao='x' WHERE id='__rls_c'`]);
  await expectAllowed('BW2', 'authenticated', 'INSERT adicionais', [
    `INSERT INTO public.adicionais(nome,grupo,aplica_categoria_id) VALUES('__RLS_C','simples','c3')`]);
  await expectAllowed('BW3', 'authenticated', 'INSERT product_collections (membro válido)', [
    mkColl, `INSERT INTO public.product_collections(product_id,collection_id) VALUES('${pid}','${TCOLL}')`]);
  await expectAllowed('BW4', 'authenticated', 'UPDATE products (disponivel) — já funcionava', [
    `UPDATE public.products SET disponivel=disponivel WHERE id='${pid}'`]);
  out('');

  // ── AUTHENTICATED: NÃO burla as triggers STI (F1B) — o teste pedido ──
  out('— AUTHENTICATED · escrita liberada por RLS NÃO burla as triggers STI (F1B) —');
  await expectDenied('CS1·I1', 'authenticated', 'STI', 'INSERT pc collection_id=business (temp)', [mkBiz],
    `INSERT INTO public.product_collections(product_id,collection_id) VALUES('${pid}','${TBIZ}')`);
  await expectDenied('CS2·I2', 'authenticated', 'STI', 'UPDATE product.categoria_id=collection', [mkColl],
    `UPDATE public.products SET categoria_id='${TCOLL}' WHERE id='${pid}'`);
  await expectDenied('CS3·I3', 'authenticated', 'STI', 'INSERT adicional.aplica_categoria_id=collection', [mkColl],
    `INSERT INTO public.adicionais(nome,grupo,aplica_categoria_id) VALUES('__RLS_STI','simples','${TCOLL}')`);
  await expectDenied('CS4·I4', 'authenticated', 'STI', 'business->collection com produto (temp, hermético)',
    [mkBiz, `INSERT INTO public.products(nome,categoria_id) VALUES('__rls_p_cs4','${TBIZ}')`],
    `UPDATE public.categories SET tipo='collection', estrategia='manual' WHERE id='${TBIZ}'`);
  out('');

  // ── CHECKOUT (anon) intacto ──
  out('— CHECKOUT · anon ainda escreve customers (path do pedido intacto — D2) —');
  let ckVerdict = 'FAIL', ckDetail = '';
  await tx('anon', async () => {
    try { const r = await client.query(`INSERT INTO public.customers(name,phone) VALUES('__rls_test','000000000')`); ckVerdict = 'PASS'; ckDetail = `anon INSERT customers OK (${r.rowCount} linha) — checkout intacto`; }
    catch (e) { ckVerdict = 'FAIL'; ckDetail = (e.code === '42501' ? 'RLS BLOQUEOU o checkout (42501)!' : 'ERRO no checkout: code=' + e.code + ' ' + redact(e.message).split('\n')[0]); }
  });
  record('CK1', 'anon', 'allow', 'INSERT customers (checkout)', ckVerdict, ckDetail);
  out('');

  // ── Net-zero ──
  const after = await counts();
  out('— Mutação líquida (antes == depois) —');
  let drift = 0;
  for (const k of Object.keys(before)) { const eq = String(before[k]) === String(after[k]); if (!eq) drift++; out(`  ${k.padEnd(20)} : ${before[k]} -> ${after[k]} ${eq ? 'OK' : '<<< DRIFT'}`); }
  if (drift) { failures++; out('  [FALHA] mutação líquida detectada.'); } else out('  Net DB change: 0.');
  out('');

  out('— Resumo —');
  out('  PASS: ' + passes + '  ·  FAIL: ' + failures);
  out('');
  out('— Execution Fingerprint —');
  out('  Commit SHA : ' + git('rev-parse HEAD') + ' · Branch ' + git('rev-parse --abbrev-ref HEAD'));
  out('  Node ' + process.version + ' · ' + process.platform + ' ' + process.arch);
  out('  Working tree: ' + (git('status --porcelain') === '' ? 'clean' : 'dirty'));
  out('  Started ' + startedIso + ' · Finished ' + isoUtc() + ' · ' + (Date.now() - startedMs) + ' ms');
  out('— Database immutability — Writes executed: SIM (em tx); committed: 0; Net change: 0');
  out('');

  const body = R.join('\n');
  const sha = createHash('sha256').update(body, 'utf8').digest('hex');
  console.log(body);
  console.log('— Execution Report SHA256 —\n  ' + sha + '\n');
  const state = failures ? 'FAILED' : 'SUCCESS';
  console.log('====================================');
  console.log('ETAPA — TESTES DA FASE (NORM-06.1 / RLS)');
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
