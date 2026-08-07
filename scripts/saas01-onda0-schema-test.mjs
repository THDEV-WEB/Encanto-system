// Suite de verificacao da REF-SAAS-01 · Onda 0 (fundacao multi-tenant) — "Testes da fase".
// Mesmo molde de datetime-schema-test.mjs/address-schema-test.mjs: conecta no banco via db.env,
// SOMENTE LEITURA (nenhum BEGIN/ROLLBACK necessario — nao ha escrita a proteger aqui, so SELECT
// contra information_schema/pg_catalog + RPCs de leitura ja existentes).
//
// Confirma exatamente o que migrations/REF-SAAS-01-onda0-schema.sql prometeu (ADR
// docs/adr/REF-SAAS-01-fundacao-multitenant.md §1.2/§6/§9): tabela `stores` criada com a loja
// "encanto", `store_id` NULLABLE nas 13 tabelas de negocio, backfill 100% completo, indice por
// `store_id` em cada uma — e, tao importante quanto, que NADA fora do escopo desta onda foi
// tocado (admins/settings/address_gazetteer permanecem sem store_id; nenhuma RLS/RPC mudou).
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

const TABELAS_COM_STORE_ID = [
  'customers', 'products', 'categories', 'adicionais', 'product_collections',
  'orders', 'order_items', 'order_events', 'loyalty_accounts', 'loyalty_events',
  'notification_outbox', 'addresses', 'application_logs',
];
const TABELAS_SEM_STORE_ID_NESTA_ONDA = ['admins', 'settings', 'address_gazetteer'];

