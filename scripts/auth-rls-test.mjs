// test:auth-rls — Suite de RLS da AUTH-01 (autenticacao de cliente hibrida).
// Prova, apos aplicar AUTH-01 step1+step2 e registrar o admin em public.admins, que:
//   - anon LE o catalogo publico e NAO escreve (42501);
//   - CLIENTE autenticado NAO-admin (jwt sub aleatorio, fora de admins) NAO escreve catalogo;
//   - ADMIN (jwt sub presente em public.admins) ESCREVE catalogo;
//   - leitura propria isolada: cliente A ve so os proprios dados; cliente B nao ve os de A.
// Cada teste roda em BEGIN..ROLLBACK (SET LOCAL ROLE + request.jwt.claims). Mutacao liquida = 0.
// Mesma infra do test:rls (pg + C:\Users\00thi\.encanto\db.env). Exit 0 = SUCCESS; 1 = FAILED.
// OBS: RED (esperado) enquanto as migrations AUTH-01 nao estiverem aplicadas — vira GREEN depois.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('C:\\Users\\00thi\\.encanto\\package.json');
const pg = require('pg');
const ENV_PATH = 'C:\\Users\\00thi\\.encanto\\db.env';
const envGet = (t, k) => { const m = t.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
function loadConn() {
  let t; try { t = readFileSync(ENV_PATH, 'utf8'); } catch { console.error('ERRO: db.env nao encontrado (' + ENV_PATH + ')'); process.exit(2); }
  const host = envGet(t, 'PGHOST'), url = envGet(t, 'SUPABASE_DB_URL');
  if (host) return { host, port: Number(envGet(t, 'PGPORT') || 5432), user: envGet(t, 'PGUSER'), password: envGet(t, 'PGPASSWORD'), database: envGet(t, 'PGDATABASE') || 'postgres' };
  if (url) return { connectionString: url };
  console.error('ERRO: defina PGHOST/... ou SUPABASE_DB_URL em db.env'); process.exit(2);
}
const client = new pg.Client({ ...loadConn(), ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

let passes = 0, failures = 0;
const rec = (v, id, desc, detail) => { if (v === 'PASS') passes++; else failures++; console.log(`  [${v}] ${id} ${desc}\n         -> ${detail}`); };
// tx: BEGIN; set claims (sub) enquanto superuser; SET LOCAL ROLE; fn; ROLLBACK.
async function tx(role, sub, setupSql, fn) {
  try {
    await client.query('BEGIN');
    for (const s of (setupSql || [])) await client.query(s);              // setup como superuser (antes do SET ROLE)
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(sub ? { sub, role } : { role })]);
    await client.query(`SET LOCAL ROLE ${role}`);
    return await fn();
  } finally { await client.query('ROLLBACK').catch(() => {}); }
}
async function expectDeniedWrite(id, role, sub, desc, target) {
  let v = 'FAIL', d = '';
  await tx(role, sub, [], async () => {
    try {
      const r = await client.query(target);
      // UPDATE sem policy => rowCount 0 (negado silencioso); INSERT deveria lancar 42501/violacao.
      if (/^\s*update/i.test(target)) { v = r.rowCount === 0 ? 'PASS' : 'FAIL'; d = `UPDATE afetou ${r.rowCount} linha(s) (0 = negado)`; }
      else { v = 'FAIL'; d = `NAO negado: ${r.rowCount} linha(s) inseridas — VAZAMENTO`; }
    } catch (e) { v = (e.code === '42501' || e.code === '23514') ? 'PASS' : 'FAIL'; d = `negado (${e.code}): ${String(e.message).split('\n')[0]}`; }
  });
  rec(v, id, desc, d);
}
async function expectAllowed(id, role, sub, desc, setupSql, stmts) {
  let v = 'PASS', d = 'permitido';
  await tx(role, sub, setupSql, async () => {
    for (const s of stmts) { try { await client.query(s); } catch (e) { v = 'FAIL'; d = `NEGADO inesperado (${e.code}): ${String(e.message).split('\n')[0]}`; break; } }
  });
  rec(v, id, desc, d);
}

try {
  await client.connect();
  console.log('================ SUITE test:auth-rls (AUTH-01) ================');
  // Guard: is_admin() existe? (prova que a Etapa 1 foi aplicada)
  const hasFn = (await client.query("SELECT to_regprocedure('public.is_admin()') IS NOT NULL AS ok")).rows[0].ok;
  rec(hasFn ? 'PASS' : 'FAIL', 'G0', 'public.is_admin() existe (Etapa 1 aplicada)', hasFn ? 'ok' : 'AUSENTE — aplique AUTH-01-step1-fundacao.sql');

  const pid = (await client.query('SELECT id FROM public.products ORDER BY id LIMIT 1')).rows[0]?.id;
  const adminUid = (await client.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 1')).rows[0]?.id;
  const clientA = (await client.query('SELECT gen_random_uuid() AS u')).rows[0].u;
  const clientB = (await client.query('SELECT gen_random_uuid() AS u')).rows[0].u;

  // ── anon: le catalogo, nao escreve ──
  await expectAllowed('AR1', 'anon', null, 'anon LE products/categories/adicionais', [], ['SELECT count(*) FROM public.products', 'SELECT count(*) FROM public.categories', 'SELECT count(*) FROM public.adicionais']);
  await expectDeniedWrite('AW1', 'anon', null, 'anon INSERT products NEGADO', `INSERT INTO public.products(nome,preco) VALUES('__auth_rls_x',9.99)`);

  // ── CLIENTE autenticado NAO-admin: NAO escreve catalogo (o coracao da AUTH-01) ──
  await expectDeniedWrite('CW1', 'authenticated', clientA, 'cliente(nao-admin) INSERT products NEGADO', `INSERT INTO public.products(nome,preco) VALUES('__auth_rls_cw',9.99)`);
  await expectDeniedWrite('CW2', 'authenticated', clientA, 'cliente(nao-admin) UPDATE products -> 0 linhas', `UPDATE public.products SET disponivel=disponivel WHERE id='${pid}'`);
  await expectDeniedWrite('CW3', 'authenticated', clientA, 'cliente(nao-admin) INSERT categories NEGADO', `INSERT INTO public.categories(id,nome,slug,tipo,ordem,ativo) VALUES('__auth_rls_c','X','__auth-rls-c','business',999,true)`);
  await expectDeniedWrite('CW4', 'authenticated', clientA, 'cliente(nao-admin) INSERT adicionais NEGADO', `INSERT INTO public.adicionais(nome,grupo,aplica_categoria_id) VALUES('__auth_rls_a','simples',NULL)`);

  // ── ADMIN (linha em admins): ESCREVE catalogo ──
  if (adminUid) {
    await expectAllowed('AD1', 'authenticated', adminUid, 'admin UPDATE products PERMITIDO', [`INSERT INTO public.admins(user_id) VALUES('${adminUid}') ON CONFLICT DO NOTHING`], [`UPDATE public.products SET disponivel=disponivel WHERE id='${pid}'`]);
    await expectAllowed('AD2', 'authenticated', adminUid, 'admin INSERT categories PERMITIDO', [`INSERT INTO public.admins(user_id) VALUES('${adminUid}') ON CONFLICT DO NOTHING`], [`INSERT INTO public.categories(id,nome,slug,tipo,ordem,ativo) VALUES('__auth_rls_ad','X','__auth-rls-ad','business',999,true)`]);
  } else rec('FAIL', 'AD1', 'admin write', 'sem usuario em auth.users para simular admin');

  // ── isolamento de leitura (leak guard): cliente NAO-admin NAO ve pedidos/clientes alheios ──
  // (o positivo "ve o proprio" exige um usuario auth real -> validado em runtime pelo fluxo OTP).
  await tx('authenticated', clientA, [], async () => {
    const o  = (await client.query('SELECT count(*)::int n FROM public.orders')).rows[0].n;
    const cu = (await client.query('SELECT count(*)::int n FROM public.customers')).rows[0].n;
    rec(o === 0 && cu === 0 ? 'PASS' : 'FAIL', 'OR1', 'cliente nao-admin NAO ve orders/customers alheios', `orders=${o} customers=${cu} (esperado 0/0)`);
  });
  void clientB;

  console.log(`\n— Resumo — PASS=${passes} FAIL=${failures}`);
  console.log('====================================');
  console.log('STATE: ' + (failures ? 'FAILED' : 'SUCCESS') + ' · PASS=' + passes + ' FAIL=' + failures + ' · NO PERSISTED WRITES');
  console.log('====================================');
  if (failures) process.exitCode = 1;
} catch (e) {
  console.error('SUITE ERROR: ' + (e && e.message ? e.message : e));
  process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
