// REF-ADDRESS-GEO-INTEGRITY-01 -- GATE FINAL DE PRODUCAO -- PRE-CHECK (somente leitura).
// Roda ANTES de aplicar as migrations da Onda 2 em producao. Confirma que create_order() e
// _resolve_delivery_fee() estao EXATAMENTE na versao-base que as migrations desta REF assumem
// (evita repetir o incidente da propria Onda 2, onde uma 1a tentativa partiu da base errada).
// NENHUMA escrita, NENHUMA chamada de RPC de negocio -- so introspeccao de catalogo (pg_proc) e
// leitura de store_settings. Exit 0 = seguro para aplicar; exit 1 = ABORTAR o gate e investigar.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ENV_PATH = 'C:/Users/00thi/.encanto/db.env';
const EXPECTED_PROD_REF = 'hvbcdxsagkjtfjwvnslo';
const envGet = (txt, k) => { const m = txt.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
const txt = readFileSync(ENV_PATH, 'utf8');
const user = envGet(txt, 'PGUSER');
if (!user || !user.includes(EXPECTED_PROD_REF)) { console.error(`ABORTADO: PGUSER (${user}) nao bate com o project ref de PRODUCAO esperado (${EXPECTED_PROD_REF}).`); process.exit(2); }
const client = new pg.Client({
  host: envGet(txt, 'PGHOST'), port: Number(envGet(txt, 'PGPORT') || 5432),
  user, password: envGet(txt, 'PGPASSWORD'), database: envGet(txt, 'PGDATABASE') || 'postgres',
  ssl: { rejectUnauthorized: false }, statement_timeout: 15000, connectionTimeoutMillis: 15000,
});

function extractBody(path) {
  const sql = readFileSync(path, 'utf8');
  const matches = [...sql.matchAll(/AS \$function\$([\s\S]*?)\$function\$;/g)];
  return matches.map(m => m[1].trim());
}

let ok = true;
function check(label, cond, extra = '') {
  if (cond) console.log(`PASS  ${label}`);
  else { ok = false; console.log(`FAIL  ${label}  ${extra}`); }
}

async function main() {
  await client.connect();
  console.log(`Conectado a PRODUCAO (ref ${EXPECTED_PROD_REF} confirmado) -- introspeccao read-only.\n`);

  const r1 = await client.query(`SELECT prosrc FROM pg_proc WHERE proname='create_order' AND pronamespace='public'::regnamespace`);
  const prodCreateOrder = r1.rows[0]?.prosrc?.trim();
  const expectedCreateOrder = extractBody('C:/Projetos/Encanto/encanto-react/migrations/REF-DELIVERY-FEE-04-onda2-transparencia-valor.sql')[0];
  check('create_order() em producao == REF-DELIVERY-FEE-04-onda2-transparencia-valor.sql (byte-a-byte)',
    prodCreateOrder === expectedCreateOrder, `len prod=${prodCreateOrder?.length} len esperado=${expectedCreateOrder?.length}`);

  const r2 = await client.query(`SELECT prosrc FROM pg_proc WHERE proname='_resolve_delivery_fee' AND pronamespace='public'::regnamespace`);
  const prodResolveFee = r2.rows[0]?.prosrc?.trim();
  const expectedResolveFee = extractBody('C:/Projetos/Encanto/encanto-react/migrations/REF-DELIVERY-FEE-04-onda1-delivery-fee-autoritativo.sql')[0];
  check('_resolve_delivery_fee() em producao == definicao original (REF-DELIVERY-FEE-04 Onda 1, byte-a-byte)',
    prodResolveFee === expectedResolveFee, `len prod=${prodResolveFee?.length} len esperado=${expectedResolveFee?.length}`);

  const g = await client.query(`
    SELECT p.proname, r.rolname AS grantee, has_function_privilege(r.oid, p.oid, 'EXECUTE') AS can_exec
    FROM pg_proc p, pg_roles r
    WHERE p.proname IN ('create_order','_resolve_delivery_fee') AND r.rolname IN ('anon','authenticated')
    ORDER BY 1,2`);
  const byKey = Object.fromEntries(g.rows.map(r => [`${r.proname}/${r.grantee}`, r.can_exec]));
  check('Grants inalterados: create_order EXECUTE para anon E authenticated',
    byKey['create_order/anon'] === true && byKey['create_order/authenticated'] === true, JSON.stringify(byKey));
  check('Grants inalterados: _resolve_delivery_fee SEM EXECUTE para anon/authenticated',
    byKey['_resolve_delivery_fee/anon'] === false && byKey['_resolve_delivery_fee/authenticated'] === false, JSON.stringify(byKey));

  const cfg = await client.query(`
    SELECT s.slug, s.status,
      (SELECT valor FROM public.store_settings WHERE store_id=s.id AND chave='delivery_fee_config') AS dc
    FROM public.stores s WHERE s.status='ativo'`);
  console.log('\nConfig de delivery_fee das lojas ATIVAS (para conferencia manual do raio bbox):');
  for (const row of cfg.rows) {
    let dc = null; try { dc = row.dc ? JSON.parse(row.dc) : null; } catch {}
    const maxAte = Array.isArray(dc?.faixas) && dc.faixas.length ? Math.max(...dc.faixas.map(f => Number(f.ate) || 0)) : null;
    console.log(`  ${row.slug}: ativo=${dc?.ativo} maior_ate=${maxAte}km -> bbox=${maxAte != null ? Math.max(maxAte * 3, 50) : '(config incompleta, bbox nao se aplica)'}km`);
  }

  console.log(`\n${ok ? 'PRE-CHECK OK -- seguro aplicar as migrations.' : 'PRE-CHECK FALHOU -- ABORTAR, investigar divergencia antes de aplicar.'}`);
  await client.end();
  process.exit(ok ? 0 : 1);
}
main().catch(async e => { console.error('ERRO:', e.message); await client.end().catch(() => {}); process.exit(1); });
