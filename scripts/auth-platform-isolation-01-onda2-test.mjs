// scripts/auth-platform-isolation-01-onda2-test.mjs — REF-AUTH-PLATFORM-ISOLATION-01 · Onda 2.
// Prova, via chamada de rede real a RPC (platform_unlink_store_admin), o hardening do desvincular:
// um Super Admin NUNCA pode ser desvinculado de uma loja por este fluxo, mesmo estando (tambem)
// vinculado como admin -- o mesmo caso real da Onda 1, agora fechado tambem aqui.
//
// 100% dados descartaveis, 100% projeto E2E (.env.e2e). NUNCA toca:
//   - o Super Admin real (b9dc7626-...);
//   - o admin real da Aquarios Bar (c3d3dbe9-...);
//   - ADMIN_FIXTURE alem de uma promocao/revogacao temporaria de super_admins (mesmo padrao ja usado
//     por platform-console.spec.js e pelos scripts de teste anteriores desta REF).
//
// Cenarios (letras conforme pedido pelo dono):
//   A) Super Admin (descartavel) como alvo -> BLOQUEADO (RPC recusa, linha em admins preservada).
//   B) Admin normal descartavel -> DESVINCULACAO PERMITIDA.
//   C) Admin de outro tenant descartavel -> comportamento preservado (mesmo caminho de B, loja diferente).
//   D) Usuario sem vinculo de admin -> comportamento existente preservado: idempotente,
//      desvinculado=false, SEM erro (a RPC nunca distinguiu "nao era admin" de "ja tinha sido
//      desvinculado" -- DELETE de 0 linhas nunca foi erro, por desenho desde a REF-SAAS-02).
// + regressao: caller que nao e super admin continua recusado (autorizacao pre-existente, inalterada).
//
// Exit 0 = SUCCESS.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_FIXTURE } from '../e2e/support/fixture-accounts.js';
import { idDoAdminFixture } from '../e2e/support/supabaseAdmin.js';

function lerEnvE2e() {
  const txt = readFileSync('.env.e2e', 'utf8');
  const out = {};
  for (const linha of txt.split(/\r?\n/)) { const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i); if (m) out[m[1]] = m[2]; }
  return out;
}
const env = lerEnvE2e();
const anonClient = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(env.VITE_SUPABASE_URL, env.E2E_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let passes = 0, failures = 0;
function check(desc, ok, detail) {
  if (ok) { passes++; console.log(`  [PASS] ${desc}`); }
  else { failures++; console.log(`  [FAIL] ${desc} -> ${detail ?? ''}`); }
}

console.log('==========================================================================');
console.log(' REF-AUTH-PLATFORM-ISOLATION-01 (Onda 2) · hardening platform_unlink_store_admin');
console.log('==========================================================================\n');

const TS = Date.now();

const stores = {};
const disposableAdmins = {};
let fakeSuperAdminId = null;
let adminFixtureId = null;
let strangerId = null;

async function criarStoreDescartavel(slug) {
  const { data, error } = await admin.from('stores').insert({ slug, nome: `Onda2 Teste ${slug}`, status: 'ativo' }).select('id').single();
  if (error) throw new Error(`setup store ${slug}: ${error.message}`);
  return data.id;
}

async function criarAdminDescartavel(rotulo, storeId) {
  const email = `onda2-${rotulo}-${TS}@teste.encanto.local`;
  const senha = `${rotulo}${randomBytes(6).toString('base64url')}!1`;
  const { data: novoUsuario, error: createErr } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true });
  if (createErr) throw new Error(`setup usuario ${rotulo}: ${createErr.message}`);
  const userId = novoUsuario.user.id;
  const { error: linkErr } = await admin.from('admins').insert({ store_id: storeId, user_id: userId });
  if (linkErr) throw new Error(`setup vinculo admin ${rotulo}: ${linkErr.message}`);
  return { userId, email, senha };
}

