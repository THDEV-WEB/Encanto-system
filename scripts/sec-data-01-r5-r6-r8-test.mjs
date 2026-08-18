// Suite de validacao — REF-SEC-DATA-01-harden-r5-r6-r8 (application_logs SELECT + trg_customer_audit
// store_id + grants supérfluos de anon/PUBLIC em 5 RPCs admin).
// Camada comportamental: loja B fictícia, admin/super-admin/cliente fictícios inseridos no início da
// transação e desfeitos pelo ROLLBACK — nunca persistem (mesmo padrão de saas01-onda4-1-pedidos-test.mjs).
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
const SCRIPT_NAME = 'test:sec-data-01-r5r6r8';

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

// Personas REUSADAS de scripts existentes (nunca inventar auth.users id novo — admins.user_id/
// super_admins.user_id tem FK pra auth.users). Confirmado por introspecção antes de escrever este
// script: b9dc7626... e' o admin REAL de producao E JA E' super_admin hoje (licao #11 do projeto) —
// por isso vira SUPER_ID direto, sem precisar de INSERT em super_admins. ce7ece01.../27bd5049...
// existem em auth.users e nao tem nenhum vinculo de admin hoje — livres pra virar admin fictício da
// Encanto/loja B dentro da transacao (desfeito pelo ROLLBACK).
const STORE_B_ID       = 'eeeeeeee-bbbb-4000-8000-000000000001';
const SUPER_ID         = 'b9dc7626-af9c-4ab5-95f7-3207e6469129'; // admin real de producao, JA e' super_admin
const ADMIN_ENCANTO_ID = '4fa5541f-989f-4b8d-89b4-7b45a59d8f4e'; // vira admin COMUM (nao super) da Encanto so' na tx
const ADMIN_B_ID       = 'ce7ece01-266c-42b1-a9db-8051da24d7f5'; // vira admin da loja B ficticia
const STRANGER_ID      = '27bd5049-60e5-4980-abe9-3bd7942a6c31'; // authenticated sem nenhum vinculo de admin
const CUSTOMER_B_ID    = 'eeeeeeee-4444-4000-8000-000000000001';
const LOG_ENCANTO_ID   = 'eeeeeeee-5555-4000-8000-00000000000a';
const LOG_B_ID         = 'eeeeeeee-5555-4000-8000-00000000000b';
const LOG_PLATFORM_ID  = 'eeeeeeee-5555-4000-8000-00000000000c';

