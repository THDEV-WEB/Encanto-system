// Suite de verificacao da REF-SAAS-01 · Onda 8 (provisionamento assistido — provision_store/
// link_store_admin) — "Testes da fase". Cobre: autorizacao (so super admin provisiona/vincula; admin
// de loja e anon NAO conseguem), integridade (slug duplicado/invalido rejeitado sem criar linha
// parcial, atomicidade quando o vinculo de admin falha por e-mail malformado), semente de company_info
// (loja nova NUNCA herda nome/telefone/whatsapp/paleta da Encanto), e o fluxo de vinculo de admin
// (e-mail existente vincula, e-mail inexistente devolve motivo sem erro, e-mail ja vinculado e
// idempotente, malformado e rejeitado).
//
// Camada B: SET LOCAL ROLE + request.jwt.claims dentro de BEGIN...ROLLBACK. super_admins ganha uma
// linha TEMPORARIA (ADMIN_REAL_USER_ID) so dentro da transacao, desfeita pelo ROLLBACK -- nao promove
// ninguem de verdade em produção. Exit 0 = SUCCESS.
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

// Personas reais ja usadas em outras suites desta REF (dashboard01-admin-reports-test.mjs) — reaproveitadas
// aqui pelo mesmo motivo: ids conhecidos, e-mails resolvidos em runtime (nunca hardcoded no arquivo),
// tudo dentro de BEGIN...ROLLBACK (mutacao liquida = 0).
const SUPER_ADMIN_TESTE = 'b9dc7626-af9c-4ab5-95f7-3207e6469129'; // admin real hoje -- ganha super_admins SO dentro da tx
const ADMIN_B           = 'ce7ece01-266c-42b1-a9db-8051da24d7f5'; // admin de outra loja (nao super admin)
const STRANGER          = '4fa5541f-989f-4b8d-89b4-7b45a59d8f4e'; // sem nenhum vinculo administrativo

const SLUG_1 = 'bar-da-sogra-teste-onda8';
const SLUG_C = 'loja-c-teste-onda8';
const SLUG_ATOMICIDADE = 'loja-atomicidade-teste-onda8';

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
/* stores/admins/auth.users sao trancados por RLS (so RPC SECURITY DEFINER acessa) -- verificacoes
   diretas do PROPRIO teste (nao a chamada da RPC em si) precisam do papel real da conexao (postgres),
   senao um SELECT direto so devolve 0 linhas por RLS, nao por ausencia real do dado. Restaura o papel
   simulado depois, para nao vazar postgres pra proxima chamada de RPC dentro do mesmo bloco tx(). */
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
// super_admins ganha ADMIN_REAL_USER_ID SO dentro da transacao (setup padrao dos testes que precisam
// de super admin) -- ADMIN_B/STRANGER de proposito NAO entram aqui (provam o caminho negativo).
function setupSuperAdmin() {
  return [`INSERT INTO public.super_admins (user_id) VALUES ('${SUPER_ADMIN_TESTE}') ON CONFLICT DO NOTHING`];
}

