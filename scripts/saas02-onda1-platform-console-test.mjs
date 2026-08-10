// Suite de verificacao da REF-SAAS-02 · Onda 1 (Platform Console) — "Testes da fase". Cobre as 4 RPCs
// novas (platform_list_tenants/platform_tenant_detail/platform_set_store_status/
// platform_unlink_store_admin) e a derivacao automatica de slug em get_store_by_domain. NAO retesta
// provision_store/link_store_admin/is_admin_anywhere/list_my_stores -- ja cobertas por
// saas01-onda8-provisionamento-test.mjs (36/36), que continua rodando sem alteracao.
//
// Camada B: SET LOCAL ROLE + request.jwt.claims dentro de BEGIN...ROLLBACK. Mutacao liquida = 0.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = 'C:/Users/00thi/.encanto/db.env';

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

// Mesmas personas reais ja documentadas/reaproveitadas em saas01-onda8-provisionamento-test.mjs.
const SUPER_ADMIN_TESTE = 'b9dc7626-af9c-4ab5-95f7-3207e6469129'; // admin real hoje -- ganha super_admins SO dentro da tx
const ADMIN_B           = 'ce7ece01-266c-42b1-a9db-8051da24d7f5'; // admin de outra loja (nao super admin)
const STRANGER          = '4fa5541f-989f-4b8d-89b4-7b45a59d8f4e'; // sem nenhum vinculo administrativo

const SLUG_1 = 'loja-teste-onda1-console';