const R = []; const out = (s = '') => R.push(s);
let passes = 0, failures = 0;
const startedMs = Date.now(), startedIso = isoUtc();
function record(id, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} ${desc}`); out(`         -> ${detail}`);
}

try {
  out('==================================================================');
  out(' SUITE DE SCHEMA — REF-SAAS-01 · Onda 0 (fundacao multi-tenant) — RELATORIO');
  out('==================================================================');
  out('Somente leitura (SELECT). Nenhuma escrita.');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessao ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  out('— S1: tabela stores existe, com a loja "encanto" como unica linha —');
  {
    let v = 'FAIL', d = '';
    try {
      const r = await client.query(`SELECT id, slug, nome, dominio, status FROM public.stores`);
      const ok = r.rowCount === 1 && r.rows[0].slug === 'encanto' && r.rows[0].status === 'ativo' && r.rows[0].dominio === 'encanto.valionsistemas.com.br';
      v = ok ? 'PASS' : 'FAIL';
      d = `${r.rowCount} linha(s): ${JSON.stringify(r.rows)}`;
    } catch (e) { d = redact(e.message).split('\n')[0]; }
    record('S1', 'stores tem exatamente 1 linha (encanto/ativo)', v, d);
  }
  out('');

  out('— S2: RLS habilitado em stores (sem policy ainda, por design — Onda 1 adiciona) —');
  {
    const r = await client.query(`SELECT relrowsecurity FROM pg_class WHERE relname='stores' AND relnamespace='public'::regnamespace`);
    const ok = r.rowCount === 1 && r.rows[0].relrowsecurity === true;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] S2 stores.relrowsecurity = true`);
    out(`         -> ${JSON.stringify(r.rows)}`);
  }
  out('');

  out('— S3: cada uma das 13 tabelas de negocio tem store_id (uuid, nullable, FK->stores) —');
  {
    const r = await client.query(`
      SELECT c.table_name, c.data_type, c.is_nullable
      FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.column_name='store_id' AND c.table_name = ANY($1)
    `, [TABELAS_COM_STORE_ID]);
    const byTable = Object.fromEntries(r.rows.map(x => [x.table_name, x]));
    const faltando = TABELAS_COM_STORE_ID.filter(t => !byTable[t]);
    const tipoErrado = TABELAS_COM_STORE_ID.filter(t => byTable[t] && byTable[t].data_type !== 'uuid');
    const naoNullable = TABELAS_COM_STORE_ID.filter(t => byTable[t] && byTable[t].is_nullable !== 'YES');
    const ok = faltando.length === 0 && tipoErrado.length === 0 && naoNullable.length === 0;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] S3 store_id presente/uuid/nullable em todas as ${TABELAS_COM_STORE_ID.length} tabelas`);
    out(`         -> faltando: [${faltando.join(',')}] · tipo!=uuid: [${tipoErrado.join(',')}] · NOT NULL indevido: [${naoNullable.join(',')}]`);

    const fk = await client.query(`
      SELECT tc.table_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name AND tc.table_schema=ccu.table_schema
      WHERE tc.constraint_type='FOREIGN KEY' AND kcu.column_name='store_id' AND ccu.table_name='stores' AND tc.table_name = ANY($1)
    `, [TABELAS_COM_STORE_ID]);
    const comFk = fk.rows.map(x => x.table_name);
    const semFk = TABELAS_COM_STORE_ID.filter(t => !comFk.includes(t));
    const okFk = semFk.length === 0;
    if (okFk) passes++; else failures++;
    out(`  [${okFk ? 'PASS' : 'FAIL'}] S3b store_id tem FK -> stores(id) em todas`);
    out(`         -> sem FK: [${semFk.join(',')}]`);
  }
  out('');

  out('— S4: backfill 100% completo (zero linha com store_id NULL nas tabelas que ja tinham dado) —');
  {
    for (const t of TABELAS_COM_STORE_ID) {
      let v = 'FAIL', d = '';
      try {
        const r = await client.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE store_id IS NULL)::int AS nulos FROM public.${t}`);
        const { total, nulos } = r.rows[0];
        const ok = nulos === 0;
        v = ok ? 'PASS' : 'FAIL';
        d = `total=${total} · store_id NULL=${nulos}`;
      } catch (e) { d = redact(e.message).split('\n')[0]; }
      record(`S4:${t}`, 'backfill completo', v, d);
    }
  }
  out('');

  out('— S5: indice por store_id existe em cada uma das 13 tabelas —');
  {
    const r = await client.query(`SELECT tablename, indexname FROM pg_indexes WHERE schemaname='public' AND indexname LIKE '%store_id_idx'`);
    const comIndice = r.rows.map(x => x.tablename);
    const faltando = TABELAS_COM_STORE_ID.filter(t => !comIndice.includes(t));
    const ok = faltando.length === 0;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] S5 indice *_store_id_idx presente nas ${TABELAS_COM_STORE_ID.length} tabelas`);
    out(`         -> encontrados: ${comIndice.length} · faltando: [${faltando.join(',')}]`);
  }
  out('');

  out('— S6: fora de escopo desta onda — admins/settings/address_gazetteer NAO tem store_id —');
  {
    const r = await client.query(`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema='public' AND column_name='store_id' AND table_name = ANY($1)
    `, [TABELAS_SEM_STORE_ID_NESTA_ONDA]);
    const comStoreId = r.rows.map(x => x.table_name);
    const ok = comStoreId.length === 0;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] S6 nenhuma das 3 tabelas fora de escopo ganhou store_id`);
    out(`         -> ganharam (nao deveriam ter ganho): [${comStoreId.join(',')}]`);
  }
  out('');

  out('— S7: zero regressao — RPCs criticas do dia a dia continuam respondendo normalmente —');
  {
    let v = 'FAIL', d = '';
    try {
      const r1 = await client.query(`SELECT public.get_company_info() AS ci`);
      const r2 = await client.query(`SELECT * FROM public.admin_orders_search(null, null, 3, null, null)`);
      const r3 = await client.query(`SELECT public.get_store_mode() AS mode`);
      v = 'PASS';
      d = `get_company_info ok=${!!r1.rows[0].ci} · admin_orders_search retornou ${r2.rowCount} linha(s) · get_store_mode=${r3.rows[0].mode}`;
    } catch (e) { d = redact(e.message).split('\n')[0]; }
    record('S7', 'get_company_info/admin_orders_search/get_store_mode sem erro', v, d);
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
  console.log('ETAPA — TESTES DA FASE (REF-SAAS-01 · Onda 0)');
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
