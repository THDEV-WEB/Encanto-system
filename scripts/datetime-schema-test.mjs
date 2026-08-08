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

  // REF-SAAS-01 · Onda 4.1 (2026-08-08): orders_health() passou a exigir is_admin_of(p_store_id) --
  // antes nao tinha checagem nenhuma (achado de seguranca pre-existente fechado naquela onda). Esta
  // suite so le (sem BEGIN/ROLLBACK, sem SET ROLE), entao simula a identidade do admin real via GUC de
  // sessao (nao-local: sobrevive fora de transacao, nao grava nada) -- p_store_id usa o DEFAULT
  // (default_store_id() -> encanto), sem precisar mudar nenhuma chamada abaixo.
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: 'b9dc7626-af9c-4ab5-95f7-3207e6469129', role: 'authenticated' })]);

  out('— Pre-requisito: orders_health() ja tem o fix aplicado (Fase 1: AT TIME ZONE inline, OU Fase 2a: dia_loja()) —');
  {
    const src = (await client.query(`SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='orders_health'`)).rows[0]?.def || '';
    const semCurrentDate = !src.includes('current_date');
    // Fase 1 escreve AT TIME ZONE 'America/Sao_Paulo' inline; Fase 2a simplifica pra dia_loja()
    // (que ja embute o fuso por dentro) — a string 'America/Sao_Paulo' some do corpo de
    // orders_health() nesse caso, sem que isso signifique regressao. Aceita qualquer um dos 2 sinais.
    const comFusoInline = src.includes('America/Sao_Paulo');
    const comDiaLoja = src.includes('dia_loja(');
    const ok = semCurrentDate && (comFusoInline || comDiaLoja);
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] DT1 orders_health() usa fuso da loja, nao current_date cru`);
    out(`         -> sem 'current_date': ${semCurrentDate} · AT TIME ZONE inline (Fase 1): ${comFusoInline} · dia_loja() (Fase 2a): ${comDiaLoja}`);
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

  out('— Fase 2a (REF-DATETIME-01b-schema-timestamptz): checks condicionais —');
  {
    const hasDiaLoja = (await client.query(`SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='dia_loja'`)).rowCount > 0;
    if (!hasDiaLoja) {
      out('  [SKIP] Fase 2a ainda nao aplicada (dia_loja() nao existe) — rode migrations/REF-DATETIME-01b-schema-timestamptz.sql para habilitar DT4/DT5/DT6.');
    } else {
      // DT4 — as 9 colunas-base agora sao timestamptz.
      {
        const need = ['orders', 'order_events', 'customers', 'products', 'categories', 'addresses', 'adicionais', 'settings', 'application_logs'];
        const r = await client.query(`SELECT table_name, data_type FROM information_schema.columns WHERE table_schema='public' AND column_name='created_at' AND table_name = ANY($1)`, [need]);
        const naive = r.rows.filter(x => x.data_type !== 'timestamp with time zone').map(x => x.table_name);
        const achadas = r.rows.map(x => x.table_name);
        const faltando = need.filter(t => !achadas.includes(t));
        const ok = naive.length === 0 && faltando.length === 0;
        if (ok) passes++; else failures++;
        out(`  [${ok ? 'PASS' : 'FAIL'}] DT4 9 colunas created_at sao timestamptz`);
        out(`         -> ${ok ? 'todas as 9 confirmadas timestamptz' : 'ainda naive: ' + naive.join(',') + (faltando.length ? ' | tabela(s) nao encontrada(s): ' + faltando.join(',') : '')}`);
      }
      out('');

      // DT5 — grants de admin_orders_search batem com o baseline capturado na auditoria (2026-07-27).
      {
        const BASELINE = ['PUBLIC', 'anon', 'authenticated', 'postgres', 'service_role'].sort();
        const r = await client.query(`SELECT grantee FROM information_schema.routine_privileges WHERE routine_schema='public' AND routine_name='admin_orders_search' AND privilege_type='EXECUTE' ORDER BY grantee`);
        const atual = r.rows.map(x => x.grantee).sort();
        const ok = JSON.stringify(atual) === JSON.stringify(BASELINE);
        if (ok) passes++; else failures++;
        out(`  [${ok ? 'PASS' : 'FAIL'}] DT5 grants EXECUTE de admin_orders_search == baseline pre-migration`);
        out(`         -> baseline: [${BASELINE.join(', ')}] · atual: [${atual.join(', ')}]`);
      }
      out('');

      // DT6 — dia_loja() sanity: instante perto da meia-noite UTC cai no dia local anterior.
      {
        const r = (await client.query(`SELECT public.dia_loja('2026-01-15 02:00:00+00'::timestamptz) AS d`)).rows[0];
        const iso = r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10);
        const ok = iso === '2026-01-14';
        if (ok) passes++; else failures++;
        out(`  [${ok ? 'PASS' : 'FAIL'}] DT6 dia_loja('2026-01-15 02:00:00+00') = 2026-01-14 (America/Sao_Paulo)`);
        out(`         -> obtido: ${iso}`);
      }
      out('');

      // DT7 — admin_orders_search pagina normalmente com cursor timestamptz.
      {
        let v = 'FAIL', d = '';
        try {
          const r = await client.query(`SELECT * FROM public.admin_orders_search(null, null, 3, null, null)`);
          v = 'PASS'; d = `retornou ${r.rowCount} linha(s) sem erro`;
        } catch (e) { v = 'FAIL'; d = redact(e.message).split('\n')[0]; }
        record('DT7', 'admin_orders_search(null,null,3,null,null) executa sem erro', v, d);
      }
      out('');

      // DT8 — order_logs/order_status_durations sobreviveram ao DROP+CREATE com security_invoker=true
      // (perder isso seria regressao de seguranca: a view voltaria a rodar como o DONO, ignorando RLS).
      {
        const r = await client.query(`SELECT relname, reloptions FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('order_logs','order_status_durations')`);
        const byName = Object.fromEntries(r.rows.map(x => [x.relname, x.reloptions || []]));
        const okLogs = (byName.order_logs || []).includes('security_invoker=true');
        const okDur = (byName.order_status_durations || []).includes('security_invoker=true');
        const ok = r.rowCount === 2 && okLogs && okDur;
        if (ok) passes++; else failures++;
        out(`  [${ok ? 'PASS' : 'FAIL'}] DT8 order_logs + order_status_durations existem com security_invoker=true`);
        out(`         -> encontradas: ${r.rowCount}/2 · order_logs=${JSON.stringify(byName.order_logs)} · order_status_durations=${JSON.stringify(byName.order_status_durations)}`);
      }
      out('');

      // DT9 — as 2 views seguem consultaveis (sobreviveram ao DROP+CREATE em torno do ALTER).
      {
        let v = 'FAIL', d = '';
        try {
          const a = await client.query(`SELECT count(*)::int AS n FROM public.order_logs`);
          const b = await client.query(`SELECT count(*)::int AS n FROM public.order_status_durations`);
          v = 'PASS'; d = `order_logs=${a.rows[0].n} linha(s) · order_status_durations=${b.rows[0].n} linha(s)`;
        } catch (e) { v = 'FAIL'; d = redact(e.message).split('\n')[0]; }
        record('DT9', 'order_logs/order_status_durations sao consultaveis sem erro', v, d);
      }
      out('');
    }
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
