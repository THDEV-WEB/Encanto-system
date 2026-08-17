// scripts/auth-tenant-onda4-e2e-real-test.mjs — REF-AUTH-TENANT-01 · Onda 4.
// Prova real de ponta a ponta: importa os MODULOS DE VERDADE do frontend (src/services/tenantSync.js,
// src/utils/jwt.js) e os roda contra logins REAIS no projeto E2E dedicado (nunca producao) — o que este
// script testa e EXATAMENTE o codigo que o AuthProvider chama, nao uma reimplementacao paralela.
// Fixtures desta onda (criadas via SQL direto no E2E, ja existentes antes deste script rodar):
//   - stores: Encanto (real, ja existia), "Bar da Sogra (fixture E2E)" (ativo), "Loja Inativa (fixture
//     E2E)" (suspenso) — as 2 novas linkadas ao MESMO auth_user_id do cliente fixture (mesma pessoa,
//     contas legitimas em 2 lojas + 1 loja sem chance de ativar por estar inativa).
// Roda: node scripts/auth-tenant-onda4-e2e-real-test.mjs
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'node:module';
import { syncTenant } from '../src/services/tenantSync.js';
import { decodeJwtPayload } from '../src/utils/jwt.js';

const require = createRequire('C:/Users/00thi/.encanto/package.json');
const pg = require('pg');

