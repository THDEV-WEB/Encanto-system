// Suite de RLS/RPC do CRONOGRAMA SEMANAL (REF-BUSINESS-HOURS-04) — get/set_business_hours_schedule.
// Via SET LOCAL ROLE anon/authenticated em BEGIN..ROLLBACK (net-zero). Prova:
//  - anon LÊ o cronograma via RPC (get_business_hours_schedule) — a loja precisa exibir aberto/fechado;
//  - anon NÃO escreve (set_business_hours_schedule -> 42501, grant revogado + is_admin() nega);
//  - authenticated NÃO-admin também não escreve (42501 — is_admin() decide, não a sessão autenticada por si só);
//  - authenticated ADMIN escreve um cronograma válido e o RPC devolve o objeto CANÔNICO persistido
//    (periodos ordenados, version/timezone normalizados);
//  - o RPC revalida no SERVIDOR mesmo que o cliente falhe em bloquear: dia ausente, fim<=início, período
//    fora de 00:00-23:59, período sobreposto e período duplicado devem ser todos rejeitados (22023).
// Emite RELATÓRIO REPRODUZÍVEL. Exit 0 = SUCCESS; exit 1 = FAILED. Requer a migration
// REF-BUSINESS-HOURS-04-schedule-rpc.sql já aplicada (get/set_business_hours_schedule existentes).
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

const DIAS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
/* devolve um literal SQL PRONTO PARA USO: 'json...'::jsonb precisa das aspas simples ao redor do texto —
   sem elas o parser SQL le o '{' como inicio de bloco e quebra (42601). Escapa aspas simples (SQL '' )
   por seguranca, mesmo que os dados de teste hoje nunca as contenham. */
const sqlJsonLiteral = (obj) => `'${JSON.stringify(obj).replace(/'/g, "''")}'`;
const cronogramaValido = (over = {}) => sqlJsonLiteral({
  schedule: {
    domingo: { fechado: true, periodos: [] },
    segunda: { fechado: false, periodos: [{ ini: '08:00', fim: '12:00' }] },
    terca: { fechado: false, periodos: [{ ini: '10:00', fim: '15:00' }, { ini: '17:00', fim: '22:00' }] },
    quarta: { fechado: false, periodos: [{ ini: '10:00', fim: '15:00' }] },
    quinta: { fechado: false, periodos: [{ ini: '10:00', fim: '15:00' }] },
    sexta: { fechado: false, periodos: [{ ini: '10:00', fim: '15:00' }] },
    sabado: { fechado: false, periodos: [{ ini: '10:00', fim: '15:00' }] },
    ...over,
  },
  exceptions: {},
});