try {
  out('==================================================================');
  out(' SUITE — REF-SAAS-01 · Onda 8 (provisionamento assistido) — RELATORIO');
  out('==================================================================');
  out('Camada B: simulacao de sessao dentro de BEGIN...ROLLBACK (mutacao liquida = 0).');
  out('');
  await client.connect();
  const meta = (await client.query("SELECT current_user AS who, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS utc")).rows[0];
  out('— Fingerprint — Project ' + projectRef(host, user) + ' · sessao ' + meta.who + ' · ' + meta.utc + ' UTC');
  out('');

  out('— ITEM 1: super admin provisiona uma loja nova (status ativo, sem dominio) —');
  let novaLojaId = null;
  await tx('authenticated', SUPER_ADMIN_TESTE, setupSuperAdmin(), async () => {
    const { result } = await callRpc('ITEM1-provision', 'provision_store cria a loja com status=ativo e dominio=NULL', `SELECT public.provision_store($1,$2,NULL) AS r`, ['Bar da Sogra (teste)', SLUG_1],
      (row, err) => ({ ok: err === null && row?.r?.status === 'ativo' && !!row?.r?.store_id, detail: err || JSON.stringify(row?.r) }));
    novaLojaId = result?.r?.store_id || null;
    const checaDominio = await superScalar(`SELECT dominio FROM public.stores WHERE id = $1`, [novaLojaId]);
    const ok = checaDominio?.dominio === null;
    record('ITEM1-sem-dominio', 'loja nasce sem dominio (DNS/Vercel permanecem manuais, fora do escopo desta onda)', ok ? 'PASS' : 'FAIL', JSON.stringify(checaDominio));
  });
  out('');

  out('— ITEM 2: company_info da loja nova NUNCA herda nome/telefone/whatsapp/paleta da Encanto —');
  await tx('authenticated', SUPER_ADMIN_TESTE, setupSuperAdmin(), async () => {
    const { result: r1 } = await callRpc('ITEM2-setup', 're-provisiona (mesma tx) para obter store_id', `SELECT public.provision_store($1,$2,NULL) AS r`, ['Bar da Sogra (teste)', SLUG_1], (row, err) => ({ ok: err === null, detail: err || 'ok' }));
    const id = r1?.r?.store_id;
    await callRpc('ITEM2-company-info', 'nomeCurto=Bar, whatsapp vazio, corPrimaria=#6B7280 (nunca a paleta/contato reais da Encanto)', `SELECT public.get_company_info($1) AS r`, [id],
      (row, err) => {
        const c = row?.r || {};
        const ok = err === null && c.nomeCurto === 'Bar' && c.whatsapp === '' && c.telefone === '' && c.email === '' && c.whatsappFloatEnabled === false && c.corPrimaria === '#6B7280';
        return { ok, detail: JSON.stringify(c) };
      });
  });
  out('');

  out('— ITEM 3: slug duplicado e rejeitado, sem criar 2a linha —');
  await tx('authenticated', SUPER_ADMIN_TESTE, setupSuperAdmin(), async () => {
    await client.query(`SELECT public.provision_store($1,$2,NULL)`, ['Bar da Sogra (teste)', SLUG_1]);
    await callRpc('ITEM3-slug-duplicado', 'slug repetido -> erro explicito', `SELECT public.provision_store($1,$2,NULL) AS r`, ['Bar da Sogra 2', SLUG_1],
      (row, err) => ({ ok: err !== null && err.includes('slug ja esta em uso'), detail: err || JSON.stringify(row?.r) }));
    const cnt = await superScalar(`SELECT count(*)::int AS n FROM public.stores WHERE slug = $1`, [SLUG_1]);
    record('ITEM3-sem-duplicata', 'apenas 1 linha com este slug (a rejeicao nao deixou lixo)', cnt?.n === 1 ? 'PASS' : 'FAIL', JSON.stringify(cnt));
  });
  out('');

  out('— ITEM 4: nome/slug invalidos sao rejeitados, sem criar linha —');
  await tx('authenticated', SUPER_ADMIN_TESTE, setupSuperAdmin(), async () => {
    await callRpc('ITEM4-nome-vazio', 'nome com 1 caractere -> erro', `SELECT public.provision_store($1,$2,NULL) AS r`, ['X', 'loja-x-teste-onda8'],
      (row, err) => ({ ok: err !== null && err.includes('nome invalido'), detail: err || JSON.stringify(row?.r) }));
    await callRpc('ITEM4-slug-maiuscula', 'slug com maiuscula/espaco -> erro', `SELECT public.provision_store($1,$2,NULL) AS r`, ['Loja Teste', 'Slug Invalido'],
      (row, err) => ({ ok: err !== null && err.includes('slug invalido'), detail: err || JSON.stringify(row?.r) }));
    const cnt = await superScalar(`SELECT count(*)::int AS n FROM public.stores WHERE slug IN ('loja-x-teste-onda8','slug invalido','Slug Invalido')`, []);
    record('ITEM4-sem-linha-parcial', 'nenhuma das duas tentativas invalidas deixou linha em stores', cnt?.n === 0 ? 'PASS' : 'FAIL', JSON.stringify(cnt));
  });
  out('');

  out('— ITEM 5: AUTORIZACAO — admin de outra loja (nao super admin) NAO consegue provisionar —');
  await tx('authenticated', ADMIN_B, [], async () => {
    await callRpc('ITEM5-admin-comum-N', 'admin de loja comum recebe 42501 ao chamar provision_store', `SELECT public.provision_store($1,$2,NULL) AS r`, ['Loja Nao Autorizada', 'loja-nao-autorizada-onda8'],
      (row, err) => ({ ok: err !== null && err.includes('apenas o super admin'), detail: err || JSON.stringify(row?.r) }));
  });
  out('');

  out('— ITEM 6: AUTORIZACAO — anon/stranger NAO conseguem provisionar —');
  await tx('authenticated', STRANGER, [], async () => {
    await callRpc('ITEM6-stranger-N', 'usuario autenticado sem nenhum vinculo administrativo recebe 42501', `SELECT public.provision_store($1,$2,NULL) AS r`, ['Loja Stranger', 'loja-stranger-onda8'],
      (row, err) => ({ ok: err !== null && err.includes('apenas o super admin'), detail: err || JSON.stringify(row?.r) }));
  });
  await tx('anon', null, [], async () => {
    await callRpc('ITEM6-anon-N', 'anon recebe erro (RLS/grant) ao chamar provision_store', `SELECT public.provision_store($1,$2,NULL) AS r`, ['Loja Anon', 'loja-anon-onda8'],
      (row, err) => ({ ok: err !== null, detail: err || JSON.stringify(row?.r) }));
  });
  out('');

  out('— ITEM 7: link_store_admin vincula um e-mail EXISTENTE; a pessoa vinculada passa a ser admin daquela loja —');
  await tx('authenticated', SUPER_ADMIN_TESTE, setupSuperAdmin(), async () => {
    const { result: r1 } = await callRpc('ITEM7-setup', 'provisiona a loja base', `SELECT public.provision_store($1,$2,NULL) AS r`, ['Bar da Sogra (teste)', SLUG_1], (row, err) => ({ ok: err === null, detail: err || 'ok' }));
    const id = r1?.r?.store_id;
    const emailB = await superScalar(`SELECT email FROM auth.users WHERE id = $1`, [ADMIN_B]);
    const { result: r2 } = await callRpc('ITEM7-link', 'link_store_admin vincula pelo e-mail (resolvido em runtime, nunca hardcoded)', `SELECT public.link_store_admin($1,$2) AS r`, [id, emailB.email],
      (row, err) => ({ ok: err === null && row?.r?.vinculado === true, detail: err || JSON.stringify(row?.r) }));
    const ehAdmin = await superScalar(`SELECT EXISTS(SELECT 1 FROM public.admins WHERE store_id=$1 AND user_id=$2) AS ok`, [id, ADMIN_B]);
    record('ITEM7-linha-criada', 'linha real em admins(store_id, user_id) apos o vinculo', ehAdmin?.ok ? 'PASS' : 'FAIL', JSON.stringify(ehAdmin));
  });
  out('');

  out('— ITEM 8: idempotencia — vincular o MESMO e-mail de novo devolve motivo, sem erro e sem duplicar —');
  await tx('authenticated', SUPER_ADMIN_TESTE, setupSuperAdmin(), async () => {
    const { result: r1 } = await callRpc('ITEM8-setup', 'provisiona + vincula uma vez', `SELECT public.provision_store($1,$2,NULL) AS r`, ['Bar da Sogra (teste)', SLUG_1], (row, err) => ({ ok: err === null, detail: err || 'ok' }));
    const id = r1?.r?.store_id;
    const emailB = await superScalar(`SELECT email FROM auth.users WHERE id = $1`, [ADMIN_B]);
    await client.query(`SELECT public.link_store_admin($1,$2)`, [id, emailB.email]);
    await callRpc('ITEM8-repete', 'segunda tentativa: vinculado=false, motivo "ja e administrador"', `SELECT public.link_store_admin($1,$2) AS r`, [id, emailB.email],
      (row, err) => ({ ok: err === null && row?.r?.vinculado === false && row?.r?.motivo?.includes('ja e administrador'), detail: err || JSON.stringify(row?.r) }));
    const cnt = await superScalar(`SELECT count(*)::int AS n FROM public.admins WHERE store_id=$1 AND user_id=$2`, [id, ADMIN_B]);
    record('ITEM8-sem-duplicata', 'apenas 1 linha em admins mesmo apos 2 tentativas de vinculo', cnt?.n === 1 ? 'PASS' : 'FAIL', JSON.stringify(cnt));
  });
  out('');

  out('— ITEM 9: e-mail SEM conta ainda -- devolve motivo explicito, SEM erro (estado esperado do fluxo assistido) —');
  await tx('authenticated', SUPER_ADMIN_TESTE, setupSuperAdmin(), async () => {
    const { result: r1 } = await callRpc('ITEM9-setup', 'provisiona a loja base', `SELECT public.provision_store($1,$2,NULL) AS r`, ['Bar da Sogra (teste)', SLUG_1], (row, err) => ({ ok: err === null, detail: err || 'ok' }));
    const id = r1?.r?.store_id;
    await callRpc('ITEM9-sem-conta', 'e-mail inexistente -> vinculado=false, motivo pede criacao manual da conta', `SELECT public.link_store_admin($1,$2) AS r`, [id, 'ninguem-tem-esta-conta-onda8@exemplo.invalido'],
      (row, err) => ({ ok: err === null && row?.r?.vinculado === false && row?.r?.motivo?.includes('nao existe nenhuma conta'), detail: err || JSON.stringify(row?.r) }));
  });
  out('');

  out('— ITEM 10: e-mail malformado e rejeitado (erro de validacao, nao um "nao encontrado") —');
  await tx('authenticated', SUPER_ADMIN_TESTE, setupSuperAdmin(), async () => {
    const { result: r1 } = await callRpc('ITEM10-setup', 'provisiona a loja base', `SELECT public.provision_store($1,$2,NULL) AS r`, ['Bar da Sogra (teste)', SLUG_1], (row, err) => ({ ok: err === null, detail: err || 'ok' }));
    const id = r1?.r?.store_id;
    await callRpc('ITEM10-malformado', 'string sem @ nem dominio -> erro "email invalido"', `SELECT public.link_store_admin($1,$2) AS r`, [id, 'nao-e-um-email'],
      (row, err) => ({ ok: err !== null && err.includes('email invalido'), detail: err || JSON.stringify(row?.r) }));
  });
  out('');

  out('— ITEM 11: provision_store com e-mail JUNTO cria a loja E vincula em 1 chamada so —');
  await tx('authenticated', SUPER_ADMIN_TESTE, setupSuperAdmin(), async () => {
    const emailStranger = await superScalar(`SELECT email FROM auth.users WHERE id = $1`, [STRANGER]);
    const { result } = await callRpc('ITEM11-combinado', 'provision_store(nome,slug,email) devolve admin.vinculado=true no mesmo retorno', `SELECT public.provision_store($1,$2,$3) AS r`, ['Loja C (teste)', SLUG_C, emailStranger.email],
      (row, err) => ({ ok: err === null && row?.r?.admin?.vinculado === true, detail: err || JSON.stringify(row?.r) }));
    const id = result?.r?.store_id;
    const ehAdmin = await superScalar(`SELECT EXISTS(SELECT 1 FROM public.admins WHERE store_id=$1 AND user_id=$2) AS ok`, [id, STRANGER]);
    record('ITEM11-linha-criada', 'STRANGER passa a ter linha em admins para a Loja C', ehAdmin?.ok ? 'PASS' : 'FAIL', JSON.stringify(ehAdmin));
  });
  out('');

  out('— ITEM 12: REGRESSAO — ser admin de uma loja vinculada NAO promove a super admin (ADMIN_B continua sem poder provisionar) —');
  await tx('authenticated', SUPER_ADMIN_TESTE, setupSuperAdmin(), async () => {
    const { result: r1 } = await callRpc('ITEM12-setup', 'provisiona + vincula ADMIN_B', `SELECT public.provision_store($1,$2,NULL) AS r`, ['Bar da Sogra (teste)', SLUG_1], (row, err) => ({ ok: err === null, detail: err || 'ok' }));
    const id = r1?.r?.store_id;
    const emailB = await superScalar(`SELECT email FROM auth.users WHERE id = $1`, [ADMIN_B]);
    await client.query(`SELECT public.link_store_admin($1,$2)`, [id, emailB.email]);
  });
  await tx('authenticated', ADMIN_B, [], async () => {
    await callRpc('ITEM12-ainda-nega', 'ADMIN_B (agora admin de 2 lojas) ainda recebe 42501 ao tentar provisionar', `SELECT public.provision_store($1,$2,NULL) AS r`, ['Loja Indevida', 'loja-indevida-onda8'],
      (row, err) => ({ ok: err !== null && err.includes('apenas o super admin'), detail: err || JSON.stringify(row?.r) }));
  });
  out('');

  out('— ITEM 13: ATOMICIDADE — vinculo de admin com e-mail malformado desfaz a loja inteira (nenhuma linha parcial) —');
  await tx('authenticated', SUPER_ADMIN_TESTE, setupSuperAdmin(), async () => {
    await callRpc('ITEM13-falha-no-vinculo', 'provision_store com e-mail malformado propaga o erro (nao cria nada)', `SELECT public.provision_store($1,$2,$3) AS r`, ['Loja Atomicidade', SLUG_ATOMICIDADE, 'nao-e-um-email'],
      (row, err) => ({ ok: err !== null && err.includes('email invalido'), detail: err || JSON.stringify(row?.r) }));
    const cnt = await superScalar(`SELECT count(*)::int AS n FROM public.stores WHERE slug = $1`, [SLUG_ATOMICIDADE]);
    record('ITEM13-zero-linha', 'a loja NAO existe apos o erro no vinculo (atomicidade real, nao so da transacao de teste)', cnt?.n === 0 ? 'PASS' : 'FAIL', JSON.stringify(cnt));
  });
  out('');

  out('— REGRESSAO: zero mutacao liquida (lojas/vinculos/super_admins ficticios) em producao —');
  {
    const r = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.stores WHERE slug IN ('${SLUG_1}','${SLUG_C}','${SLUG_ATOMICIDADE}','loja-x-teste-onda8','loja-nao-autorizada-onda8','loja-stranger-onda8','loja-anon-onda8','loja-indevida-onda8')) AS lojas_fake,
        (SELECT count(*)::int FROM public.super_admins WHERE user_id = '${SUPER_ADMIN_TESTE}') AS super_admin_fake`);
    const row = r.rows[0];
    const ok = Object.values(row).every(n => n === 0);
    if (ok) passes++; else failures++;
    out(`  [${ok ? 'PASS' : 'FAIL'}] REGRESSAO zero mutacao liquida`); out(`         -> ${JSON.stringify(row)}`);
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
  console.log('ETAPA — TESTES DA FASE (REF-SAAS-01 · Onda 8)');
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
