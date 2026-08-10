// Suite de verificacao da REF-SAAS-01 · Onda 1 (gateway de autorizacao) — "Testes da fase".
// Duas camadas: (A) checks estruturais somente-leitura (schema/constraints/funcoes) e (B) checks
// COMPORTAMENTAIS via simulacao de sessao (mesmo padrao de scripts/auth-rls-test.mjs: SET LOCAL
// ROLE + request.jwt.claims dentro de BEGIN...ROLLBACK — mutacao liquida ZERO, nada persiste,
// inclusive a insercao de um super_admin ficticio no teste B4 e desfeita pelo ROLLBACK).
// Prova que is_admin()/is_admin_of()/is_super_admin() se comportam exatamente como o ADR descreve
// (docs/adr/REF-SAAS-01-fundacao-multitenant.md §4) e que o admin real de producao continua
// autorizado identicamente a antes da Onda 1 (retrocompatibilidade). Exit 0 = SUCCESS; 1 = FAILED.
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

const ADMIN_REAL_USER_ID = 'b9dc7626-af9c-4ab5-95f7-3207e6469129'; // admin da Encanto (e, desde a
  // correcao operacional pos-Onda-8 de 2026-08-10, TAMBEM super admin real e permanente da VALION --
  // pedido explicito do dono. B2/B4/B5 abaixo pararam de poder assumir "este usuario nunca e super
  // admin" e foram ajustados para nao depender mais disso.
const ADMIN_REGULAR_TESTE = 'ce7ece01-266c-42b1-a9db-8051da24d7f5'; // auth.users real, NUNCA super admin
  // hoje -- usado so em B2 pra simular um admin REGULAR (escopado a 1 loja), sem contaminar a
  // identidade do admin real (que agora tambem e super admin).
const USER_ALEATORIO = '00000000-0000-0000-0000-000000000001'; // nao existe em admins/super_admins