let ADMIN_UID = null;
async function tx(role, fn, { jwtSub = null } = {}) {
  try {
    await client.query('BEGIN');
    const sub = role === 'authenticated' ? (jwtSub ?? ADMIN_UID) : null;
    if (role === 'authenticated' && sub) await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: 'authenticated' })]);
    await client.query(`SET LOCAL ROLE ${role}`);
    return await fn();
  } finally { await client.query('ROLLBACK').catch(() => {}); }
}
function record(id, role, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} <${role}> ${desc}`); out(`         -> ${detail}`);
}
async function expectDenied(id, role, desc, code, sql, opts) {
  let verdict = 'FAIL', detail = '';
  await tx(role, async () => {
    try { await client.query(sql); detail = `NAO foi negado (esperava ${code})`; verdict = 'FAIL'; }
    catch (e) {
      if (e.code === code) { verdict = 'PASS'; detail = `${e.code}: ${redact(e.message).split('\n')[0]}`; }
      else { verdict = 'FAIL'; detail = `negado por outro motivo (esperava ${code}): code=${e.code} ${redact(e.message).split('\n')[0]}`; }
    }
  }, opts);
  record(id, role, desc, verdict, detail);
}

try {
  out('==================================================================');
  out(' SUITE RPC — CRONOGRAMA SEMANAL (REF-BUSINESS-HOURS-04) — RELATORIO');
  out('==================================================================');
  out('SET LOCAL ROLE anon/authenticated em BEGIN..ROLLBACK. Nenhuma escrita persiste.');
  out('');
  await client.connect();
  ADMIN_UID = (await client.query("SELECT a.user_id FROM public.admins a LIMIT 1")).rows[0]?.user_id
    || (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 1')).rows[0]?.id;
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessão ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');
  const before = (await client.query("SELECT valor FROM public.settings WHERE chave='business_hours_schedule'")).rows[0]?.valor ?? null;

  out('— ANON · leitura via RPC (get_business_hours_schedule) DEVE funcionar —');
  {
    let v = 'FAIL', d = '';
    await tx('anon', async () => {
      const r = (await client.query('SELECT public.get_business_hours_schedule() AS s')).rows[0].s;
      const temTodosDias = DIAS.every((dia) => r?.schedule && Object.prototype.hasOwnProperty.call(r.schedule, dia));
      v = (r && r.version === 1 && r.timezone === 'America/Sao_Paulo' && temTodosDias) ? 'PASS' : 'FAIL';
      d = v === 'PASS' ? `objeto com os 7 dias, version=${r.version}, timezone=${r.timezone}` : 'formato inesperado: ' + JSON.stringify(r);
    });
    record('R1', 'anon', 'get_business_hours_schedule devolve documento completo', v, d);
  }
  out('');

  out('— ANON / AUTHENTICATED não-admin · escrita DEVE ser negada (42501) —');
  await expectDenied('W1', 'anon', 'set_business_hours_schedule (anon)', '42501',
    `SELECT public.set_business_hours_schedule(${cronogramaValido()}::jsonb)`);
  await expectDenied('W2', 'authenticated', 'set_business_hours_schedule (autenticado, NAO admin)', '42501',
    `SELECT public.set_business_hours_schedule(${cronogramaValido()}::jsonb)`,
    { jwtSub: '00000000-0000-0000-0000-000000000000' });
  out('');

  if (!ADMIN_UID) {
    out('  [SKIP] nenhum admin encontrado em public.admins — pulando os testes de ADMIN (W3+/V*)');
  } else {
    out('— AUTHENTICATED (admin) · escrita VÁLIDA deve funcionar e devolver o objeto canônico —');
    {
      let v = 'FAIL', d = '';
      await tx('authenticated', async () => {
        const r = (await client.query(`SELECT public.set_business_hours_schedule(${cronogramaValido()}::jsonb) AS s`)).rows[0].s;
        const seg = r?.schedule?.segunda;
        v = (seg && seg.periodos.length === 1 && seg.periodos[0].ini === '08:00') ? 'PASS' : 'FAIL';
        d = v === 'PASS' ? 'segunda persistida com o período enviado' : 'retorno inesperado: ' + JSON.stringify(r);
      });
      record('W3', 'authenticated', 'set_business_hours_schedule (admin, payload válido)', v, d);
    }
    {
      let v = 'FAIL', d = '';
      await tx('authenticated', async () => {
        const semOrdem = cronogramaValido({ terca: { fechado: false, periodos: [{ ini: '17:00', fim: '22:00' }, { ini: '10:00', fim: '15:00' }] } });
        const r = (await client.query(`SELECT public.set_business_hours_schedule(${semOrdem}::jsonb) AS s`)).rows[0].s;
        const p = r?.schedule?.terca?.periodos ?? [];
        v = (p.length === 2 && p[0].ini === '10:00' && p[1].ini === '17:00') ? 'PASS' : 'FAIL';
        d = v === 'PASS' ? 'servidor devolveu terca ORDENADA por início, mesmo enviado fora de ordem' : 'ordem inesperada: ' + JSON.stringify(p);
      });
      record('W4', 'authenticated', 'set_business_hours_schedule ordena períodos (forma canônica)', v, d);
    }

    out('');
    out('— AUTHENTICATED (admin) · VALIDAÇÃO server-side (revalida mesmo com payload malformado) —');
    await expectDenied('V1', 'authenticated', 'dia ausente no objeto "schedule"', '22023',
      `SELECT public.set_business_hours_schedule('{"schedule":{"segunda":{"fechado":false,"periodos":[]}}}'::jsonb)`);
    await expectDenied('V2', 'authenticated', 'fim <= início', '22023',
      `SELECT public.set_business_hours_schedule(${cronogramaValido({ segunda: { fechado: false, periodos: [{ ini: '15:00', fim: '10:00' }] } })}::jsonb)`);
    await expectDenied('V3', 'authenticated', 'horário fora de 00:00-23:59', '22023',
      `SELECT public.set_business_hours_schedule(${cronogramaValido({ segunda: { fechado: false, periodos: [{ ini: '24:30', fim: '25:00' }] } })}::jsonb)`);
    await expectDenied('V4', 'authenticated', 'períodos sobrepostos', '22023',
      `SELECT public.set_business_hours_schedule(${cronogramaValido({ segunda: { fechado: false, periodos: [{ ini: '08:00', fim: '12:00' }, { ini: '11:00', fim: '14:00' }] } })}::jsonb)`);
    await expectDenied('V5', 'authenticated', 'períodos duplicados', '22023',
      `SELECT public.set_business_hours_schedule(${cronogramaValido({ segunda: { fechado: false, periodos: [{ ini: '08:00', fim: '12:00' }, { ini: '08:00', fim: '12:00' }] } })}::jsonb)`);
    await expectDenied('V6', 'authenticated', '"fechado" não-booleano', '22023',
      `SELECT public.set_business_hours_schedule(${cronogramaValido({ segunda: { fechado: 'sim', periodos: [] } })}::jsonb)`);
  }
  out('');

  const after = (await client.query("SELECT valor FROM public.settings WHERE chave='business_hours_schedule'")).rows[0]?.valor ?? null;
  out('— Mutação líquida (antes == depois) —');
  const eq = before === after;
  if (!eq) failures++;
  out(`  business_hours_schedule : ${eq ? 'inalterado' : 'DRIFT DETECTADO'}`);
  out(eq ? '  Net DB change: 0.' : '  [FALHA] mutação líquida detectada.');
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
  console.log('ETAPA — TESTES DA FASE (REF-BUSINESS-HOURS-04)');
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