function record(id, role, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} <${role}> ${desc}`); out(`         -> ${detail}`);
}
async function setRole(role, sub) {
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(sub ? { sub, role } : { role })]);
  await client.query(`SET LOCAL ROLE ${role}`);
}

try {
  out('==================================================================');
  out(' SUITE DE VALIDACAO — REF-SEC-DATA-01-HARDEN-R5-R6-R8 — RELATORIO');
  out('==================================================================');
  out('Loja B/admin/super-admin/cliente fictícios em BEGIN..ROLLBACK. Nenhuma escrita persiste.');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessão ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  const encantoId = (await client.query(`SELECT id FROM public.stores WHERE slug='encanto'`)).rows[0].id;

  await client.query('BEGIN');
  try {
    // ---- setup (roda como o dono da conexão, bypassa RLS) ----
    await client.query(`INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_B_ID}', 'loja-b-sec-data-01', 'Loja B (fake, teste sec-data-01)', NULL, 'ativo')`);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ('${ADMIN_ENCANTO_ID}', '${encantoId}')`);
    await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ('${ADMIN_B_ID}', '${STORE_B_ID}')`);
    // SUPER_ID (b9dc7626...) JA e' super_admin real de producao — nao inserir de novo (violaria a PK).
    await client.query(`INSERT INTO public.customers (id, name, phone, store_id) VALUES ('${CUSTOMER_B_ID}', 'Cliente fake (sec-data-01)', '47900000001', '${STORE_B_ID}')`);
    await client.query(`INSERT INTO public.application_logs (id, module, level, message, store_id) VALUES ('${LOG_ENCANTO_ID}', 'sec-data-01-test', 'info', 'log encanto', '${encantoId}')`);
    await client.query(`INSERT INTO public.application_logs (id, module, level, message, store_id) VALUES ('${LOG_B_ID}', 'sec-data-01-test', 'info', 'log loja b', '${STORE_B_ID}')`);
    await client.query(`INSERT INTO public.application_logs (id, module, level, message, store_id) VALUES ('${LOG_PLATFORM_ID}', 'sec-data-01-test', 'info', 'log plataforma', NULL)`);

    // R6: dispara trg_customer_audit de verdade (UPDATE como dono, RLS nao entra no caminho)
    await client.query(`UPDATE public.customers SET phone = '47900000002' WHERE id = '${CUSTOMER_B_ID}'`);
    out('— R6 · trg_customer_audit deve propagar store_id da LOJA B, nao da Encanto —');
    {
      const ev = await client.query(`SELECT store_id FROM public.order_events WHERE tipo='CLIENTE_ATUALIZADO' AND payload->>'customer_id' = '${CUSTOMER_B_ID}'`);
      const ok = ev.rowCount === 1 && ev.rows[0].store_id === STORE_B_ID;
      record('R6-1', 'postgres(setup)', 'evento gerado com store_id da loja B (nao da Encanto)', ok ? 'PASS' : 'FAIL', JSON.stringify(ev.rows));
    }
    out('');

    // ---- R5: SELECT em application_logs ----
    out('— R5 · AUTHENTICATED sem vínculo de admin em NENHUMA loja — 0 das 3 linhas semeadas —');
    {
      await setRole('authenticated', STRANGER_ID);
      const r = await client.query(`SELECT id FROM public.application_logs WHERE id IN ('${LOG_ENCANTO_ID}','${LOG_B_ID}','${LOG_PLATFORM_ID}')`);
      const ok = r.rowCount === 0;
      record('R5-1', 'authenticated(stranger)', 'nao ve nenhuma das 3 linhas semeadas', ok ? 'PASS' : 'FAIL', `rows=${r.rowCount}`);
    }
    await client.query('RESET ROLE');

    out('— R5 · AUTHENTICATED admin da Encanto — SO a linha da propria loja —');
    {
      await setRole('authenticated', ADMIN_ENCANTO_ID);
      const r = await client.query(`SELECT id FROM public.application_logs WHERE id IN ('${LOG_ENCANTO_ID}','${LOG_B_ID}','${LOG_PLATFORM_ID}') ORDER BY id`);
      const ids = r.rows.map(x => x.id);
      const ok = ids.length === 1 && ids[0] === LOG_ENCANTO_ID;
      record('R5-2', 'authenticated(admin encanto)', 've so o log da propria loja, nunca o da loja B ou de plataforma', ok ? 'PASS' : 'FAIL', `ids=${JSON.stringify(ids)}`);
    }
    await client.query('RESET ROLE');

    out('— R5 · AUTHENTICATED super admin — as 3 linhas (inclusive store_id NULL) —');
    {
      await setRole('authenticated', SUPER_ID);
      const r = await client.query(`SELECT id FROM public.application_logs WHERE id IN ('${LOG_ENCANTO_ID}','${LOG_B_ID}','${LOG_PLATFORM_ID}')`);
      const ok = r.rowCount === 3;
      record('R5-3', 'authenticated(super admin)', 've as 3 linhas, inclusive a de plataforma (store_id NULL)', ok ? 'PASS' : 'FAIL', `rows=${r.rowCount}`);
    }
    await client.query('RESET ROLE');
    out('');

    // ---- R6 continuacao: quem consegue LER o evento gerado ----
    out('— R6 · leitura do evento via order_events (RLS por loja) —');
    {
      await setRole('authenticated', ADMIN_ENCANTO_ID);
      const r = await client.query(`SELECT id FROM public.order_events WHERE tipo='CLIENTE_ATUALIZADO' AND payload->>'customer_id' = '${CUSTOMER_B_ID}'`);
      const ok = r.rowCount === 0;
      record('R6-2', 'authenticated(admin encanto)', 'NAO ve o evento de cliente da loja B (antes via, achado R6)', ok ? 'PASS' : 'FAIL', `rows=${r.rowCount}`);
    }
    await client.query('RESET ROLE');
    {
      await setRole('authenticated', ADMIN_B_ID);
      const r = await client.query(`SELECT id FROM public.order_events WHERE tipo='CLIENTE_ATUALIZADO' AND payload->>'customer_id' = '${CUSTOMER_B_ID}'`);
      const ok = r.rowCount === 1;
      record('R6-3', 'authenticated(admin loja b)', 'VE o evento do proprio cliente (dono legitimo)', ok ? 'PASS' : 'FAIL', `rows=${r.rowCount}`);
    }
    await client.query('RESET ROLE');
    out('');

    // ---- R8: as 5 RPCs admin ----
    out('— R8 · ANON chamando as 5 RPCs administrativas DEVE ser negado (42501) —');
    const RPCS = [
      ["admin_orders_search", `SELECT public.admin_orders_search(NULL,NULL,10,NULL,NULL,'${encantoId}')`],
      ["admin_orders_stats",  `SELECT public.admin_orders_stats('${encantoId}')`],
      ["admin_reports_summary", `SELECT public.admin_reports_summary(CURRENT_DATE, CURRENT_DATE, '${encantoId}')`],
      ["admin_order_endereco", `SELECT public.admin_order_endereco('${STORE_B_ID}'::uuid, '${encantoId}')`],
      ["admin_find_loyalty",  `SELECT public.admin_find_loyalty('x','${encantoId}')`],
    ];
    for (const [i, [name, sql]] of RPCS.entries()) {
      await setRole('anon');
      let v = 'FAIL', d = '';
      const sp = `sp_r8_${i}`;
      await client.query(`SAVEPOINT ${sp}`);
      try { await client.query(sql); await client.query(`RELEASE SAVEPOINT ${sp}`); d = 'NAO foi negado (esperava 42501)'; }
      catch (e) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        if (e.code === '42501') { v = 'PASS'; d = 'permission denied (42501)'; } else { d = `code=${e.code} ${redact(e.message).split('\n')[0]}`; }
      }
      record(`R8-${i + 1}`, 'anon', `${name} negado por grant`, v, d);
      await client.query('RESET ROLE');
    }
    out('');

    out('— R8 · AUTHENTICATED admin real continua chamando as 5 sem erro de permissao —');
    {
      await setRole('authenticated', ADMIN_ENCANTO_ID);
      let allOk = true, details = [];
      for (const [j, [name, sql]] of RPCS.entries()) {
        const sp = `sp_r8b_${j}`;
        await client.query(`SAVEPOINT ${sp}`);
        try { await client.query(sql); await client.query(`RELEASE SAVEPOINT ${sp}`); details.push(`${name}=ok`); }
        catch (e) { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`); allOk = false; details.push(`${name}=ERRO(${e.code})`); }
      }
      record('R8-6', 'authenticated(admin encanto)', 'as 5 RPCs continuam acessiveis pra admin legitimo', allOk ? 'PASS' : 'FAIL', details.join(', '));
    }
    await client.query('RESET ROLE');
    out('');

    // ---- Regressao: INSERT em application_logs continua aberto pra anon ----
    out('— Regressao · anon AINDA insere em application_logs (INSERT nao foi tocado) —');
    {
      await setRole('anon');
      let v = 'FAIL', d = '';
      await client.query('SAVEPOINT sp_reg1');
      try {
        await client.query(`INSERT INTO public.application_logs (module, level, message) VALUES ('sec-data-01-regressao','info','probe anon insert')`);
        await client.query('RELEASE SAVEPOINT sp_reg1');
        v = 'PASS'; d = 'INSERT aceito (fallback do catalogo publico preservado)';
      } catch (e) { await client.query('ROLLBACK TO SAVEPOINT sp_reg1'); d = `negado inesperadamente: ${redact(e.message).split('\n')[0]}`; }
      record('REG-1', 'anon', 'INSERT em application_logs continua permitido', v, d);
      await client.query('RESET ROLE');
    }
    out('');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
  }

  out('— Resumo —  PASS: ' + passes + '  ·  FAIL: ' + failures);
  out('— Fingerprint — commit ' + git('rev-parse HEAD') + ' · branch ' + git('rev-parse --abbrev-ref HEAD') + ' · Node ' + process.version + ' · ' + (Date.now() - startedMs) + ' ms · started ' + startedIso);
  out('');

  const body = R.join('\n');
  const sha = createHash('sha256').update(body, 'utf8').digest('hex');
  console.log(body);
  console.log('— Execution Report SHA256 —\n  ' + sha + '\n');
  const state = failures ? 'FAILED' : 'SUCCESS';
  console.log('====================================');
  console.log('ETAPA — TESTES DA FASE (' + SCRIPT_NAME + ')');
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
