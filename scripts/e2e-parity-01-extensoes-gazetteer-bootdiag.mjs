// Utilitario operacional (nao e' uma migration de producao -- so' replica no projeto E2E coisas que
// ja existem/ja foram removidas em producao ha' tempos): instala unaccent/pg_trgm no schema public
// (mesmo lugar de producao -- nunca foram criadas via migration versionada, so' pelo dashboard do
// Supabase, entao nao ha' arquivo de migration pra "aplicar", so' recriar aqui), e devolve o E2E a'
// mesma sequencia de mudancas que producao ja passou (REF-ADDRESS-02-onda4-gazetteer aplicada,
// REF-BOOT-02-cleanup-drop-boot-diag aplicada). Achado durante a reconciliacao de drift do
// "Raio-X do Encanto" -- NUNCA roda contra producao (guard abaixo).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ENV_PATH = 'C:/Users/00thi/.encanto/db.e2e.env';
const EXPECTED_REF = 'bgzcrovskjbktdxkhemd';

const txt = readFileSync(ENV_PATH, 'utf8');
const envGet = (k) => { const m = txt.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
const conn = { host: envGet('PGHOST'), port: Number(envGet('PGPORT') || 5432), user: envGet('PGUSER'), password: envGet('PGPASSWORD'), database: envGet('PGDATABASE') || 'postgres' };
const projRef = (conn.user.match(/postgres\.([a-z0-9]{16,})/i) || [])[1];

async function main() {
  if (projRef !== EXPECTED_REF) { console.error(`ABORTADO: alvo (${projRef}) nao e' o E2E esperado (${EXPECTED_REF})`); process.exit(2); }
  const client = new pg.Client({ ...conn, ssl: { rejectUnauthorized: false }, statement_timeout: 30000 });
  await client.connect();
  console.log('ALVO CONFIRMADO:', conn.host, '->', projRef);

  console.log('\n== 1) extensoes (mesmo schema de producao: public) ==');
  await client.query('CREATE EXTENSION IF NOT EXISTS unaccent SCHEMA public');
  await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public');
  const ext = await client.query(`select extname, extversion, extnamespace::regnamespace::text as schema from pg_extension where extname in ('unaccent','pg_trgm')`);
  console.log('OK:', JSON.stringify(ext.rows));

  await client.end();
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
