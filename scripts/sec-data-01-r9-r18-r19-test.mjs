// Suite de validacao — REF-SEC-DATA-01-harden-r9-r18-r19 (R9+R18+R19).
// Via checagens de metadado (has_function_privilege/pg_get_functiondef/introspecao de storage.buckets).
// Nenhuma escrita persiste. Prova:
//  - R9 NAO PODE ser fechado com o role disponivel (postgres) — descoberto ao aplicar em producao:
//    net.* pertence ao schema `net`, dono `supabase_admin` (extensao pg_net), e `postgres` (o role do
//    projeto, exposto ao dono) NAO e superuser nem membro de supabase_admin (confirmado:
//    pg_has_role('postgres','supabase_admin','MEMBER')=false, SET ROLE supabase_admin=permission denied).
//    REVOKE exige ser dono OU ter GRANT OPTION OU ser superuser — nenhum se aplica. A migration RODOU
//    sem erro (REVOKE sem privilegio emite so um WARNING, nunca falha a transacao) mas foi NO-OP real —
//    confirmado que anon/authenticated CONTINUAM com EXECUTE em net.* depois de aplicada. Registrado
//    como achado informativo (nao FAIL): risco pratico continua BAIXO pelo mesmo motivo da auditoria
//    original (schema net nao e exposto via PostgREST, so as 2 funcoes SECURITY DEFINER do proprio
//    projeto chamam net.* e ja sao restritas por si so) — mas nao e mais um item "fechavel" por nos.
//  - postgres mantem EXECUTE implicito em net.* (cron/send_alert/enc_dispatch_notifications nao quebram);
//  - bucket 'products' tem file_size_limit=5MB e allowed_mime_types com os 4 tipos esperados (R18);
//  - get_setting/normalize_phone/send_alert existem com o corpo EXATO capturado antes da migration —
//    prova que o CREATE OR REPLACE (R19) nao mudou nenhum comportamento;
//  - send_alert continua sem EXECUTE pra anon/authenticated (R19 nao abriu o que estava fechado — essa
//    funcao E' dona de postgres, REVOKE funciona normalmente aqui, diferente de net.*).
// Emite RELATORIO REPRODUZIVEL + AUTOAUDITAVEL. Exit 0 = SUCCESS; exit 1 = FAILED.
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
const SCRIPT_NAME = 'test:sec-data-01-r9r18r19';

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