const R = []; const out = (s = '') => R.push(s);
let passes = 0, failures = 0, spCounter = 0;
const startedMs = Date.now(), startedIso = isoUtc();
function record(id, desc, verdict, detail) {
  if (verdict === 'PASS') passes++; else failures++;
  out(`  [${verdict}] ${id} ${desc}`); out(`         -> ${detail}`);
}
let currentRole = 'postgres';
async function tx(role, sub, setupSql, fn) {
  try {
    await client.query('BEGIN');
    for (const s of (setupSql || [])) await client.query(s);
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(sub ? { sub, role } : { role })]);
    await client.query(`SET LOCAL ROLE ${role}`);
    currentRole = role;
    return await fn();
  } finally { await client.query('ROLLBACK').catch(() => {}); }
}
async function superScalar(sql, params) {
  await client.query('RESET ROLE');
  const r = await client.query(sql, params);
  await client.query(`SET LOCAL ROLE ${currentRole}`);
  return r.rows[0];
}
async function callRpc(id, desc, sql, params, checkFn) {
  const sp = `sp_${spCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  let result = null, errMsg = null;
  try { const r = await client.query(sql, params); result = r.rows[0]; await client.query(`RELEASE SAVEPOINT ${sp}`); }
  catch (e) { errMsg = redact(e.message).split('\n')[0]; await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); }
  const { ok, detail } = checkFn(result, errMsg);
  record(id, desc, ok ? 'PASS' : 'FAIL', detail);
  return { result, errMsg };
}
function setupSuperAdmin() {
  return [`INSERT INTO public.super_admins (user_id) VALUES ('${SUPER_ADMIN_TESTE}') ON CONFLICT DO NOTHING`];
}

try {
  out('==================================================================');
  out(' SUITE — REF-SAAS-02 · Onda 1 (Platform Console) — RELATORIO');
  out('==================================================================');
  out('Camada B: simulacao de sessao dentro de BEGIN...ROLLBACK (mutacao liquida = 0).');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessao ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  const baselineSuperAdmins = (await client.query(`SELECT count(*)::int AS n FROM public.super_admins`)).rows[0].n;
  const encanto = (await client.query(`SELECT id, dominio FROM public.stores WHERE slug='encanto'`)).rows[0];

  out('— ITEM 1: platform_list_tenants() — so super admin ve; devolve a Encanto com sinais REAIS —');
  await tx('authenticated', SUPER_ADMIN_TESTE, setupSuperAdmin(), async () => {
    await callRpc('ITEM1-lista', 'Encanto aparece com admin_count>=1, tem_produtos=true (dado real de producao)', `SELECT * FROM public.platform_list_tenants() WHERE slug='encanto'`, [],
      (row, err) => ({ ok: err === null && row?.admin_count >= 1 && row?.tem_produtos === true, detail: err || JSON.stringify(row) }));
  });
  await tx('authenticated', ADMIN_B, [], async () => {
    await callRpc('ITEM1-admin-comum-N', 'admin de loja comum recebe 42501 (nao lista vazia -- RAISE EXCEPTION explicito)', `SELECT * FROM public.platform_list_tenants()`, [],
      (row, err) => ({ ok: err !== null && err.includes('apenas o super admin'), detail: err || JSON.stringify(row) }));
  });
  await tx('authenticated', STRANGER, [], async () => {
    await callRpc('ITEM1-stranger-N', 'stranger recebe erro de permissao', `SELECT * FROM public.platform_list_tenants()`, [],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row) }));
  });
  await tx('anon', null, [], async () => {
    await callRpc('ITEM1-anon-N', 'anon recebe erro (sem GRANT)', `SELECT * FROM public.platform_list_tenants()`, [],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row) }));
  });
  out('');

  out('— ITEM 2: platform_tenant_detail(store_id) — detalhe completo (admins/company_info/counts) —');
  await tx('authenticated', SUPER_ADMIN_TESTE, setupSuperAdmin(), async () => {
    await callRpc('ITEM2-detalhe', 'detalhe da Encanto traz >=1 admin com email real e counts.produtos>0', `SELECT public.platform_tenant_detail($1) AS r`, [encanto.id],
      (row, err) => {
        const d = row?.r;
        const ok = err === null && Array.isArray(d?.admins) && d.admins.length >= 1 && !!d.admins[0].email && d?.counts?.produtos > 0;
        return { ok, detail: err || JSON.stringify(d?.counts) };
      });
    await callRpc('ITEM2-loja-inexistente', 'store_id inexistente -> erro explicito', `SELECT public.platform_tenant_detail('00000000-0000-0000-0000-000000000000') AS r`, [],
      (row, err) => ({ ok: err !== null && err.includes('loja nao encontrada'), detail: err || JSON.stringify(row?.r) }));
  });
  await tx('authenticated', ADMIN_B, [], async () => {
    await callRpc('ITEM2-admin-comum-N', 'admin de loja comum NAO ve detalhe de tenant (mesmo de sua propria loja)', `SELECT public.platform_tenant_detail($1) AS r`, [encanto.id],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row?.r) }));
  });
  out('');

  out('— ITEM 3: platform_set_store_status — suspender/reativar, status invalido rejeitado —');
  let novaLojaId = null;
  await tx('authenticated', SUPER_ADMIN_TESTE, setupSuperAdmin(), async () => {
    const { result: r1 } = await callRpc('ITEM3-setup', 'provisiona a loja base', `SELECT public.provision_store($1,$2,NULL) AS r`, ['Loja Teste Onda1', SLUG_1], (row, err) => ({ ok: err === null, detail: err || 'ok' }));
    novaLojaId = r1?.r?.store_id;
    await callRpc('ITEM3-suspende', 'suspende a loja recem-criada', `SELECT public.platform_set_store_status($1,'suspenso') AS r`, [novaLojaId],
      (row, err) => ({ ok: err === null && row?.r?.status === 'suspenso', detail: err || JSON.stringify(row?.r) }));
    const st = await superScalar(`SELECT status FROM public.stores WHERE id=$1`, [novaLojaId]);
    record('ITEM3-persistiu', 'status realmente gravado em stores', st?.status === 'suspenso' ? 'PASS' : 'FAIL', JSON.stringify(st));
    await callRpc('ITEM3-reativa', 'reativa de volta pra ativo', `SELECT public.platform_set_store_status($1,'ativo') AS r`, [novaLojaId],
      (row, err) => ({ ok: err === null && row?.r?.status === 'ativo', detail: err || JSON.stringify(row?.r) }));
    await callRpc('ITEM3-status-invalido', 'status fora do enum -> erro', `SELECT public.platform_set_store_status($1,'banido') AS r`, [novaLojaId],
      (row, err) => ({ ok: err !== null && err.includes('status invalido'), detail: err || JSON.stringify(row?.r) }));
    await callRpc('ITEM3-loja-inexistente', 'store_id inexistente -> erro', `SELECT public.platform_set_store_status('00000000-0000-0000-0000-000000000000','ativo') AS r`, [],
      (row, err) => ({ ok: err !== null && err.includes('loja nao encontrada'), detail: err || JSON.stringify(row?.r) }));
  });
  await tx('authenticated', ADMIN_B, [], async () => {
    await callRpc('ITEM3-admin-comum-N', 'admin de loja comum NAO consegue suspender nenhuma loja', `SELECT public.platform_set_store_status($1,'suspenso') AS r`, [encanto.id],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row?.r) }));
  });
  out('');

  out('— ITEM 4: platform_unlink_store_admin — desvincula; idempotente; nega admin comum —');
  await tx('authenticated', SUPER_ADMIN_TESTE, setupSuperAdmin(), async () => {
    const { result: r1 } = await callRpc('ITEM4-setup', 'provisiona + vincula ADMIN_B', `SELECT public.provision_store($1,$2,NULL) AS r`, ['Loja Teste Onda1', SLUG_1], (row, err) => ({ ok: err === null, detail: err || 'ok' }));
    const id = r1?.r?.store_id;
    const emailB = await superScalar(`SELECT email FROM auth.users WHERE id = $1`, [ADMIN_B]);
    await client.query(`SELECT public.link_store_admin($1,$2)`, [id, emailB.email]);
    await callRpc('ITEM4-desvincula', 'desvincula com sucesso (desvinculado=true)', `SELECT public.platform_unlink_store_admin($1,$2) AS r`, [id, ADMIN_B],
      (row, err) => ({ ok: err === null && row?.r?.desvinculado === true, detail: err || JSON.stringify(row?.r) }));
    const cnt = await superScalar(`SELECT count(*)::int AS n FROM public.admins WHERE store_id=$1 AND user_id=$2`, [id, ADMIN_B]);
    record('ITEM4-linha-removida', 'linha realmente removida de admins', cnt?.n === 0 ? 'PASS' : 'FAIL', JSON.stringify(cnt));
    await callRpc('ITEM4-idempotente', 'segunda tentativa (ja desvinculado) -> desvinculado=false, sem erro', `SELECT public.platform_unlink_store_admin($1,$2) AS r`, [id, ADMIN_B],
      (row, err) => ({ ok: err === null && row?.r?.desvinculado === false, detail: err || JSON.stringify(row?.r) }));
  });
  await tx('authenticated', ADMIN_B, [], async () => {
    await callRpc('ITEM4-admin-comum-N', 'admin de loja comum NAO consegue desvincular ninguem', `SELECT public.platform_unlink_store_admin($1,$2) AS r`, [encanto.id, SUPER_ADMIN_TESTE],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row?.r) }));
  });
  out('');

  out('— ITEM 5: get_store_by_domain — deriva slug do padrao {slug}.valionsistemas.com.br automaticamente —');
  await tx('authenticated', SUPER_ADMIN_TESTE, setupSuperAdmin(), async () => {
    const { result: r1 } = await callRpc('ITEM5-setup', 'provisiona a loja base', `SELECT public.provision_store($1,$2,NULL) AS r`, ['Loja Teste Onda1', SLUG_1], (row, err) => ({ ok: err === null, detail: err || 'ok' }));
    const id = r1?.r?.store_id;
    await callRpc('ITEM5-deriva-slug', 'hostname {slug}.valionsistemas.com.br resolve a loja SEM dominio manual configurado', `SELECT * FROM public.get_store_by_domain($1) AS t`, [`${SLUG_1}.valionsistemas.com.br`],
      (row, err) => ({ ok: err === null && row?.store_id === id, detail: err || JSON.stringify(row) }));
    await callRpc('ITEM5-admin-2-labels-nao-casa', 'admin.{slug}.valionsistemas.com.br (2 labels) NAO casa no padrao de storefront (cai no default, nunca confunde admin com storefront)', `SELECT * FROM public.get_store_by_domain($1) AS t`, [`admin.${SLUG_1}.valionsistemas.com.br`],
      (row, err) => ({ ok: err === null && row?.store_id !== id, detail: err || JSON.stringify(row) }));
  });
  await tx('authenticated', STRANGER, [], async () => {
    await callRpc('ITEM5-dominio-exato-ganha', 'Encanto: match EXATO de dominio continua vencendo (zero regressao -- byte-identico a antes desta onda)', `SELECT * FROM public.get_store_by_domain($1) AS t`, [encanto.dominio],
      (row, err) => ({ ok: err === null && row?.store_id === encanto.id, detail: err || JSON.stringify(row) }));
    await callRpc('ITEM5-hostname-desconhecido', 'hostname sem loja nenhuma cai no default_store_id() de sempre', `SELECT * FROM public.get_store_by_domain('nada-a-ver.com.br') AS t`, [],
      (row, err) => ({ ok: err === null && !!row?.store_id, detail: err || JSON.stringify(row) }));
  });
  out('');

  out('— REGRESSAO: zero mutacao liquida (lojas ficticias) + super_admins sem crescimento liquido —');
  {
    const r = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.stores WHERE slug = '${SLUG_1}') AS lojas_fake,
        (SELECT count(*)::int FROM public.super_admins) AS super_admins_agora`);
    const row = r.rows[0];
    const ok = row.lojas_fake === 0 && row.super_admins_agora === baselineSuperAdmins;
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] REGRESSAO zero mutacao liquida`); out(`         -> ${JSON.stringify({ ...row, super_admins_baseline: baselineSuperAdmins })}`);
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
  console.log('ETAPA — TESTES DA FASE (REF-SAAS-02 · Onda 1)');
  console.log('STATE: ' + state + ' · PASS=' + passes + ' FAIL=' + failures);
  console.log('Camada B roda em BEGIN...ROLLBACK — mutacao liquida ZERO');
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