async function linhaExiste(storeId, userId) {
  const { data } = await admin.from('admins').select('user_id').eq('store_id', storeId).eq('user_id', userId).maybeSingle();
  return !!data;
}

try {
  adminFixtureId = await idDoAdminFixture();
  await admin.from('super_admins').upsert({ user_id: adminFixtureId }, { onConflict: 'user_id' });

  stores.tenantB = await criarStoreDescartavel(`onda2-tenant-b-${TS}`);
  stores.tenantC = await criarStoreDescartavel(`onda2-tenant-c-${TS}`);
  stores.tenantFakeSuper = await criarStoreDescartavel(`onda2-tenant-fakesuper-${TS}`);

  disposableAdmins.B = await criarAdminDescartavel('B', stores.tenantB);
  disposableAdmins.C = await criarAdminDescartavel('C', stores.tenantC);
  // Caller para a regressao: admin comum descartavel, NUNCA promovido a super_admins -- prova que a
  // checagem is_super_admin() do caller (1a linha da RPC, ja existente, nao tocada por esta migration)
  // continua recusando quem nao e' super admin.
  disposableAdmins.callerComum = await criarAdminDescartavel('callercomum', stores.tenantC);

  // Cenario A: Super Admin DESCARTAVEL -- vinculado como admin (exatamente o caso real) E em super_admins.
  const fakeSuperAdminEmail = `onda2-fake-superadmin-${TS}@teste.encanto.local`;
  const { data: novoFakeSuper, error: createFakeErr } = await admin.auth.admin.createUser({ email: fakeSuperAdminEmail, password: `fakesuper${randomBytes(6).toString('base64url')}!1`, email_confirm: true });
  if (createFakeErr) throw new Error(`setup fake super admin: ${createFakeErr.message}`);
  fakeSuperAdminId = novoFakeSuper.user.id;
  await admin.from('admins').insert({ store_id: stores.tenantFakeSuper, user_id: fakeSuperAdminId });
  await admin.from('super_admins').insert({ user_id: fakeSuperAdminId });

  // Cenario D: usuario sem NENHUM vinculo de admin (nao criado em admins de proposito).
  const { data: novoStranger, error: strangerErr } = await admin.auth.admin.createUser({ email: `onda2-stranger-${TS}@teste.encanto.local`, password: `stranger${randomBytes(6).toString('base64url')}!1`, email_confirm: true });
  if (strangerErr) throw new Error(`setup stranger: ${strangerErr.message}`);
  strangerId = novoStranger.user.id;

  console.log('— Setup OK: 3 stores + 2 admins normais + 1 "fake super admin" + 1 usuario sem vinculo, todos descartaveis —\n');

  const superAdminClient = anonClient();
  const { data: loginSuper, error: loginSuperErr } = await superAdminClient.auth.signInWithPassword({ email: ADMIN_FIXTURE.email, password: ADMIN_FIXTURE.senha });
  check('login como ADMIN_FIXTURE (super admin, caller) OK', !loginSuperErr && !!loginSuper?.session, loginSuperErr?.message);

  console.log('\n— CENARIO A: Super Admin (descartavel) como alvo -> BLOQUEADO —');
  {
    const { data, error } = await superAdminClient.rpc('platform_unlink_store_admin', {
      p_store_id: stores.tenantFakeSuper, p_user_id: fakeSuperAdminId,
    });
    check('RPC recusa com excecao (nao retorna sucesso)', !!error, JSON.stringify({ error: error?.message, data }));
    check('mensagem de erro menciona Super Admin', !!error?.message && /super\s*admin/i.test(error.message), error?.message);
    const aindaVinculado = await linhaExiste(stores.tenantFakeSuper, fakeSuperAdminId);
    check('linha em admins NAO foi removida (nada foi alterado de fato)', aindaVinculado === true, `existe=${aindaVinculado}`);
  }

  async function testarDesvinculoPermitido(rotulo, storeId, admDescartavel) {
    console.log(`\n— CENARIO (${rotulo}): admin normal descartavel -> DESVINCULACAO PERMITIDA —`);
    const { data, error } = await superAdminClient.rpc('platform_unlink_store_admin', {
      p_store_id: storeId, p_user_id: admDescartavel.userId,
    });
    check(`${rotulo}: chamada bem-sucedida (desvinculado:true)`, !error && data?.desvinculado === true, JSON.stringify({ error: error?.message, data }));
    const removido = await linhaExiste(storeId, admDescartavel.userId);
    check(`${rotulo}: linha realmente removida de admins`, removido === false, `existe=${removido}`);
  }

  // B) admin normal, C) admin de outro tenant -- mesma logica, lojas diferentes.
  await testarDesvinculoPermitido('B', stores.tenantB, disposableAdmins.B);
  await testarDesvinculoPermitido('C', stores.tenantC, disposableAdmins.C);

  console.log('\n— CENARIO D: usuario sem vinculo de admin -> comportamento existente preservado (idempotente, sem erro) —');
  {
    const { data, error } = await superAdminClient.rpc('platform_unlink_store_admin', {
      p_store_id: stores.tenantB, p_user_id: strangerId,
    });
    check('DELETE de 0 linhas -> desvinculado:false, sem erro (idempotente, regra pre-existente)', !error && data?.desvinculado === false, JSON.stringify({ error: error?.message, data }));
  }

  console.log('\n— REGRESSAO: caller que nao e super admin continua recusado (autorizacao pre-existente) —');
  {
    const naoSuperClient = anonClient();
    const { error: loginErr } = await naoSuperClient.auth.signInWithPassword({ email: disposableAdmins.callerComum.email, password: disposableAdmins.callerComum.senha });
    check('login como admin comum (nao super) OK', !loginErr, loginErr?.message);
    const { data, error } = await naoSuperClient.rpc('platform_unlink_store_admin', {
      p_store_id: stores.tenantB, p_user_id: strangerId,
    });
    check('caller nao-super-admin -> recusado (autorizacao pre-existente, nao alterada por esta migration)', !!error, JSON.stringify({ error: error?.message, data }));
    await naoSuperClient.auth.signOut();
  }

  await superAdminClient.auth.signOut();
} finally {
  console.log('\n— Limpeza —');
  if (adminFixtureId) {
    await admin.from('super_admins').delete().eq('user_id', adminFixtureId);
    console.log('ADMIN_FIXTURE revogado de super_admins.');
  }
  if (fakeSuperAdminId) {
    await admin.from('super_admins').delete().eq('user_id', fakeSuperAdminId);
    await admin.from('admins').delete().eq('user_id', fakeSuperAdminId);
    await admin.auth.admin.deleteUser(fakeSuperAdminId).catch(() => {});
    console.log('Fake super admin descartavel removido.');
  }
  if (strangerId) {
    await admin.auth.admin.deleteUser(strangerId).catch(() => {});
    console.log('Usuario "stranger" descartavel removido.');
  }
  for (const [rotulo, a] of Object.entries(disposableAdmins)) {
    await admin.from('admins').delete().eq('user_id', a.userId);
    await admin.auth.admin.deleteUser(a.userId).catch(() => {});
    console.log(`Admin descartavel (${rotulo}) removido.`);
  }
  for (const storeId of Object.values(stores)) {
    await admin.from('stores').delete().eq('id', storeId);
  }
  console.log('Stores descartaveis removidas.');
}

console.log('');
console.log(`— Resumo — PASS: ${passes} · FAIL: ${failures}`);
console.log('====================================');
console.log(`STATE: ${failures ? 'FAILED' : 'SUCCESS'} · PASS=${passes} FAIL=${failures}`);
console.log('====================================');
if (failures) process.exitCode = 1;