const R = []; const out = (s = '') => R.push(s);
let passes = 0, failures = 0;
const startedMs = Date.now(), startedIso = isoUtc();
function record(id, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} ${desc}`); out(`         -> ${detail}`);
}
// tx: BEGIN; setup como superuser (antes do SET ROLE); set claims; SET LOCAL ROLE; fn; ROLLBACK.
async function tx(role, sub, setupSql, fn) {
  try {
    await client.query('BEGIN');
    for (const s of (setupSql || [])) await client.query(s);
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(sub ? { sub, role } : { role })]);
    await client.query(`SET LOCAL ROLE ${role}`);
    return await fn();
  } finally { await client.query('ROLLBACK').catch(() => {}); }
}

try {
  out('==================================================================');
  out(' SUITE DE AUTORIZACAO — REF-SAAS-01 · Onda 1 (gateway) — RELATORIO');
  out('==================================================================');
  out('Camada A: somente leitura. Camada B: simulacao de sessao dentro de BEGIN...ROLLBACK (mutacao liquida = 0).');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessao ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  // Baseline ANTES de qualquer tx() -- desde a correcao operacional pos-Onda-8 (2026-08-10),
  // ADMIN_REAL_USER_ID e' super admin real/permanente (pedido explicito do dono). B5 compara CONTAGEM
  // antes/depois, nao mais assume 0.
  const baselineSuperAdmins = (await client.query(`SELECT count(*)::int AS n FROM public.super_admins`)).rows[0].n;

  out('— A1: super_admins existe (global, sem store_id), RLS habilitado com self-read —');
  {
    const cols = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='super_admins'`);
    const nomes = cols.rows.map(r => r.column_name).sort();
    const semStoreId = !nomes.includes('store_id');
    const temUserIdECreatedAt = nomes.includes('user_id') && nomes.includes('created_at');
    const rls = await client.query(`SELECT relrowsecurity FROM pg_class WHERE relname='super_admins' AND relnamespace='public'::regnamespace`);
    const rlsOk = rls.rowCount === 1 && rls.rows[0].relrowsecurity === true;
    const pol = await client.query(`SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='super_admins'`);
    const ok = semStoreId && temUserIdECreatedAt && rlsOk && pol.rowCount >= 1;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A1 super_admins global/RLS/policy corretos`);
    out(`         -> colunas=[${nomes.join(',')}] · sem store_id=${semStoreId} · RLS=${rlsOk} · policies=${pol.rowCount}`);
  }
  out('');

  out('— A2: admins.store_id existe, NOT NULL, com FK -> stores; UNIQUE virou (store_id,user_id) —');
  {
    const col = await client.query(`SELECT is_nullable, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='admins' AND column_name='store_id'`);
    const ok1 = col.rowCount === 1 && col.rows[0].is_nullable === 'NO' && col.rows[0].data_type === 'uuid';
    const uq = await client.query(`
      SELECT tc.constraint_name, array_agg(kcu.column_name::text ORDER BY kcu.ordinal_position) AS cols
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
      WHERE tc.table_schema='public' AND tc.table_name='admins' AND tc.constraint_type='UNIQUE'
      GROUP BY tc.constraint_name
    `);
    const compostoOk = uq.rows.some(r => JSON.stringify(r.cols) === JSON.stringify(['store_id', 'user_id']));
    const antigoSumiu = !uq.rows.some(r => JSON.stringify(r.cols) === JSON.stringify(['user_id']));
    const ok = ok1 && compostoOk && antigoSumiu;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A2 admins.store_id NOT NULL/uuid + UNIQUE(store_id,user_id)`);
    out(`         -> store_id: ${JSON.stringify(col.rows)} · uniques: ${JSON.stringify(uq.rows)}`);
  }
  out('');

  out('— A3: admin real de producao (' + ADMIN_REAL_USER_ID + ') aponta pra loja "encanto" —');
  {
    const r = await client.query(`
      SELECT a.user_id, s.slug FROM public.admins a JOIN public.stores s ON s.id = a.store_id
      WHERE a.user_id = $1
    `, [ADMIN_REAL_USER_ID]);
    const ok = r.rowCount === 1 && r.rows[0].slug === 'encanto';
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] A3 admin real vinculado a store_id da loja "encanto"`);
    out(`         -> ${JSON.stringify(r.rows)}`);
  }
  out('');

  out('— B1 (comportamental): is_admin() do admin real continua TRUE (retrocompatibilidade) —');
  {
    let v = 'FAIL', d = '';
    await tx('authenticated', ADMIN_REAL_USER_ID, [], async () => {
      const r = await client.query('SELECT public.is_admin() AS ok');
      v = r.rows[0].ok === true ? 'PASS' : 'FAIL';
      d = `is_admin()=${r.rows[0].ok}`;
    });
    record('B1', 'is_admin() do admin real == true (igual a antes da Onda 1)', v, d);
  }
  out('');

  // `stores` tem RLS habilitado SEM policy (Onda 0, tabela trancada por design — so SECURITY DEFINER
  // acessa). Por isso o id da loja "encanto" e resolvido AQUI, como superuser, fora de qualquer
  // sessao simulada — nunca dentro de uma query rodada sob "SET LOCAL ROLE authenticated" (lá, um
  // SELECT direto em stores sempre voltaria vazio/NULL por RLS, o que testaria is_admin_of(NULL) por
  // engano, nao is_admin_of(<loja real>)).
  const encantoId = (await client.query(`SELECT id FROM public.stores WHERE slug = 'encanto'`)).rows[0].id;

  out('— B2: is_admin_of() de um admin REGULAR (nao super) e escopado -- true pra loja vinculada, false pra loja aleatoria —');
  {
    // ADMIN_REGULAR_TESTE ganha um vinculo TEMPORARIO com a Encanto so' dentro desta transacao
    // (ROLLBACK desfaz) -- desde que o admin real tambem passou a ser super admin (correcao pos-
    // Onda-8), ele nao serve mais pra provar o caso "admin regular, escopado a 1 loja so".
    let v = 'FAIL', d = '';
    await tx('authenticated', ADMIN_REGULAR_TESTE, [
      `INSERT INTO public.admins (user_id, store_id) VALUES ('${ADMIN_REGULAR_TESTE}', '${encantoId}') ON CONFLICT DO NOTHING`,
    ], async () => {
      const r1 = await client.query(`SELECT public.is_admin_of($1) AS ok`, [encantoId]);
      const r2 = await client.query(`SELECT public.is_admin_of(gen_random_uuid()) AS ok`);
      v = (r1.rows[0].ok === true && r2.rows[0].ok === false) ? 'PASS' : 'FAIL';
      d = `is_admin_of(encanto)=${r1.rows[0].ok} · is_admin_of(loja_aleatoria)=${r2.rows[0].ok}`;
    });
    record('B2', 'is_admin_of() escopado corretamente por loja (admin regular, nunca super admin)', v, d);
  }
  out('');

  out('— B3: usuario aleatorio (fora de admins/super_admins) NAO e admin de lugar nenhum —');
  {
    let v = 'FAIL', d = '';
    await tx('authenticated', USER_ALEATORIO, [], async () => {
      const r1 = await client.query('SELECT public.is_admin() AS ok');
      const r2 = await client.query(`SELECT public.is_admin_of($1) AS ok`, [encantoId]);
      v = (r1.rows[0].ok === false && r2.rows[0].ok === false) ? 'PASS' : 'FAIL';
      d = `is_admin()=${r1.rows[0].ok} · is_admin_of(encanto)=${r2.rows[0].ok}`;
    });
    record('B3', 'usuario sem vinculo nenhum e negado em ambas as funcoes', v, d);
  }
  out('');

  out('— B4: super admin (simulado, NUNCA persiste alem do que ja era real — ROLLBACK) passa em QUALQUER loja, mesmo sem linha em admins PARA aquela loja —');
  {
    let v = 'FAIL', d = '';
    // Reaproveita o user_id do admin real (ja existe em auth.users, satisfaz a FK de super_admins) --
    // desde a correcao operacional pos-Onda-8 (2026-08-10), ele JA E' super admin de verdade em
    // producao, permanentemente (pedido explicito do dono) -- por isso ON CONFLICT DO NOTHING (a
    // linha real ja existe fora desta transacao; o INSERT so e' redundante aqui, nunca falha).
    await tx('authenticated', ADMIN_REAL_USER_ID, [
      `INSERT INTO public.super_admins (user_id) VALUES ('${ADMIN_REAL_USER_ID}') ON CONFLICT DO NOTHING`,
    ], async () => {
      const r = await client.query(`SELECT public.is_admin_of(gen_random_uuid()) AS ok, public.is_super_admin() AS super`);
      v = (r.rows[0].ok === true && r.rows[0].super === true) ? 'PASS' : 'FAIL';
      d = `is_super_admin()=${r.rows[0].super} · is_admin_of(loja_qualquer)=${r.rows[0].ok}`;
    });
    record('B4', 'is_super_admin() implica is_admin_of() em qualquer loja', v, d);
  }
  out('');

  out('— B5: apos o teste B4, super_admins nao cresceu em relacao ao baseline (prova que o ROLLBACK nao deixou lixo NOVO) —');
  {
    const r = await client.query('SELECT count(*)::int AS n FROM public.super_admins');
    const ok = r.rows[0].n === baselineSuperAdmins;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] B5 super_admins sem crescimento liquido em producao`);
    out(`         -> n=${r.rows[0].n} · baseline=${baselineSuperAdmins}`);
  }
  out('');

  out('— A4: zero regressao — RPCs administrativas do dia a dia continuam respondendo (sessao real de admin) —');
  {
    // REF-SAAS-01 · Onda 5: admin_orders_search passou a ser SECURITY DEFINER com gate explicito
    // is_admin_of(p_store_id) -- ja nao responde "fora de sessao" (SECURITY INVOKER + bypass do dono
    // da conexao); precisa da mesma sessao simulada usada em B1-B4 acima.
    let v = 'FAIL', d = '';
    try {
      await tx('authenticated', ADMIN_REAL_USER_ID, [], async () => {
        const r1 = await client.query(`SELECT * FROM public.admin_orders_search(null, null, 3, null, null)`);
        const r2 = await client.query(`SELECT public.get_store_mode() AS mode`);
        v = 'PASS';
        d = `admin_orders_search retornou ${r1.rowCount} linha(s) · get_store_mode=${r2.rows[0].mode}`;
      });
    } catch (e) { d = redact(e.message).split('\n')[0]; }
    record('A4', 'admin_orders_search/get_store_mode sem erro (sessao real de admin)', v, d);
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
  console.log('ETAPA — TESTES DA FASE (REF-SAAS-01 · Onda 1)');
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
