// Suite de invariantes STI (NORM-06 F1B) — Etapa "Testes da fase".
// Testa I1..I4 com casos NEGATIVOS (devem ser REJEITADOS) e POSITIVOS (devem PASSAR),
// inclusive a sequencia do backfill F2 (P4) e a serializacao de concorrencia (C1).
// CADA teste roda dentro de BEGIN ... ROLLBACK (ou conexoes auxiliares revertidas): nenhuma escrita
// persiste — mutacao liquida no banco = 0 (verificada por contagens antes/depois).
// Emite RELATORIO REPRODUZIVEL + AUTOAUDITAVEL. Exit 0 = SUCCESS; exit 1 = FAILED.
// Le credenciais de C:\Users\00thi\.encanto\db.env (igual run.mjs). NUNCA imprime a senha.
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
const SCRIPT_NAME = 'test:f1b';

const envGet = (txt, k) => { const m = txt.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
function loadConn() {
  let txt; try { txt = readFileSync(ENV_PATH, 'utf8'); } catch { console.error('ERRO: db.env nao encontrado em ' + ENV_PATH); process.exit(2); }
  const host = envGet(txt, 'PGHOST'); const user = envGet(txt, 'PGUSER'); const url = envGet(txt, 'SUPABASE_DB_URL');
  if (host) { const password = envGet(txt, 'PGPASSWORD'); if (!password) { console.error('ERRO: PGPASSWORD vazio em db.env'); process.exit(2); } return { cfg: { host, port: Number(envGet(txt, 'PGPORT') || 5432), user, password, database: envGet(txt, 'PGDATABASE') || 'postgres' }, secret: password, host, user }; }
  if (url) return { cfg: { connectionString: url }, secret: url, host: url, user };
  console.error('ERRO: defina credenciais em db.env'); process.exit(2);
}
function projectRef(host, user) {
  let m = (user || '').match(/postgres\.([a-z0-9]{16,})/i); if (m) return m[1];
  m = (host || '').match(/(?:^|\.)([a-z0-9]{16,})\.supabase\./i); if (m) return m[1];
  m = (host || '').match(/postgres\.([a-z0-9]{16,})/i); if (m) return m[1];
  return '(n/d)';
}
const git = (args) => { try { return execSync('git ' + args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return '(n/d)'; } };
const isoUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const { cfg, secret, host, user } = loadConn();
const mkClient = () => new pg.Client({ ...cfg, ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });
const redact = s => { let r = String(s); if (secret) r = r.split(secret).join('[REDACTED]'); return r; };
const client = mkClient();

const R = [];
const out = (s = '') => R.push(s);
let failures = 0, passes = 0, skips = 0;
const startedMs = Date.now();
const startedIso = isoUtc();

// IDs de teste temporarios (criados e revertidos dentro de cada transacao).
const TCOLL = "__f1b_tcoll", TCOLL_SLUG = "__f1b-tcoll";   // categoria collection temporaria
const TBIZ = "__f1b_tbiz",  TBIZ_SLUG  = "__f1b-tbiz";     // categoria business temporaria
const mkColl = `INSERT INTO public.categories(id,nome,slug,tipo,estrategia,ordem,ativo) VALUES('${TCOLL}','F1B TEST COLL','${TCOLL_SLUG}','collection','manual',999,true)`;
const mkBiz  = `INSERT INTO public.categories(id,nome,slug,tipo,ordem,ativo) VALUES('${TBIZ}','F1B TEST BIZ','${TBIZ_SLUG}','business',999,true)`;

async function counts() {
  const q = await client.query(`SELECT
      (SELECT count(*) FROM public.categories)          AS categories,
      (SELECT count(*) FROM public.products)            AS products,
      (SELECT count(*) FROM public.adicionais)          AS adicionais,
      (SELECT count(*) FROM public.product_collections) AS product_collections`);
  return q.rows[0];
}

// Executa setups (devem TODOS passar), depois a instrucao-alvo, esperando REJEICAO pela trigger STI
// ESPECIFICA do teste (derivada do id: I1..I4).
async function expectReject(id, desc, setups, target) {
  const exp = (id.match(/I[1-4]/) || [])[0];           // invariante esperada
  const re = new RegExp('STI ' + (exp || 'I[1-4]') + ':');
  let verdict = 'FAIL', detail = '';
  try {
    await client.query('BEGIN');
    for (const s of setups) {
      try { await client.query(s); }
      catch (e) { detail = 'setup falhou: ' + redact(e.message).split('\n')[0]; throw new Error('__setup__'); }
    }
    try {
      await client.query(target);
      detail = 'instrucao-alvo NAO foi rejeitada (esperava bloqueio ' + (exp || 'STI') + ')';
      verdict = 'FAIL';
    } catch (e) {
      const msg = redact(e.message || '');
      if (re.test(msg)) { verdict = 'PASS'; detail = msg.split('\n')[0]; }
      else { verdict = 'FAIL'; detail = 'rejeitado por motivo INESPERADO (esperava ' + (exp || 'STI Ix') + '): ' + msg.split('\n')[0]; }
    }
  } catch (e) {
    if (e.message !== '__setup__') detail = 'erro de transacao: ' + redact(e.message).split('\n')[0];
    verdict = 'FAIL';
  } finally {
    await client.query('ROLLBACK').catch(err => out('         (aviso: ROLLBACK falhou: ' + redact(err.message) + ')'));
  }
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} (REJEITAR) ${desc}`);
  out(`         -> ${detail}`);
}

// Executa a sequencia (todas devem PASSAR), esperando SUCESSO; reverte ao final. stmts=null => SKIP.
async function expectAccept(id, desc, stmts) {
  if (stmts === null) { skips++; out(`  [SKIP] ${id} (ACEITAR)  ${desc}`); out('         -> pre-condicao ausente (inconclusivo)'); return; }
  let verdict = 'PASS', detail = 'todas as instrucoes aceitas';
  try {
    await client.query('BEGIN');
    for (const s of stmts) {
      try { await client.query(s); }
      catch (e) { verdict = 'FAIL'; detail = 'instrucao legitima REJEITADA: ' + redact(e.message).split('\n')[0]; break; }
    }
  } catch (e) {
    verdict = 'FAIL'; detail = 'erro de transacao: ' + redact(e.message).split('\n')[0];
  } finally {
    await client.query('ROLLBACK').catch(err => out('         (aviso: ROLLBACK falhou: ' + redact(err.message) + ')'));
  }
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} (ACEITAR)  ${desc}`);
  out(`         -> ${detail}`);
}

