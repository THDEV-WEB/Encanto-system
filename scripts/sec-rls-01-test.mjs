// Suite de verificacao da REF-SEC-RLS-01 (dois achados do "Raio-X do Encanto"): policy de escrita
// do gazetteer que nao checava admin de verdade, e 6 tabelas com GRANT orfao pra anon/authenticated
// sem nenhuma policy de RLS. BEGIN...ROLLBACK contra o E2E -- mutacao liquida ZERO. Exit 0 = SUCCESS.
//
// NOTA: address_gazetteer nao existe no projeto E2E (unaccent/pg_trgm nao instaladas la -- drift
// real entre E2E e producao, o mesmo tipo de achado da auditoria). Pra nao expandir escopo instalando
// extensoes so' pra este teste, a Camada B usa uma tabela de rascunho com a MESMA forma de policy
// (USING/WITH CHECK is_super_admin()) pra provar o mecanismo -- nao a tabela real. A Camada C
// (GRANT orfao) testa as 6 tabelas REAIS, que existem no E2E.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = 'C:/Users/00thi/.encanto/db.e2e.env';

const envGet = (txt, k) => { const m = txt.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
function loadConn() {
  const txt = readFileSync(ENV_PATH, 'utf8');
  const host = envGet(txt, 'PGHOST'); const user = envGet(txt, 'PGUSER');
  const password = envGet(txt, 'PGPASSWORD'); if (!password) { console.error('ERRO: PGPASSWORD vazio'); process.exit(2); }
  return { cfg: { host, port: Number(envGet(txt, 'PGPORT') || 5432), user, password, database: envGet(txt, 'PGDATABASE') || 'postgres' }, secret: password, host, user };
}
function projectRef(host, user) { let m = (user || '').match(/postgres\.([a-z0-9]{16,})/i); if (m) return m[1]; m = (host || '').match(/(?:^|\.)([a-z0-9]{16,})\.supabase\./i); return m ? m[1] : '(n/d)'; }
const git = (a) => { try { return execSync('git ' + a, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return '(n/d)'; } };
const isoUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const { cfg, secret, host, user } = loadConn();
const EXPECTED_REF = 'bgzcrovskjbktdxkhemd';
const redact = s => { let r = String(s); if (secret) r = r.split(secret).join('[REDACTED]'); return r; };
const client = new pg.Client({ ...cfg, ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });

const STORE_ID = '5ecec1a5-0001-4000-8000-000000000001'; // ficticia, prefixo desta REF (SEC-RLS-01)

const R = []; const out = (s = '') => R.push(s);
let passes = 0, failures = 0, spCounter = 0;
const startedMs = Date.now(), startedIso = isoUtc();
function record(id, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} ${desc}`); out(`         -> ${detail}`);
}
async function withSavepoint(fn) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try { const r = await fn(); await client.query(`RELEASE SAVEPOINT ${sp}`); return r; }
  catch (e) { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); throw e; }
}
async function check(id, desc, fn) {
  try { const { ok, detail } = await withSavepoint(fn); record(id, desc, ok ? 'PASS' : 'FAIL', detail); }
  catch (e) { record(id, desc, 'FAIL', 'EXCECAO: ' + redact(e.message).split('\n')[0]); }
}
async function setRole(role, sub, tenantId) {
  const claims = { ...(sub ? { sub } : {}), ...(tenantId ? { tenant_id: tenantId } : {}), role };
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  await client.query(`SET LOCAL ROLE ${role}`);
}
async function resetRole() { await client.query(`RESET ROLE`); await client.query(`SELECT set_config('request.jwt.claims', '{}', true)`); }

try {
  await client.connect();
  const refReal = projectRef(host, user);
  out('— ALVO CONFIRMADO — host=' + host + ' user=' + user + ' project_ref=' + refReal + ' —');
  if (refReal !== EXPECTED_REF) throw new Error(`ABORTADO: project_ref real (${refReal}) difere do E2E esperado (${EXPECTED_REF})`);
  out('');

  await client.query('BEGIN');

  out('=== CAMADA A — ESTRUTURAL ===');
  await check('A1', 'is_admin_anywhere() existe e nao precisa de parametro (base pro fix)', async () => {
    const r = await client.query(`SELECT pg_get_function_identity_arguments(oid) AS args FROM pg_proc WHERE proname='is_admin_anywhere' AND pronamespace='public'::regnamespace`);
    return { ok: r.rows.length === 1 && r.rows[0].args === '', detail: JSON.stringify(r.rows) };
  });
  out('');

  out('=== CAMADA B — mecanismo da policy do gazetteer (tabela de rascunho, ver nota do cabecalho) ===');
  await client.query(`INSERT INTO public.stores (id, slug, nome, dominio, status) VALUES ('${STORE_ID}', 'loja-secrls01', 'Loja SEC-RLS-01 (fake)', NULL, 'ativo')`);
  // 3 personas: sem nenhum papel, admin de UMA loja (nao deveria bastar -- dado e' de plataforma,
  // compartilhado entre todas as lojas), e super admin VALION (unico que deveria poder escrever).
  const lojaAdmin = await client.query(`INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'secrls01-lojaadmin@teste.local') ON CONFLICT DO NOTHING RETURNING id`);
  let lojaAdminId = lojaAdmin.rows[0]?.id;
  if (!lojaAdminId) { const r = await client.query(`SELECT id FROM auth.users WHERE email='secrls01-lojaadmin@teste.local'`); lojaAdminId = r.rows[0].id; }
  await client.query(`INSERT INTO public.admins (user_id, store_id) VALUES ($1, '${STORE_ID}') ON CONFLICT DO NOTHING`, [lojaAdminId]);

  const superAdmin = await client.query(`INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'secrls01-superadmin@teste.local') ON CONFLICT DO NOTHING RETURNING id`);
  let superAdminId = superAdmin.rows[0]?.id;
  if (!superAdminId) { const r = await client.query(`SELECT id FROM auth.users WHERE email='secrls01-superadmin@teste.local'`); superAdminId = r.rows[0].id; }
  await client.query(`INSERT INTO public.super_admins (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [superAdminId]);

  const naoAdmin = await client.query(`INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'secrls01-naoadmin@teste.local') ON CONFLICT DO NOTHING RETURNING id`);
  let naoAdminId = naoAdmin.rows[0]?.id;
  if (!naoAdminId) { const r = await client.query(`SELECT id FROM auth.users WHERE email='secrls01-naoadmin@teste.local'`); naoAdminId = r.rows[0].id; }

  await client.query(`CREATE TABLE IF NOT EXISTS public._sec_rls_01_gazetteer_rascunho (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nome text NOT NULL)`);
  await client.query(`ALTER TABLE public._sec_rls_01_gazetteer_rascunho ENABLE ROW LEVEL SECURITY`);
  await client.query(`DROP POLICY IF EXISTS "rascunho antes (bug)" ON public._sec_rls_01_gazetteer_rascunho`);
  await client.query(`DROP POLICY IF EXISTS "rascunho depois (fix)" ON public._sec_rls_01_gazetteer_rascunho`);

  await check('B1', 'ANTES do fix: USING(true) permite QUALQUER authenticated escrever (reproduz o bug)', async () => {
    await client.query(`CREATE POLICY "rascunho antes (bug)" ON public._sec_rls_01_gazetteer_rascunho FOR ALL TO authenticated USING (true) WITH CHECK (true)`);
    await setRole('authenticated', naoAdminId, STORE_ID);
    const r = await client.query(`INSERT INTO public._sec_rls_01_gazetteer_rascunho (nome) VALUES ('deveria falhar antes do fix') RETURNING id`);
    await resetRole();
    await client.query(`DROP POLICY "rascunho antes (bug)" ON public._sec_rls_01_gazetteer_rascunho`);
    return { ok: r.rows.length === 1, detail: 'bug reproduzido: usuario NAO-admin conseguiu inserir -> ' + JSON.stringify(r.rows) };
  });

  // Policy do fix criada FORA de qualquer check() individual -- B2/B3 esperam excecao de proposito,
  // e nao podem derrubar (via ROLLBACK TO SAVEPOINT) a policy que os checks seguintes tambem precisam.
  await client.query(`CREATE POLICY "rascunho depois (fix)" ON public._sec_rls_01_gazetteer_rascunho FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin())`);

  await check('B2', 'DEPOIS do fix: usuario sem NENHUM papel NAO consegue escrever (RLS rejeita o INSERT)', async () => {
    await setRole('authenticated', naoAdminId, STORE_ID);
    let bloqueado = false, msg = '';
    await client.query('SAVEPOINT sp_b2_insert');
    try {
      await client.query(`INSERT INTO public._sec_rls_01_gazetteer_rascunho (nome) VALUES ('nao deveria inserir')`);
    } catch (e) {
      bloqueado = /row-level security/i.test(e.message);
      msg = e.message;
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT sp_b2_insert');
    }
    await resetRole();
    return { ok: bloqueado, detail: bloqueado ? 'bloqueado como esperado: ' + msg : 'NAO bloqueou (inesperado)' };
  });

  await check('B3', 'DEPOIS do fix: admin de UMA loja tambem NAO consegue escrever (dado e\' de plataforma, nao da loja dele)', async () => {
    await setRole('authenticated', lojaAdminId, STORE_ID);
    let bloqueado = false, msg = '';
    await client.query('SAVEPOINT sp_b3_insert');
    try {
      await client.query(`INSERT INTO public._sec_rls_01_gazetteer_rascunho (nome) VALUES ('admin de loja nao deveria inserir')`);
    } catch (e) {
      bloqueado = /row-level security/i.test(e.message);
      msg = e.message;
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT sp_b3_insert');
    }
    await resetRole();
    return { ok: bloqueado, detail: bloqueado ? 'bloqueado como esperado (admin de loja nao e\' super admin): ' + msg : 'NAO bloqueou (inesperado)' };
  });

  await check('B4', 'DEPOIS do fix: SUPER ADMIN (VALION) continua conseguindo escrever', async () => {
    await setRole('authenticated', superAdminId, null);
    const r = await client.query(`INSERT INTO public._sec_rls_01_gazetteer_rascunho (nome) VALUES ('super admin pode') RETURNING id`);
    await resetRole();
    return { ok: r.rows.length === 1, detail: JSON.stringify(r.rows) };
  });

  await client.query(`DROP POLICY IF EXISTS "rascunho depois (fix)" ON public._sec_rls_01_gazetteer_rascunho`);
  await client.query(`DROP TABLE IF EXISTS public._sec_rls_01_gazetteer_rascunho`);
  out('');

  out('=== CAMADA C — REVOKE dos grants orfaos (tabelas reais) ===');
  const TABS = ['stores', 'store_settings', 'rate_limit_hits', 'delivery_route_cache', 'delivery_route_requests', 'settings'];

  await check('C1', 'ANTES do fix: anon/authenticated tem GRANT direto nas 6 tabelas (reproduz o achado)', async () => {
    const faltando = [];
    for (const t of TABS) {
      const g = await client.query(`SELECT grantee FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name=$1 AND grantee IN ('anon','authenticated') AND privilege_type='SELECT'`, [t]);
      if (g.rows.length < 2) faltando.push(t);
    }
    return { ok: faltando.length === 0, detail: faltando.length === 0 ? 'confirmado: as 6 tabelas tem grant pra anon E authenticated' : 'faltando em: ' + JSON.stringify(faltando) };
  });

  await check('C2', 'Aplica o REVOKE (mesmo texto da migration) nas 6 tabelas', async () => {
    for (const t of TABS) {
      await client.query(`REVOKE SELECT, INSERT, UPDATE, DELETE ON public.${t} FROM anon, authenticated`);
    }
    const restante = [];
    for (const t of TABS) {
      const g = await client.query(`SELECT grantee FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name=$1 AND grantee IN ('anon','authenticated') AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')`, [t]);
      if (g.rows.length > 0) restante.push({ tabela: t, sobrou: g.rows });
    }
    return { ok: restante.length === 0, detail: restante.length === 0 ? 'nenhum grant de SELECT/INSERT/UPDATE/DELETE sobrou pra anon/authenticated' : JSON.stringify(restante) };
  });

  await check('C3', 'DEPOIS do REVOKE: authenticated recebe permission-denied ao tentar ler stores direto (nao mais silencio)', async () => {
    await setRole('authenticated', naoAdminId, STORE_ID);
    let negou = false, mensagem = '';
    await client.query('SAVEPOINT sp_c3_select');
    try {
      await client.query(`SELECT 1 FROM public.stores LIMIT 1`);
    } catch (e) {
      negou = /permission denied/i.test(e.message);
      mensagem = e.message;
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT sp_c3_select');
    }
    await resetRole();
    return { ok: negou, detail: negou ? 'permission denied confirmado: ' + mensagem : 'NAO negou (inesperado)' };
  });

  await check('C4', 'REGRESSAO: acesso via funcao SECURITY DEFINER (o caminho real do app) continua funcionando -- default_store_id() le stores sem erro', async () => {
    await setRole('authenticated', naoAdminId, STORE_ID);
    const r = await client.query(`SELECT public.default_store_id() AS v`);
    await resetRole();
    return { ok: true, detail: 'RPC executou sem erro (nao depende do GRANT direto revogado): ' + JSON.stringify(r.rows[0]) };
  });
  out('');

  out('— Resumo —  PASS: ' + passes + '  ·  FAIL: ' + failures);
  await client.query('ROLLBACK');
  out('— ROLLBACK aplicado — zero mutacao liquida no banco E2E (grants/policies originais preservados) —');
  out('— Fingerprint — commit ' + git('rev-parse HEAD') + ' · branch ' + git('rev-parse --abbrev-ref HEAD') + ' · Node ' + process.version + ' · ' + (Date.now() - startedMs) + ' ms · started ' + startedIso);
  out('');

  const body = R.join('\n');
  const sha = createHash('sha256').update(body, 'utf8').digest('hex');
  console.log(body);
  console.log('— Execution Report SHA256 —\n  ' + sha + '\n');
  const state = failures ? 'FAILED' : 'SUCCESS';
  console.log('====================================');
  console.log('ETAPA — TESTES DA FASE (REF-SEC-RLS-01)');
  console.log('STATE: ' + state + ' · PASS=' + passes + ' FAIL=' + failures);
  console.log('BEGIN...ROLLBACK — mutacao liquida ZERO');
  console.log('====================================');
  if (failures) process.exitCode = 1;
} catch (e) {
  console.log(R.join('\n'));
  console.error('SUITE ERROR: ' + redact(e && e.message ? e.message : e));
  console.log('STATE:\nFAILED');
  process.exitCode = 1;
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end().catch(() => {});
}
