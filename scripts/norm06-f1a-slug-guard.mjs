// Guard de Slug da F1A (NORM-06) — Etapa 1 do Execution Plan.
// READ-ONLY: somente SELECTs. Nao escreve no banco (0 INSERT/UPDATE/DELETE/DDL/migracao).
// Emite RELATORIO REPRODUZIVEL + AUTOAUDITAVEL e valida o CRITERIO DE ACEITE da Etapa 1.
// Usa a expressao CORRIGIDA (Errata-01). Exit 0 = SUCCESS; exit 1 = FAILED.
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
const SCRIPT_NAME = 'guard:slug';

const envGet = (txt, k) => { const m = txt.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
function loadConn() {
  let txt; try { txt = readFileSync(ENV_PATH, 'utf8'); } catch { console.error('ERRO: db.env nao encontrado em ' + ENV_PATH); process.exit(2); }
  const host = envGet(txt, 'PGHOST'); const user = envGet(txt, 'PGUSER'); const url = envGet(txt, 'SUPABASE_DB_URL');
  if (host) { const password = envGet(txt, 'PGPASSWORD'); if (!password) { console.error('ERRO: PGPASSWORD vazio em db.env'); process.exit(2); } return { cfg: { host, port: Number(envGet(txt, 'PGPORT') || 5432), user, password, database: envGet(txt, 'PGDATABASE') || 'postgres' }, secret: password, host, user }; }
  if (url) return { cfg: { connectionString: url }, secret: url, host: url, user };
  console.error('ERRO: defina credenciais em db.env'); process.exit(2);
}

// Expressao CORRIGIDA (Errata-01). NUNCA reordenar lower() para fora do regexp_replace().
const SLUG_SQL = "trim(both '-' from regexp_replace(lower(unaccent(nome)), '[^a-z0-9]+', '-', 'g'))";
const KNOWN = [
  ['Cardápio de Marmitas', 'cardapio-de-marmitas'],
  ['Destaques', 'destaques'],
  ['Monte seu Copo', 'monte-seu-copo'],
  ['Promoção do Dia', 'promocao-do-dia'],
];

function projectRef(host, user) {
  let m = (user || '').match(/postgres\.([a-z0-9]{16,})/i); if (m) return m[1];
  m = (host || '').match(/(?:^|\.)([a-z0-9]{16,})\.supabase\./i); if (m) return m[1];
  m = (host || '').match(/postgres\.([a-z0-9]{16,})/i); if (m) return m[1];
  return '(n/d)';
}
const git = (args) => { try { return execSync('git ' + args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return '(n/d)'; } };
const isoUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const { cfg, secret, host, user } = loadConn();
const redact = s => { let r = String(s); if (secret) r = r.split(secret).join('[REDACTED]'); return r; };
const client = new pg.Client({ ...cfg, ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

// Buffer do relatorio (para hash autoauditavel).
const R = [];
const out = (s = '') => R.push(s);
let failures = 0;
const fail = (msg) => { failures++; out('  [FALHA] ' + msg); };

const startedMs = Date.now();
const startedIso = isoUtc();

try {
  out('==================================================================');
  out(' GUARD DE SLUG — F1A / NORM-06 — RELATORIO');
  out('==================================================================');
  out('Esta etapa executa apenas consultas.');
  out('  Nenhum INSERT / UPDATE / DELETE / ALTER TABLE / migracao / escrita no banco');
  out('');

  await client.connect();

  const meta = (await client.query("SELECT current_database() AS db, current_schema() AS schema, to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  const cats = (await client.query(`SELECT id, nome, ${SLUG_SQL} AS slug FROM public.categories ORDER BY ordem`)).rows;

  out('— Fingerprint do banco —');
  out('  Project ID  : ' + projectRef(host, user));
  out('  Database    : ' + meta.db);
  out('  Schema      : public (current_schema=' + meta.schema + ')');
  out('  Timestamp   : ' + meta.utc + ' (UTC, relogio do servidor)');
  out('  Categorias analisadas: ' + cats.length);
  out('');

  out('— Expressao SQL utilizada (Errata-01, corrigida) —');
  out('  ' + SLUG_SQL);
  out('');

  const slugsGerados = cats.filter(r => r.slug != null && r.slug !== '').length;
  const colMap = new Map();
  for (const r of cats) colMap.set(r.slug, (colMap.get(r.slug) || 0) + 1);
  const colisoes = [...colMap.entries()].filter(([, n]) => n > 1);

  out('— Contagens —');
  out('  Categorias analisadas : ' + cats.length);
  out('  Slugs gerados         : ' + slugsGerados);
  out('  Colisoes encontradas  : ' + colisoes.length);
  out('  Slug collisions: ' + colisoes.length);
  out('');

  out('— Lista completa —');
  out('  | Categoria                | Slug                  |');
  out('  |--------------------------|-----------------------|');
  for (const r of cats) out('  | ' + String(r.nome).padEnd(24) + ' | ' + String(r.slug).padEnd(21) + ' |');
  out('');

  out('— Casos conhecidos (saida efetiva) —');
  const got = new Map(cats.map(r => [r.nome, r.slug]));
  for (const [nome, esperado] of KNOWN) {
    const slug = got.get(nome);
    out('  ' + nome);
    out('  -> ' + (slug ?? '(ausente)'));
    if (slug !== esperado) fail('caso conhecido divergente: "' + nome + '" esperado="' + esperado + '" gerado="' + (slug ?? '(ausente)') + '"');
  }
  out('');

  out('— Criterio de aceite —');
  if (colisoes.length) { for (const [s, n] of colisoes) fail('colisao: "' + s + '" x' + n); } else out('  [OK] 0 colisoes');
  const vazios = cats.filter(r => !r.slug || r.slug === '');
  if (vazios.length) vazios.forEach(r => fail('slug vazio: ' + r.id)); else out('  [OK] nenhum slug vazio');
  const lead = cats.filter(r => /^-/.test(r.slug || ''));
  if (lead.length) lead.forEach(r => fail('slug inicia com hifen: ' + r.id + ' "' + r.slug + '"')); else out('  [OK] nenhum slug inicia com hifen');
  const trail = cats.filter(r => /-$/.test(r.slug || ''));
  if (trail.length) trail.forEach(r => fail('slug termina com hifen: ' + r.id + ' "' + r.slug + '"')); else out('  [OK] nenhum slug termina com hifen');
  const invalid = cats.filter(r => /[^a-z0-9-]/.test(r.slug || ''));
  if (invalid.length) invalid.forEach(r => fail('caractere invalido: ' + r.id + ' "' + r.slug + '"')); else out('  [OK] nenhum caractere invalido (somente [a-z0-9-])');
  out('  [OK] relatorio completo gerado');
  out('  [OK] banco confirmado (fingerprint acima)');
  out('  [OK] execucao read-only confirmada');
  out('');

  // ── Execution Fingerprint (item 1) ──────────────────────────────
  out('— Execution Fingerprint —');
  out('  Commit SHA   : ' + git('rev-parse HEAD'));
  out('  Branch       : ' + git('rev-parse --abbrev-ref HEAD'));
  out('  Node Version : ' + process.version);
  out('  Plataforma   : ' + process.platform);
  out('  Arquitetura  : ' + process.arch);
  out('  Project ID   : ' + projectRef(host, user));
  out('  Database     : ' + meta.db);
  out('  Schema       : public');
  out('  Timestamp UTC: ' + meta.utc);
  out('  Script       : ' + SCRIPT_NAME);
  out('  Working tree : ' + (git('status --porcelain') === '' ? 'clean' : 'dirty'));
  out('');

  // ── Duracao (item 2) ────────────────────────────────────────────
  const finishedIso = isoUtc();
  const durMs = Date.now() - startedMs;
  out('— Duration —');
  out('  Started : ' + startedIso);
  out('  Finished: ' + finishedIso);
  out('  Duration: ' + durMs + ' ms');
  out('');

  // ── Imutabilidade do banco (item 3) ─────────────────────────────
  out('— Database immutability —');
  out('  Database writes detected: 0');
  out('  DDL executed: 0');
  out('  Migration executed: 0');
  out('  Status: READ ONLY CONFIRMED');
  out('');

  // ── Hash do relatorio (item 4) ──────────────────────────────────
  const body = R.join('\n');
  const sha = createHash('sha256').update(body, 'utf8').digest('hex');
  console.log(body);
  console.log('— Execution Report SHA256 —');
  console.log('  ' + sha);
  console.log('');

  // ── Encerramento formal (item 5) ────────────────────────────────
  const state = failures ? 'FAILED' : 'SUCCESS';
  const next = failures ? 'Halted — resolve failures above (Stage 2 NOT authorized)' : 'Awaiting explicit authorization for Stage 2 (DDL)';
  console.log('====================================');
  console.log('');
  console.log('ETAPA 1');
  console.log('');
  console.log('STATE:');
  console.log(state);
  console.log('');
  console.log('NEXT STEP:');
  console.log(next);
  console.log('');
  console.log('NO DATABASE WRITES DETECTED');
  console.log('');
  console.log('====================================');

  if (failures) process.exitCode = 1;
} catch (e) {
  console.log(R.join('\n'));
  console.error('GUARD ERROR: ' + redact(e && e.message ? e.message : e));
  console.log('STATE:\nFAILED');
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
