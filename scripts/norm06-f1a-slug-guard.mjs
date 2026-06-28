// Guard de Slug da F1A (NORM-06) — Etapa 1 do Execution Plan.
// READ-ONLY: só SELECTs; não escreve no banco.
// Valida, contra o banco real:
//   (a) 0 colisoes de slug;
//   (b) casos conhecidos geram EXATAMENTE o slug esperado;
//   (c) defensivo: nenhum slug vazio ou com hifen nas pontas.
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
  if (host) { const password = envGet(txt, 'PGPASSWORD'); if (!password) { console.error('ERRO: PGPASSWORD vazio em db.env'); process.exit(2); } return { cfg: { host, port: Number(envGet(txt, 'PGPORT') || 5432), user: envGet(txt, 'PGUSER'), password, database: envGet(txt, 'PGDATABASE') || 'postgres' }, secret: password }; }
  const url = envGet(txt, 'SUPABASE_DB_URL'); if (url) return { cfg: { connectionString: url }, secret: url };
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

const { cfg, secret } = loadConn();
const redact = s => { let r = String(s); if (secret) r = r.split(secret).join('[REDACTED]'); return r; };
const client = new pg.Client({ ...cfg, ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });
let failures = 0;
try {
  await client.connect();

  const all = await client.query(`SELECT id, nome, ${SLUG_SQL} AS slug FROM public.categories ORDER BY ordem`);
  console.log('— Slugs gerados (expressao corrigida) —');
  for (const r of all.rows) console.log(`  ${r.id}\t${r.slug}\t<= ${r.nome}`);

  // (a) colisoes
  const col = await client.query(`SELECT slug, count(*) n, array_agg(id) ids FROM (SELECT id, ${SLUG_SQL} AS slug FROM public.categories) s GROUP BY slug HAVING count(*) > 1`);
  if (col.rows.length) { failures++; console.error('FALHA: colisoes de slug:'); for (const r of col.rows) console.error(`  ${r.slug} -> ${r.ids}`); }
  else console.log('OK: 0 colisoes.');

  // (b) casos conhecidos (exatos)
  const known = await client.query(`SELECT nome, ${SLUG_SQL} AS slug FROM public.categories WHERE nome = ANY($1)`, [KNOWN.map(k => k[0])]);
  const got = new Map(known.rows.map(r => [r.nome, r.slug]));
  console.log('— Casos conhecidos —');
  for (const [nome, esperado] of KNOWN) {
    const slug = got.get(nome);
    const ok = slug === esperado;
    if (!ok) failures++;
    console.log(`  [${ok ? 'OK' : 'FALHA'}] ${nome} -> esperado="${esperado}" gerado="${slug ?? '(ausente)'}"`);
  }

  // (c) defensivo: nenhum slug vazio ou com hifen nas pontas
  const bad = await client.query(`SELECT id, ${SLUG_SQL} AS slug FROM public.categories WHERE ${SLUG_SQL} = '' OR ${SLUG_SQL} LIKE '-%' OR ${SLUG_SQL} LIKE '%-'`);
  if (bad.rows.length) { failures++; console.error('FALHA: slug vazio ou com hifen nas pontas:'); for (const r of bad.rows) console.error(`  ${r.id} "${r.slug}"`); }
  else console.log('OK: nenhum slug vazio/com hifen nas pontas.');

  if (failures) { console.error(`\nGUARD DE SLUG: FAILED (${failures} falha(s)).`); process.exitCode = 1; }
  else console.log('\nGUARD DE SLUG: SUCCESS (0 colisoes + casos conhecidos OK).');
} catch (e) {
  console.error('GUARD ERROR: ' + redact(e && e.message ? e.message : e));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