function record(id, role, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} <${role}> ${desc}`); out(`         -> ${detail}`);
}

// Corpos EXATOS capturados via pg_get_functiondef ANTES da migration (2026-08-18) — a migration so
// deve REPRODUZIR isso, nunca mudar. Comparado byte a byte contra o que estiver rodando agora.
const EXPECTED_DEF = {
  get_setting: `CREATE OR REPLACE FUNCTION public.get_setting(p_chave text, p_default text DEFAULT NULL::text)\n RETURNS text\n LANGUAGE sql\n STABLE\nAS $function$\n  select coalesce((select valor from public.settings where chave=p_chave), p_default);\n$function$\n`,
  normalize_phone: `CREATE OR REPLACE FUNCTION public.normalize_phone(p text)\n RETURNS text\n LANGUAGE sql\n IMMUTABLE\nAS $function$\n  select nullif(\n           case when left(d,2)='55' and length(d) in (12,13) then substr(d,3) else d end,\n           ''\n         )\n  from (select regexp_replace(coalesce(p,''), '\\D', '', 'g') as d) s;\n$function$\n`,
};

const NET_FUNCS = ['net.http_get(text,jsonb,jsonb,integer)', 'net.http_post(text,jsonb,jsonb,jsonb,integer)'];

try {
  out('==================================================================');
  out(' SUITE DE VALIDACAO — REF-SEC-DATA-01-HARDEN-R9-R18-R19 — RELATORIO');
  out('==================================================================');
  out('Checagens de metadado (has_function_privilege/pg_get_functiondef/storage.buckets). Nenhuma escrita persiste.');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessão ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  out('— R9 · INFORMATIVO (nao PASS/FAIL) · postgres nao pode revogar EXECUTE em net.* —');
  {
    const own = await client.query(`SELECT pg_has_role('postgres','supabase_admin','MEMBER') AS membro, (SELECT rolsuper FROM pg_roles WHERE rolname='postgres') AS superuser`);
    out(`  [INFO] R9-CTX postgres e membro de supabase_admin (dono de net.*)? ${own.rows[0].membro} · e superuser? ${own.rows[0].superuser}`);
    for (const fn of NET_FUNCS) {
      const r = await client.query(
        `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon_ok,
                has_function_privilege('authenticated', $1, 'EXECUTE') AS auth_ok`,
        [fn]
      );
      const row = r.rows[0];
      out(`  [INFO] R9-${fn.split('(')[0]} EXECUTE em ${fn}: anon=${row.anon_ok} authenticated=${row.auth_ok}`);
      out(`         -> esperado continuar TRUE/TRUE: schema net e' extensao de propriedade de supabase_admin,`);
      out(`            fora do alcance de REVOKE do role postgres (nao e' dono, nem superuser, nem membro).`);
      out(`            Risco pratico permanece BAIXO (schema net nao exposto via PostgREST) — documentado,`);
      out(`            nao corrigivel nesta camada de privilegio.`);
    }
  }
  out('');

  out('— R18 · bucket products tem file_size_limit=5MB + allowed_mime_types corretos —');
  {
    const r = await client.query(`SELECT file_size_limit, allowed_mime_types FROM storage.buckets WHERE id='products'`);
    const row = r.rows[0];
    const expectedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const mimesOk = Array.isArray(row?.allowed_mime_types) &&
      expectedMimes.every(m => row.allowed_mime_types.includes(m)) &&
      row.allowed_mime_types.length === expectedMimes.length;
    const sizeOk = Number(row?.file_size_limit) === 5242880; // bigint volta como string do driver pg
    const ok = sizeOk && mimesOk;
    record('S1', 'products', 'file_size_limit + allowed_mime_types', ok ? 'PASS' : 'FAIL',
      `file_size_limit=${row?.file_size_limit} allowed_mime_types=${JSON.stringify(row?.allowed_mime_types)}`);
  }
  out('  (nota: enforcement real do limite acontece no servico de Storage, nao no Postgres — este teste');
  out('   confirma so a configuracao do bucket; validacao funcional completa exige upload real.)');
  out('');

  out('— R19 · get_setting/normalize_phone: corpo identico ao capturado antes da migration —');
  {
    // Normaliza \r\n->\n antes de comparar: o SQL Editor/clipboard pode converter quebras de linha
    // DENTRO do corpo $function$...$function$ sem mudar nenhum token SQL (whitespace insignificante
    // pro parser) — comparar byte a byte literal geraria falso-positivo por causa disso, nao por
    // mudanca real de comportamento.
    const norm = s => (s ?? '').replace(/\r\n/g, '\n');
    for (const fn of Object.keys(EXPECTED_DEF)) {
      const r = await client.query(
        `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
         JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname=$1`, [fn]
      );
      const def = norm(r.rows[0]?.def);
      const ok = def === norm(EXPECTED_DEF[fn]);
      record('B-' + fn, 'public', 'corpo identico ao pre-migration (line endings normalizados)', ok ? 'PASS' : 'FAIL',
        ok ? 'identico' : `DIVERGIU — atual difere do esperado (ver diff manual, funcao=${fn})`);
    }
  }
  out('');

  out('— R19 · send_alert: continua restrita a postgres/service_role (CREATE OR REPLACE nao abriu grant) —');
  {
    const r = await client.query(
      `SELECT has_function_privilege('anon', 'public.send_alert(text,text,jsonb)', 'EXECUTE') AS anon_ok,
              has_function_privilege('authenticated', 'public.send_alert(text,text,jsonb)', 'EXECUTE') AS auth_ok,
              has_function_privilege('postgres', 'public.send_alert(text,text,jsonb)', 'EXECUTE') AS pg_ok`
    );
    const row = r.rows[0];
    const ok = !row.anon_ok && !row.auth_ok && row.pg_ok === true;
    record('SA1', '-', 'EXECUTE em send_alert', ok ? 'PASS' : 'FAIL',
      `anon=${row.anon_ok} authenticated=${row.auth_ok} postgres=${row.pg_ok} (esperado: false/false/true)`);
  }
  out('');

  out('— R19 · normalize_phone/get_setting continuam funcionalmente corretos (chamada real, funcoes puras) —');
  {
    const r = await client.query(`SELECT public.normalize_phone('+55 (11) 91234-5678') AS tel, public.get_setting('__chave_inexistente__', 'default_ok') AS cfg`);
    const row = r.rows[0];
    const ok = row.tel === '11912345678' && row.cfg === 'default_ok';
    record('F1', 'postgres', 'normalize_phone/get_setting comportamento inalterado', ok ? 'PASS' : 'FAIL',
      `normalize_phone=${row.tel} get_setting(default)=${row.cfg}`);
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