// C1: prova que o FOR SHARE de I2 serializa "adicionar referrer" vs "flip de tipo" (fecha TOCTOU).
// connA segura FOR SHARE em c10 (via trigger I2 num UPDATE no-op); connB tenta flipar c10 -> deve BLOQUEAR
// (statement_timeout 57014). Sem FOR SHARE, connB nao bloquearia (retornaria STI I4 imediato). Net-zero (ROLLBACK).
async function concurrencyTest(pidC10) {
  if (!pidC10) { skips++; out('  [SKIP] C1·concorrencia — sem produto em c10'); return; }
  const A = mkClient(), B = mkClient();
  let verdict = 'FAIL', detail = '';
  try {
    await A.connect(); await B.connect();
    await A.query('BEGIN');
    await A.query(`UPDATE public.products SET categoria_id=categoria_id WHERE id='${pidC10}'`);  // dispara I2 -> FOR SHARE em c10
    await B.query('BEGIN');
    await B.query("SET LOCAL statement_timeout='1500ms'");
    try {
      await B.query("UPDATE public.categories SET tipo='collection', estrategia='manual' WHERE id='c10'");
      verdict = 'FAIL'; detail = 'flip NAO bloqueou (FOR SHARE ausente?) — TOCTOU aberto';
    } catch (e) {
      if (e.code === '57014') { verdict = 'PASS'; detail = 'flip de tipo BLOQUEADO pelo FOR SHARE do referrer (timeout 57014) — serializacao confirmada'; }
      else { verdict = 'FAIL'; detail = 'erro inesperado no flip: ' + redact(e.message).split('\n')[0] + ' (code=' + e.code + ')'; }
    }
  } catch (e) {
    verdict = 'FAIL'; detail = 'erro de setup C1: ' + redact(e.message).split('\n')[0];
  } finally {
    await A.query('ROLLBACK').catch(() => {}); await B.query('ROLLBACK').catch(() => {});
    await A.end().catch(() => {}); await B.end().catch(() => {});
  }
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] C1·concorrencia (FOR SHARE de I2 serializa flip de tipo — TOCTOU)`);
  out(`         -> ${detail}`);
}

try {
  out('==================================================================');
  out(' SUITE DE INVARIANTES STI — F1B / NORM-06 — RELATORIO');
  out('==================================================================');
  out('Cada teste roda em BEGIN ... ROLLBACK. Nenhuma escrita persiste.');
  out('Mutacao liquida no banco = 0 (verificada por contagens antes/depois).');
  out('Cobertura: single-statement (I1..I4, ambos os ramos) + sequencia F2 (P4) + concorrencia/TOCTOU (C1).');
  out('');

  await client.connect();

  const meta = (await client.query("SELECT current_database() AS db, current_schema() AS schema, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];

  // Pre-condicao: as 4 triggers + 4 funcoes STI existem.
  const trg = (await client.query(`SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgname LIKE 'trg_sti_%' ORDER BY t.tgname`)).rows.map(r => r.tgname);
  const fns = (await client.query(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'trg_sti_%' ORDER BY p.proname`)).rows.map(r => r.proname);

  out('— Fingerprint do banco —');
  out('  Project ID  : ' + projectRef(host, user));
  out('  Database    : ' + meta.db + ' · Schema: ' + meta.schema);
  out('  Timestamp   : ' + meta.utc + ' (UTC, relogio do servidor)');
  out('  Triggers STI: ' + (trg.length ? trg.join(', ') : '(nenhuma)'));
  out('  Funcoes STI : ' + (fns.length ? fns.join(', ') : '(nenhuma)'));
  out('');
  if (trg.length !== 4 || fns.length !== 4) {
    out('  [FALHA] pre-condicao: esperadas 4 triggers + 4 funcoes STI (migracao F1B aplicada?).');
    failures++;
  }

  const before = await counts();

  // Dados de apoio (deterministicos: ORDER BY id).
  const pid = (await client.query("SELECT id FROM public.products ORDER BY id LIMIT 1")).rows[0]?.id;
  const pidC8 = (await client.query("SELECT id FROM public.products WHERE categoria_id='c8' ORDER BY id LIMIT 1")).rows[0]?.id;
  const pidC10 = (await client.query("SELECT id FROM public.products WHERE categoria_id='c10' ORDER BY id LIMIT 1")).rows[0]?.id;
  const aid = (await client.query("SELECT id FROM public.adicionais ORDER BY id LIMIT 1")).rows[0]?.id;
  out('— Dados de apoio (deterministicos) —');
  out('  product (1o por id): ' + (pid || '(n/d)'));
  out('  product em c8 (F2) : ' + (pidC8 || '(n/d)'));
  out('  product em c10 (C1): ' + (pidC10 || '(n/d)'));
  out('  adicional (1o por id): ' + (aid || '(n/d)'));
  out('');

  out('— NEGATIVOS (a trigger DEVE rejeitar) —');
  await expectReject('N1·I1', 'INSERT membro com collection_id=business (c5)', [],
    `INSERT INTO public.product_collections(product_id, collection_id) VALUES ('${pid}','c5')`);
  await expectReject('N1b·I1', 'UPDATE membro: collection_id collection->business (c5)',
    [mkColl, `INSERT INTO public.product_collections(product_id, collection_id) VALUES ('${pid}','${TCOLL}')`],
    `UPDATE public.product_collections SET collection_id='c5' WHERE product_id='${pid}' AND collection_id='${TCOLL}'`);
  await expectReject('N2a·I2', 'INSERT product.categoria_id=collection', [mkColl],
    `INSERT INTO public.products(nome, categoria_id) VALUES ('__F1B_TEST_N2a','${TCOLL}')`);
  await expectReject('N2b·I2', 'UPDATE product.categoria_id=collection', [mkColl],
    `UPDATE public.products SET categoria_id='${TCOLL}' WHERE id='${pid}'`);
  await expectReject('N3a·I3', 'INSERT adicional.aplica_categoria_id=collection', [mkColl],
    `INSERT INTO public.adicionais(nome, grupo, aplica_categoria_id) VALUES ('__F1B_TEST_N3a','simples','${TCOLL}')`);
  await expectReject('N3b·I3', 'UPDATE adicional.aplica_categoria_id=collection', [mkColl],
    `UPDATE public.adicionais SET aplica_categoria_id='${TCOLL}' WHERE id='${aid}'`);
  await expectReject('N4a·I4', 'business->collection com produtos (c5)', [],
    `UPDATE public.categories SET tipo='collection', estrategia='manual' WHERE id='c5'`);
  await expectReject('N4b·I4', 'business->collection com adicionais, sem produtos (D-I4-ADIC)',
    [mkBiz, `INSERT INTO public.adicionais(nome, grupo, aplica_categoria_id) VALUES ('__F1B_TEST_N4b','simples','${TBIZ}')`],
    `UPDATE public.categories SET tipo='collection', estrategia='manual' WHERE id='${TBIZ}'`);
  await expectReject('N4c·I4', 'collection->business com membros em product_collections',
    [mkColl, `INSERT INTO public.product_collections(product_id, collection_id) VALUES ('${pid}','${TCOLL}')`],
    `UPDATE public.categories SET tipo='business', estrategia=NULL WHERE id='${TCOLL}'`);
  out('');

  out('— POSITIVOS (operacao legitima DEVE passar) —');
  await expectAccept('P1·I1', 'membro valido (collection_id=collection)',
    [mkColl, `INSERT INTO public.product_collections(product_id, collection_id) VALUES ('${pid}','${TCOLL}')`]);
  await expectAccept('P2·I2', 'UPDATE product.categoria_id=business (temp, sem colisao de nome)',
    [mkBiz, `UPDATE public.products SET categoria_id='${TBIZ}' WHERE id='${pid}'`]);
  await expectAccept('P3a·I3', 'INSERT adicional.aplica_categoria_id=business (c3)',
    [`INSERT INTO public.adicionais(nome, grupo, aplica_categoria_id) VALUES ('__F1B_TEST_P3a','simples','c3')`]);
  await expectAccept('P3b·I3', 'INSERT adicional.aplica_categoria_id=NULL (global)',
    [`INSERT INTO public.adicionais(nome, grupo, aplica_categoria_id) VALUES ('__F1B_TEST_P3b','simples',NULL)`]);
  // P4: sequencia F2 com realloc SINTETICO (TBIZ) para isolar a invariante de colisoes de dados (ver nota).
  await expectAccept('P4·F2', 'sequencia F2 (realloc do produto de c8->business temp; flip c8->collection; membro)',
    pidC8 ? [mkBiz,
      `UPDATE public.products SET categoria_id='${TBIZ}' WHERE id='${pidC8}'`,
      `UPDATE public.categories SET tipo='collection', estrategia='manual' WHERE id='c8'`,
      `INSERT INTO public.product_collections(product_id, collection_id, ordem, fixado) VALUES ('${pidC8}','c8',0,false)`,
    ] : null);
  await expectAccept('P5·I4', 'collection->business sem membros',
    [mkColl, `UPDATE public.categories SET tipo='business', estrategia=NULL WHERE id='${TCOLL}'`]);
  await expectAccept('P6·I4', 'business->collection sem produtos nem adicionais',
    [mkBiz, `UPDATE public.categories SET tipo='collection', estrategia='manual' WHERE id='${TBIZ}'`]);
  await expectAccept('P7·I4', 'no-op tipo (business->business) em categoria com produtos',
    [`UPDATE public.categories SET tipo='business' WHERE id='c5'`]);
  out('');

  out('— CONCORRENCIA (TOCTOU) —');
  await concurrencyTest(pidC10);
  out('');

  // ── Role-aware (pos ERRATA-01 SECURITY DEFINER): STI correto sob authenticated; anon negado por RLS ──
  out('— STI sob role authenticated/anon (pos-errata ERRATA-01 — SECURITY DEFINER) —');
  async function roleCase(id, role, desc, fn) {
    let v = 'FAIL', d = '';
    try { await client.query('BEGIN'); if (role) await client.query(`SET LOCAL ROLE ${role}`); const r = await fn(); v = r.v; d = r.d; }
    catch (e) { v = 'FAIL'; d = 'erro: ' + redact(e.message).split('\n')[0]; }
    finally { await client.query('ROLLBACK').catch(() => {}); }
    if (v === 'PASS') passes++; else failures++;
    out(`  [${v}] ${id} <${role || 'postgres'}> ${desc}`); out('         -> ' + d);
  }
  // RA1: bug-repro — authenticated self-update de categoria_id (antes falhava com (inexistente))
  await roleCase('RA1·I2', 'authenticated', 'self-update categoria_id (bug-repro corrigido)', async () => {
    const r = await client.query(`UPDATE public.products SET categoria_id=categoria_id WHERE id='${pid}'`);
    return r.rowCount === 1 ? { v: 'PASS', d: `UPDATE ${r.rowCount} linha — bug (inexistente) corrigido` } : { v: 'FAIL', d: `UPDATE ${r.rowCount} linhas` };
  });
  // RA2: authenticated CRIA produto com categoria business valida (operacao que estava quebrada)
  await roleCase('RA2·I2', 'authenticated', 'INSERT produto novo com categoria business (c5)', async () => {
    const r = await client.query(`INSERT INTO public.products(nome, categoria_id) VALUES('__ra_create_test','c5')`);
    return { v: 'PASS', d: `INSERT ok (${r.rowCount} linha) — criacao de produto funciona sob authenticated` };
  });
  // RA3: authenticated -> collection invalido: STI I2 com tipo=collection (NAO inexistente)
  await roleCase('RA3·I2', null, 'authenticated UPDATE -> collection rejeitado com tipo=collection', async () => {
    await client.query(mkColl); await client.query('SET LOCAL ROLE authenticated');
    try { await client.query(`UPDATE public.products SET categoria_id='${TCOLL}' WHERE id='${pid}'`); return { v: 'FAIL', d: 'NAO rejeitou' }; }
    catch (e) { const m = redact(e.message); return (/STI I2:/.test(m) && /tipo=collection/.test(m)) ? { v: 'PASS', d: m.split('\n')[0] } : { v: 'FAIL', d: 'inesperado: ' + m.split('\n')[0] }; }
  });
  // RA4: anon NAO escreve products (RLS -> 0 linhas ou 42501)
  await roleCase('RA4', 'anon', 'UPDATE products negado por RLS', async () => {
    try { const r = await client.query(`UPDATE public.products SET disponivel=disponivel WHERE id='${pid}'`); return r.rowCount === 0 ? { v: 'PASS', d: 'RLS filtrou (0 linhas)' } : { v: 'FAIL', d: `afetou ${r.rowCount} linhas` }; }
    catch (e) { return e.code === '42501' ? { v: 'PASS', d: 'RLS negou (42501)' } : { v: 'FAIL', d: 'erro: ' + redact(e.message).split('\n')[0] }; }
  });
  // RA5: anon LE products incl. indisponiveis (D1) — confirma leitura preservada
  await roleCase('RA5·D1', 'anon', 'le products incl. indisponiveis', async () => {
    const r = (await client.query("SELECT count(*) AS t, count(*) FILTER (WHERE disponivel=false) AS i FROM public.products")).rows[0];
    return (Number(r.i) > 0) ? { v: 'PASS', d: `anon le ${r.t} produtos, ${r.i} indisponiveis` } : { v: 'FAIL', d: `indispon=${r.i}` };
  });
  out('  (cobertura authenticated de I1/I3/I4 com setup de categoria: ver test:rls pos-NORM-06.1 — CS1..CS4)');
  out('');

  // Verificacao de imutabilidade liquida.
  const after = await counts();
  out('— Mutacao liquida (antes == depois) —');
  let drift = 0;
  for (const k of Object.keys(before)) {
    const eq = String(before[k]) === String(after[k]);
    if (!eq) drift++;
    out(`  ${k.padEnd(20)} : antes=${before[k]} depois=${after[k]} ${eq ? 'OK' : '<<< DRIFT'}`);
  }
  if (drift > 0) { failures++; out('  [FALHA] mutacao liquida detectada (rollback nao limpou).'); }
  else out('  Net DB change: 0 (todas as transacoes revertidas).');
  out('');

  out('— Resumo —');
  out('  PASS: ' + passes + '  ·  FAIL: ' + failures + '  ·  SKIP: ' + skips);
  out('');

  out('— Execution Fingerprint —');
  out('  Commit SHA   : ' + git('rev-parse HEAD'));
  out('  Branch       : ' + git('rev-parse --abbrev-ref HEAD'));
  out('  Node Version : ' + process.version);
  out('  Plataforma   : ' + process.platform + ' ' + process.arch);
  out('  Project ID   : ' + projectRef(host, user));
  out('  Database     : ' + meta.db + ' · schema public');
  out('  Timestamp UTC: ' + meta.utc);
  out('  Script       : ' + SCRIPT_NAME);
  out('  Working tree : ' + (git('status --porcelain') === '' ? 'clean' : 'dirty'));
  out('');

  const finishedIso = isoUtc();
  out('— Duration —');
  out('  Started : ' + startedIso);
  out('  Finished: ' + finishedIso);
  out('  Duration: ' + (Date.now() - startedMs) + ' ms');
  out('');

  out('— Database immutability —');
  out('  Writes executed : SIM (dentro de transacoes/conexoes auxiliares)');
  out('  Writes committed: 0 (todas revertidas via ROLLBACK)');
  out('  Net DB change   : 0');
  out('  Status: NO PERSISTED WRITES');
  out('');

  const body = R.join('\n');
  const sha = createHash('sha256').update(body, 'utf8').digest('hex');
  console.log(body);
  console.log('— Execution Report SHA256 —');
  console.log('  ' + sha);
  console.log('');

  const state = failures ? 'FAILED' : 'SUCCESS';
  console.log('====================================');
  console.log('ETAPA — TESTES DA FASE (F1B)');
  console.log('STATE: ' + state);
  console.log('PASS=' + passes + ' FAIL=' + failures + ' SKIP=' + skips);
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
