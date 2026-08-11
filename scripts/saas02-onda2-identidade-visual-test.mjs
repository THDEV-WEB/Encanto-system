// Suite de verificacao da REF-SAAS-02 · Onda 2 (Identidade visual por tenant + isolamento de Storage).
// Cobre: bannerUrl/logoPreset em set_company_info (validacao + autorizacao), e as novas policies de
// escrita do bucket "products" (stores/{store_id}/... vs paths legados, sempre via is_admin_of real).
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

const SUPER_ADMIN_TESTE = 'b9dc7626-af9c-4ab5-95f7-3207e6469129'; // admin real da Encanto hoje
const ADMIN_B           = 'ce7ece01-266c-42b1-a9db-8051da24d7f5'; // admin de OUTRA loja (nao Encanto)
const STRANGER          = '4fa5541f-989f-4b8d-89b4-7b45a59d8f4e'; // sem nenhum vinculo administrativo
const ENCANTO_ID        = '8604324d-0529-443d-aa79-4337057bfa01';
const SLUG_B            = 'loja-teste-onda2-visual';

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
  out(' SUITE — REF-SAAS-02 · Onda 2 (Identidade visual + Storage) — RELATORIO');
  out('==================================================================');
  out('Camada B: simulacao de sessao dentro de BEGIN...ROLLBACK (mutacao liquida = 0).');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessao ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  const baselineSuperAdmins = (await client.query(`SELECT count(*)::int AS n FROM public.super_admins`)).rows[0].n;

  out('— ITEM 1: set_company_info aceita bannerUrl/logoPreset validos; rejeita invalidos —');
  await tx('authenticated', SUPER_ADMIN_TESTE, setupSuperAdmin(), async () => {
    await callRpc('ITEM1-banner-valido', 'bannerUrl http(s) valido e aceito', `SELECT public.set_company_info('{"bannerUrl":"https://exemplo.com/x.jpg"}'::jsonb, $1) AS r`, [ENCANTO_ID],
      (row, err) => ({ ok: err === null && row?.r?.bannerUrl === 'https://exemplo.com/x.jpg', detail: err || JSON.stringify(row?.r?.bannerUrl) }));
    await callRpc('ITEM1-banner-invalido', 'bannerUrl sem http(s) -> erro', `SELECT public.set_company_info('{"bannerUrl":"nao-e-url"}'::jsonb, $1) AS r`, [ENCANTO_ID],
      (row, err) => ({ ok: err !== null && err.includes('bannerUrl invalido'), detail: err || JSON.stringify(row?.r) }));
    await callRpc('ITEM1-preset-valido', "logoPreset='retangular' e aceito", `SELECT public.set_company_info('{"logoPreset":"retangular"}'::jsonb, $1) AS r`, [ENCANTO_ID],
      (row, err) => ({ ok: err === null && row?.r?.logoPreset === 'retangular', detail: err || JSON.stringify(row?.r?.logoPreset) }));
    await callRpc('ITEM1-preset-invalido', 'logoPreset fora do enum -> erro', `SELECT public.set_company_info('{"logoPreset":"quadrado"}'::jsonb, $1) AS r`, [ENCANTO_ID],
      (row, err) => ({ ok: err !== null && err.includes('logoPreset invalido'), detail: err || JSON.stringify(row?.r) }));
  });
  out('');

  out('— ITEM 1b: BUG REAL corrigido — telefone/whatsapp VAZIO e aceito (estado "nao configurado", nao mais erro) —');
  await tx('authenticated', SUPER_ADMIN_TESTE, setupSuperAdmin(), async () => {
    const { result: r1 } = await callRpc('ITEM1b-setup', 'provisiona loja nova (telefone/whatsapp vazios por padrao)', `SELECT public.provision_store($1,$2,NULL) AS r`, ['Loja Teste Onda2b', 'loja-teste-onda2b-telefone'], (row, err) => ({ ok: err === null, detail: err || 'ok' }));
    const lojaId = r1?.r?.store_id;
    // paraPatch() do AdminEmpresa.jsx sempre inclui telefone/whatsapp no patch, mesmo quando so' outro
    // campo mudou -- sem o fix, ISTO sozinho ja bastava pra rejeitar o save inteiro de uma loja nova.
    await callRpc('ITEM1b-salva-com-vazio', 'set_company_info com telefone/whatsapp/email explicitamente vazios + nomeCurto novo -> aceito', `SELECT public.set_company_info('{"nomeCurto":"Bar Teste","telefone":"","whatsapp":"","email":""}'::jsonb, $1) AS r`, [lojaId],
      (row, err) => ({ ok: err === null && row?.r?.nomeCurto === 'Bar Teste' && row?.r?.telefone === '' && row?.r?.whatsapp === '' && row?.r?.email === '', detail: err || JSON.stringify(row?.r) }));
  });
  out('');

  out('— ITEM 2: AUTORIZACAO — stranger NAO consegue alterar company_info da Encanto —');
  await tx('authenticated', STRANGER, [], async () => {
    await callRpc('ITEM2-stranger-N', 'stranger recebe 42501 ao tentar setar bannerUrl da Encanto', `SELECT public.set_company_info('{"bannerUrl":"https://exemplo.com/x.jpg"}'::jsonb, $1) AS r`, [ENCANTO_ID],
      (row, err) => ({ ok: err !== null && err.includes('apenas administradores'), detail: err || JSON.stringify(row?.r) }));
  });
  out('');

  out('— ITEM 3: Storage — Encanto (admin real) escreve em path LEGADO e em path NOVO (stores/{id}/...) —');
  await tx('authenticated', SUPER_ADMIN_TESTE, setupSuperAdmin(), async () => {
    await callRpc('ITEM3-legado', 'INSERT em path legado (sem prefixo stores/) permitido pro admin da Encanto', `INSERT INTO storage.objects (bucket_id, name) VALUES ('products','branding/logo_teste_onda2.png') RETURNING name`, [],
      (row, err) => ({ ok: err === null && !!row?.name, detail: err || JSON.stringify(row) }));
    await callRpc('ITEM3-novo', 'INSERT em stores/{encantoId}/... permitido pro admin da Encanto', `INSERT INTO storage.objects (bucket_id, name) VALUES ('products', $1) RETURNING name`, [`stores/${ENCANTO_ID}/branding/logo_teste_onda2.png`],
      (row, err) => ({ ok: err === null && !!row?.name, detail: err || JSON.stringify(row) }));
  });
  out('');

  out('— ITEM 4: Storage — ADMIN_B (admin de OUTRA loja) NEGADO em path legado e no path da Encanto —');
  await tx('authenticated', ADMIN_B, [], async () => {
    await callRpc('ITEM4-legado-N', 'ADMIN_B negado em path legado (pertence a Encanto)', `INSERT INTO storage.objects (bucket_id, name) VALUES ('products','branding/logo_admin_b.png') RETURNING name`, [],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row) }));
    await callRpc('ITEM4-encanto-N', 'ADMIN_B negado em stores/{encantoId}/...', `INSERT INTO storage.objects (bucket_id, name) VALUES ('products', $1) RETURNING name`, [`stores/${ENCANTO_ID}/branding/logo_admin_b.png`],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row) }));
  });
  out('');

  out('— ITEM 5: Storage — ADMIN_B escreve normalmente na PROPRIA loja (stores/{suaLoja}/...) —');
  await tx('authenticated', SUPER_ADMIN_TESTE, setupSuperAdmin(), async () => {
    const { result: r1 } = await callRpc('ITEM5-setup', 'provisiona loja + vincula ADMIN_B', `SELECT public.provision_store($1,$2,NULL) AS r`, ['Loja Teste Onda2', SLUG_B], (row, err) => ({ ok: err === null, detail: err || 'ok' }));
    const lojaId = r1?.r?.store_id;
    const emailB = await superScalar(`SELECT email FROM auth.users WHERE id = $1`, [ADMIN_B]);
    await client.query(`SELECT public.link_store_admin($1,$2)`, [lojaId, emailB.email]);

    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ADMIN_B, role: 'authenticated' })]);
    await callRpc('ITEM5-propria-loja', 'ADMIN_B consegue escrever em stores/{propria loja}/...', `INSERT INTO storage.objects (bucket_id, name) VALUES ('products', $1) RETURNING name`, [`stores/${lojaId}/branding/logo_admin_b.png`],
      (row, err) => ({ ok: err === null && !!row?.name, detail: err || JSON.stringify(row) }));
    await callRpc('ITEM5-ainda-nega-encanto', 'mesmo apos virar admin de sua loja, ADMIN_B continua negado no path da Encanto', `INSERT INTO storage.objects (bucket_id, name) VALUES ('products', $1) RETURNING name`, [`stores/${ENCANTO_ID}/branding/logo_admin_b.png`],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row) }));
  });
  out('');

  out('— ITEM 6: Storage — anon NEGADO em qualquer path; leitura publica continua livre —');
  await tx('anon', null, [], async () => {
    await callRpc('ITEM6-anon-N', 'anon negado ao tentar inserir', `INSERT INTO storage.objects (bucket_id, name) VALUES ('products','branding/logo_anon.png') RETURNING name`, [],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row) }));
    await callRpc('ITEM6-leitura-publica', 'anon consegue LER objetos do bucket products normalmente', `SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id='products'`, [],
      (row, err) => ({ ok: err === null && row?.n > 0, detail: err || JSON.stringify(row) }));
  });
  out('');

  out('— ITEM 7: storage_path_store_id — extrai o store_id corretamente; path malformado nunca lanca excecao —');
  await tx('authenticated', SUPER_ADMIN_TESTE, setupSuperAdmin(), async () => {
    await callRpc('ITEM7-extrai', 'extrai o uuid correto de um path bem formado', `SELECT public.storage_path_store_id($1) AS r`, [`stores/${ENCANTO_ID}/branding/x.png`],
      (row, err) => ({ ok: err === null && row?.r === ENCANTO_ID, detail: err || JSON.stringify(row) }));
    await callRpc('ITEM7-malformado', "path 'stores/nao-e-uuid/x.png' devolve NULL (nunca erro)", `SELECT public.storage_path_store_id('stores/nao-e-uuid/x.png') AS r`, [],
      (row, err) => ({ ok: err === null && row?.r === null, detail: err || JSON.stringify(row) }));
    await callRpc('ITEM7-legado', "path sem 'stores/' devolve NULL", `SELECT public.storage_path_store_id('branding/logo.png') AS r`, [],
      (row, err) => ({ ok: err === null && row?.r === null, detail: err || JSON.stringify(row) }));
  });
  out('');

  out('— REGRESSAO: zero mutacao liquida (lojas ficticias, objetos de storage, super_admins) —');
  {
    const r = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.stores WHERE slug IN ('${SLUG_B}','loja-teste-onda2b-telefone')) AS lojas_fake,
        (SELECT count(*)::int FROM storage.objects WHERE name LIKE '%teste_onda2%' OR name LIKE '%admin_b%' OR name LIKE '%anon.png%') AS objetos_fake,
        (SELECT count(*)::int FROM public.super_admins) AS super_admins_agora`);
    const row = r.rows[0];
    const ok = row.lojas_fake === 0 && row.objetos_fake === 0 && row.super_admins_agora === baselineSuperAdmins;
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
  console.log('ETAPA — TESTES DA FASE (REF-SAAS-02 · Onda 2)');
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
