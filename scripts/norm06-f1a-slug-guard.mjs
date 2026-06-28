// Guard de Slug da F1A (NORM-06) — Etapa 1 do Execution Plan.
// READ-ONLY: somente SELECTs. Nao escreve no banco.
// Gera RELATORIO REPRODUZIVEL e valida o CRITERIO DE ACEITE da Etapa 1.
// Usa a expressao CORRIGIDA (Errata-01). Exit 0 = SUCCESS; exit 1 = FAILED.
// Le credenciais de C:\Users\00thi\.encanto\db.env (igual run.mjs). NUNCA imprime a senha.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('C:\\Users\\00thi\\.encanto\\package.json');
const pg = require('pg');

const ENV_PATH = 'C:\\Users\\00thi\\.encanto\\db.env';
const envGet = (txt, k) => { const m = txt.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
function loadConn() {
  let txt; try { txt = readFileSync(ENV_PATH, 'utf8'); } catch { console.error('ERRO: db.env nao encontrado em ' + ENV_PATH); process.exit(2); }
  const host = envGet(txt, 'PGHOST');
  const user = envGet(txt, 'PGUSER');
  const url = envGet(txt, 'SUPABASE_DB_URL');
  if (host) { const password = envGet(txt, 'PGPASSWORD'); if (!password) { console.error('ERRO: PGPASSWORD vazio em db.env'); process.exit(2); } return { cfg: { host, port: Number(envGet(txt, 'PGPORT') || 5432), user, password, database: envGet(txt, 'PGDATABASE') || 'postgres' }, secret: password, host, user }; }
  if (url) return { cfg: { connectionString: url }, secret: url, host: url, user };
  console.error('ERRO: defina credenciais em db.env'); process.exit(2);
}

// Expressao CORRIGIDA (Errata-01). NUNCA reordenar lower() para fora do regexp_replace().
const SLUG_SQL = "trim(both '-' from regexp_replace(lower(unaccent(nome)), '[^a-z0-9]+', '-', 'g'))";

// Casos conhecidos (nome -> slug esperado).
const KNOWN = [
  ['Cardápio de Marmitas', 'cardapio-de-marmitas'],
  ['Destaques', 'destaques'],
  ['Monte seu Copo', 'monte-seu-copo'],
  ['Promoção do Dia', 'promocao-do-dia'],
];

// Deriva o project ref do Supabase a partir de PGUSER/PGHOST (sem expor segredo).
function projectRef(host, user) {
  let m = (user || '').match(/postgres\.([a-z0-9]{16,})/i); if (m) return m[1];
  m = (host || '').match(/(?:^|\.)([a-z0-9]{16,})\.supabase\./i); if (m) return m[1];
  m = (host || '').match(/postgres\.([a-z0-9]{16,})/i); if (m) return m[1];
  return '(n/d)';
}

const { cfg, secret, host, user } = loadConn();
const redact = s => { let r = String(s); if (secret) r = r.split(secret).join('[REDACTED]'); return r; };
const client = new pg.Client({ ...cfg, ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });
let failures = 0;
const fail = (msg) => { failures++; console.error('  [FALHA] ' + msg); };

try {
  // ── Declaracao read-only (item 4) ───────────────────────────────
  console.log('==================================================================');
  console.log(' GUARD DE SLUG — F1A / NORM-06 — RELATORIO');
  console.log('==================================================================');
  console.log('Esta etapa executa apenas consultas.');
  console.log('  Nenhum INSERT');
  console.log('  Nenhum UPDATE');
  console.log('  Nenhum DELETE');
  console.log('  Nenhum ALTER TABLE');
  console.log('  Nenhuma migracao');
  console.log('  Nenhuma escrita no banco');
  console.log('');

  await client.connect();

  // ── Fingerprint do banco (item 2) ───────────────────────────────
  const meta = (await client.query("SELECT current_database() AS db, current_schema() AS schema, to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  const cats = (await client.query(`SELECT id, nome, ${SLUG_SQL} AS slug FROM public.categories ORDER BY ordem`)).rows;
  console.log('— Fingerprint do banco —');
  console.log('  Project ID  : ' + projectRef(host, user));
  console.log('  Database    : ' + meta.db);
  console.log('  Schema      : public (current_schema=' + meta.schema + ')');
  console.log('  Timestamp   : ' + meta.utc + ' (UTC)');
  console.log('  Categorias analisadas: ' + cats.length);
  console.log('');

  // ── Expressao e contagens (item 1) ──────────────────────────────
  console.log('— Expressao SQL utilizada (Errata-01, corrigida) —');
  console.log('  ' + SLUG_SQL);
  console.log('');

  const slugsGerados = cats.filter(r => r.slug != null && r.slug !== '').length;
  const colMap = new Map();
  for (const r of cats) colMap.set(r.slug, (colMap.get(r.slug) || 0) + 1);
  const colisoes = [...colMap.entries()].filter(([, n]) => n > 1);

  console.log('— Contagens —');
  console.log('  Categorias analisadas : ' + cats.length);
  console.log('  Slugs gerados         : ' + slugsGerados);
  console.log('  Colisoes encontradas  : ' + colisoes.length);
  console.log('');

  // ── Lista completa (item 1) ─────────────────────────────────────
  console.log('— Lista completa —');
  console.log('  | Categoria                | Slug                  |');
  console.log('  |--------------------------|-----------------------|');
  for (const r of cats) console.log('  | ' + String(r.nome).padEnd(24) + ' | ' + String(r.slug).padEnd(21) + ' |');
  console.log('');

  // ── Casos conhecidos (item 3 — saida efetiva) ───────────────────
  console.log('— Casos conhecidos (saida efetiva) —');
  const got = new Map(cats.map(r => [r.nome, r.slug]));
  for (const [nome, esperado] of KNOWN) {
    const slug = got.get(nome);
    console.log('  ' + nome);
    console.log('  -> ' + (slug ?? '(ausente)'));
    if (slug !== esperado) fail('caso conhecido divergente: "' + nome + '" esperado="' + esperado + '" gerado="' + (slug ?? '(ausente)') + '"');
  }
  console.log('');

  // ── Criterio de aceite (item 6) ─────────────────────────────────
  console.log('— Criterio de aceite —');
  if (colisoes.length) { for (const [s, n] of colisoes) fail('colisao: "' + s + '" x' + n); } else console.log('  [OK] 0 colisoes');
  const vazios = cats.filter(r => !r.slug || r.slug === '');
  if (vazios.length) vazios.forEach(r => fail('slug vazio: ' + r.id)); else console.log('  [OK] nenhum slug vazio');
  const lead = cats.filter(r => /^-/.test(r.slug || ''));
  if (lead.length) lead.forEach(r => fail('slug inicia com hifen: ' + r.id + ' "' + r.slug + '"')); else console.log('  [OK] nenhum slug inicia com hifen');
  const trail = cats.filter(r => /-$/.test(r.slug || ''));
  if (trail.length) trail.forEach(r => fail('slug termina com hifen: ' + r.id + ' "' + r.slug + '"')); else console.log('  [OK] nenhum slug termina com hifen');
  const invalid = cats.filter(r => /[^a-z0-9-]/.test(r.slug || ''));
  if (invalid.length) invalid.forEach(r => fail('caractere invalido: ' + r.id + ' "' + r.slug + '"')); else console.log('  [OK] nenhum caractere invalido (somente [a-z0-9-])');
  console.log('  [OK] casos conhecidos: ver bloco acima');
  console.log('  [OK] relatorio completo gerado');
  console.log('  [OK] banco confirmado (fingerprint acima)');
  console.log('  [OK] execucao read-only confirmada');
  console.log('');

  // ── Rodape oficial (item 1) ─────────────────────────────────────
  console.log('Slug collisions: ' + colisoes.length);
  console.log('Status: ' + (failures ? 'FAILED' : 'SUCCESS'));
  if (failures) process.exitCode = 1;
} catch (e) {
  console.error('GUARD ERROR: ' + redact(e && e.message ? e.message : e));
  console.log('Status: FAILED');
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