function lerEnvE2eDb() {
  const txt = readFileSync('C:/Users/00thi/.encanto/db.e2e.env', 'utf8');
  const g = (k) => { const m = txt.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
  return { host: g('PGHOST'), port: Number(g('PGPORT') || 5432), user: g('PGUSER'), password: g('PGPASSWORD'), database: g('PGDATABASE') || 'postgres' };
}
async function activeTenantExiste(sessionId) {
  const client = new pg.Client({ ...lerEnvE2eDb(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  await client.connect();
  const r = await client.query('SELECT count(*)::int AS n FROM public.active_tenant WHERE session_id = $1', [sessionId]);
  await client.end();
  return r.rows[0].n > 0;
}

function lerEnvE2e() {
  const txt = readFileSync('.env.e2e', 'utf8');
  const out = {};
  for (const linha of txt.split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const CLIENTE_FIXTURE = { email: 'e2e-cliente@teste.encanto.local', password: 'e2e-fixture-nao-usar-em-prod-9f2b' };
const ENCANTO = 'be2efc10-c0c8-410f-bcd4-af3f8a371df3';
const BAR = '99999999-9999-4999-8999-999999999998';
const LOJA_INATIVA = '99999999-9999-4999-8999-999999999996';
const LOJA_INEXISTENTE = '11111111-1111-4111-8111-111111111111';

const env = lerEnvE2e();
const novoClient = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const tenantId = (session) => decodeJwtPayload(session.access_token)?.tenant_id ?? null;

let passes = 0, failures = 0;
function check(desc, ok, detail) {
  if (ok) { passes++; console.log(`  [PASS] ${desc}`); }
  else { failures++; console.log(`  [FAIL] ${desc} -> ${detail ?? ''}`); }
}

console.log('==================================================================');
console.log(' REF-AUTH-TENANT-01 · Onda 4 — prova real contra o projeto E2E');
console.log('==================================================================\n');

// ── ITEM 1/2: login -> sem tenant (comportamento seguro ate activate_tenant) ──
const dbA = novoClient();
{
  const { data, error } = await dbA.auth.signInWithPassword(CLIENTE_FIXTURE);
  check('ITEM1/2 login real OK', !error && !!data?.session, error?.message);
  check('ITEM2 token de login NAO tem tenant_id (seguro ate activate_tenant)', tenantId(data.session) === null, tenantId(data.session));
}

// ── ITEM 3: Encanto -> JWT tenant Encanto ──
{
  const { data: loginA } = await dbA.auth.getSession();
  const r = await syncTenant({ dbCliente: dbA, accessToken: loginA.session.access_token, storeId: ENCANTO, storeStatus: 'ativo' });
  check('ITEM3 syncTenant(Encanto) ativou', r.ativado === true, JSON.stringify(r));
  const { data } = await dbA.auth.getSession();
  check('ITEM3 JWT real agora tem tenant_id=Encanto', tenantId(data.session) === ENCANTO, tenantId(data.session));
}

// ── ITEM 8 (parte 1): refresh com o MESMO tenant -> idempotente, zero chamada extra ──
{
  const { data: antes } = await dbA.auth.getSession();
  const chamadasAntes = [];
  const dbEspiao = { rpc: async (...a) => { chamadasAntes.push(a); return dbA.rpc(...a); }, auth: dbA.auth };
  const r = await syncTenant({ dbCliente: dbEspiao, accessToken: antes.session.access_token, storeId: ENCANTO, storeStatus: 'ativo' });
  check('ITEM8 syncTenant com tenant JA correto -> zero chamada de RPC (idempotente)', chamadasAntes.length === 0 && r.ativado === false, JSON.stringify({ chamadas: chamadasAntes.length, r }));
}

// ── ITEM 5: troca Encanto -> Bar ──
{
  const { data: antes } = await dbA.auth.getSession();
  const r = await syncTenant({ dbCliente: dbA, accessToken: antes.session.access_token, storeId: BAR, storeStatus: 'ativo' });
  check('ITEM5 syncTenant(Bar) a partir de Encanto ativou', r.ativado === true, JSON.stringify(r));
  const { data: depois } = await dbA.auth.getSession();
  check('ITEM5 JWT real agora tem tenant_id=Bar (trocou de verdade)', tenantId(depois.session) === BAR, tenantId(depois.session));
  check('ITEM5 session_id preservado na troca (mesma sessao, so o token mudou)', decodeJwtPayload(antes.session.access_token).session_id === decodeJwtPayload(depois.session.access_token).session_id, '');
}

// ── ITEM 6: troca Bar -> Encanto (volta) ──
{
  const { data: antes } = await dbA.auth.getSession();
  const r = await syncTenant({ dbCliente: dbA, accessToken: antes.session.access_token, storeId: ENCANTO, storeStatus: 'ativo' });
  check('ITEM6 syncTenant(Encanto) a partir de Bar (volta) ativou', r.ativado === true, JSON.stringify(r));
  const { data: depois } = await dbA.auth.getSession();
  check('ITEM6 JWT real voltou a tenant_id=Encanto', tenantId(depois.session) === ENCANTO, tenantId(depois.session));
}

// ── ITEM 11/12: loja SEM vinculo/inexistente/inativa -> NAO concede tenant, sem crash ──
{
  const { data: antes } = await dbA.auth.getSession();
  const r1 = await syncTenant({ dbCliente: dbA, accessToken: antes.session.access_token, storeId: LOJA_INEXISTENTE, storeStatus: 'ativo' });
  check('ITEM12 loja inexistente -> syncTenant nao ativa (sem crash)', r1.ativado === false && !!r1.error, JSON.stringify(r1));
  const { data: depoisInexistente } = await dbA.auth.getSession();
  check('ITEM12 JWT continua com o tenant anterior (Encanto), nao mudou pra loja inexistente', tenantId(depoisInexistente.session) === ENCANTO, tenantId(depoisInexistente.session));

  const r2 = await syncTenant({ dbCliente: dbA, accessToken: depoisInexistente.session.access_token, storeId: LOJA_INATIVA, storeStatus: 'suspenso' });
  check('ITEM12b loja inativa -> precisaAtivarTenant ja barra antes de chamar RPC (storeStatus != ativo)', r2.ativado === false, JSON.stringify(r2));
}

// ── ITEM 7: DUAS ABAS (2 sessoes reais e simultaneas da mesma pessoa, tenants diferentes) ──
const dbB = novoClient();
{
  const { data: loginB } = await dbB.auth.signInWithPassword(CLIENTE_FIXTURE);
  check('ITEM7 2a sessao real (aba B) logou OK', !!loginB?.session, '');
  const rB = await syncTenant({ dbCliente: dbB, accessToken: loginB.session.access_token, storeId: BAR, storeStatus: 'ativo' });
  check('ITEM7 aba B ativou Bar', rB.ativado === true, JSON.stringify(rB));

  const { data: sessA } = await dbA.auth.getSession();
  const { data: sessB } = await dbB.auth.getSession();
  check('ITEM7 aba A continua Encanto', tenantId(sessA.session) === ENCANTO, tenantId(sessA.session));
  check('ITEM7 aba B continua Bar', tenantId(sessB.session) === BAR, tenantId(sessB.session));
  check('ITEM7 session_id das 2 abas sao DIFERENTES (sessoes de verdade distintas)', decodeJwtPayload(sessA.session.access_token).session_id !== decodeJwtPayload(sessB.session.access_token).session_id, '');
}

// ── ITEM 9: logout/login -> contexto correto, sessao antiga limpa (CASCADE) ──
{
  const { data: sessAntes } = await dbA.auth.getSession();
  const sessionIdAntigo = decodeJwtPayload(sessAntes.session.access_token).session_id;
  check('ITEM9-pre linha em active_tenant existe ENQUANTO a sessao esta viva', await activeTenantExiste(sessionIdAntigo), '');
  await dbA.auth.signOut();
  check('ITEM9 signOut() -> linha em active_tenant SOME (CASCADE de auth.sessions, confirmado empiricamente)', !(await activeTenantExiste(sessionIdAntigo)), '');

  const dbC = novoClient();
  const { data: loginC } = await dbC.auth.signInWithPassword(CLIENTE_FIXTURE);
  check('ITEM9 login novo pos-logout OK', !!loginC?.session, '');
  check('ITEM9 sessao NOVA tem session_id DIFERENTE da antiga', decodeJwtPayload(loginC.session.access_token).session_id !== sessionIdAntigo, '');
  check('ITEM9 token de login novo NAO tem tenant_id (contexto limpo, nada herdado)', tenantId(loginC.session) === null, tenantId(loginC.session));

  const rC = await syncTenant({ dbCliente: dbC, accessToken: loginC.session.access_token, storeId: BAR, storeStatus: 'ativo' });
  check('ITEM9 nova sessao ativa Bar corretamente', rC.ativado === true, JSON.stringify(rC));
  await dbC.auth.signOut();
}

await dbB.auth.signOut(); // limpeza -- nao deixa a sessao da "aba B" aberta desnecessariamente

console.log('');
console.log(`— Resumo — PASS: ${passes} · FAIL: ${failures}`);
console.log('====================================');
console.log(`STATE: ${failures ? 'FAILED' : 'SUCCESS'} · PASS=${passes} FAIL=${failures}`);
console.log('====================================');
if (failures) process.exitCode = 1;
