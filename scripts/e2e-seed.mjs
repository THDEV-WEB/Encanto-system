// scripts/e2e-seed.mjs — REF-E2E-01 · Onda 4.
// Aplica e2e/support/seed-catalog.sql no projeto Supabase DEDICADO a E2E (nunca produção — conexão
// vem só de C:\Users\00thi\.encanto\db.e2e.env, mesma convenção/infra dos demais scripts de banco
// deste projeto, ex.: scripts/auth-rls-test.mjs). Idempotente (o próprio SQL usa ON CONFLICT).
// Uso: node scripts/e2e-seed.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('C:\\Users\\00thi\\.encanto\\package.json');
const pg = require('pg');
const ENV_PATH = 'C:\\Users\\00thi\\.encanto\\db.e2e.env';

const envGet = (t, k) => { const m = t.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
function loadConn() {
  let t;
  try { t = readFileSync(ENV_PATH, 'utf8'); }
  catch { console.error('ERRO: db.e2e.env nao encontrado (' + ENV_PATH + '). Ver docs/adr/REF-E2E-01-auditoria-playwright.md.'); process.exit(2); }
  const host = envGet(t, 'PGHOST');
  if (!host) { console.error('ERRO: defina PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE em db.e2e.env'); process.exit(2); }
  return { host, port: Number(envGet(t, 'PGPORT') || 5432), user: envGet(t, 'PGUSER'), password: envGet(t, 'PGPASSWORD'), database: envGet(t, 'PGDATABASE') || 'postgres' };
}

const sql = readFileSync(new URL('../e2e/support/seed-catalog.sql', import.meta.url), 'utf8');
const client = new pg.Client({ ...loadConn(), ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

try {
  await client.connect();
  await client.query(sql);
  console.log('OK e2e-seed — catálogo fixo aplicado (idempotente) no projeto de E2E.');
} catch (e) {
  console.error('FALHOU e2e-seed:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
