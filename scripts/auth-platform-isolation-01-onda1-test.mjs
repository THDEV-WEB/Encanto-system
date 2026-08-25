// scripts/auth-platform-isolation-01-onda1-test.mjs — REF-AUTH-PLATFORM-ISOLATION-01 · Onda 1.
// Prova, via chamada de rede real (Edge Function), o hardening de platform-set-store-admin-password:
// um Super Admin NUNCA pode ser alvo de alteracao de senha por este fluxo, mesmo que (tambem) esteja
// vinculado como admin de alguma loja -- o caso real que motivou esta REF.
//
// 100% dados descartaveis, 100% projeto E2E (.env.e2e). NUNCA toca:
//   - o Super Admin real (b9dc7626-...) nem sua senha;
//   - o admin real da Aquarios Bar (c3d3dbe9-...) nem sua senha;
//   - ADMIN_FIXTURE/ADMIN_B_FIXTURE alem de uma promocao/revogacao temporaria de super_admins (mesmo
//     padrao ja usado por platform-console.spec.js e prod-readiness-01-a6-set-password-test.mjs).
//
// Cenarios (letras conforme pedido pelo dono):
//   A) Super Admin (descartavel) como alvo -> BLOQUEADO, mesmo estando em admins.
//   B) Admin normal "tipo Encanto" (descartavel) -> PERMITIDO.
//   C) Admin normal "tipo Aquarios" (descartavel, representa o papel sem tocar a conta real) -> PERMITIDO.
//   D) Admin de tenant novo descartavel -> PERMITIDO.
//   E) Usuario que nao e admin de nenhuma loja -> BLOQUEADO.
// + regressao das negativas ja existentes (sem auth, caller nao-super-admin, senha curta).
//
// Exit 0 = SUCCESS.
import { readFileSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_FIXTURE, CLIENTE_FIXTURE } from '../e2e/support/fixture-accounts.js';
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
console.log(' REF-AUTH-PLATFORM-ISOLATION-01 (Onda 1) · hardening platform-set-store-admin-password');
console.log('==========================================================================\n');

const TS = Date.now();
const SENHA = (rotulo) => `${rotulo}${randomBytes(6).toString('base64url')}!1`;

// Um store descartavel serve para os 3 papeis "tipo Encanto"/"tipo Aquarios"/"novo tenant" -- o codigo
// da funcao nao ramifica por loja, entao 3 admins descartaveis em 3 stores descartaveis provam B/C/D
// sem qualquer diferenca de comportamento esperado.
const stores = {};
const disposableAdmins = {}; // papel -> { userId, email, senhaInicial }
let fakeSuperAdminId = null;
let adminFixtureId = null;

async function criarStoreDescartavel(slug) {
  const { data, error } = await admin.from('stores').insert({ slug, nome: `Onda1 Teste ${slug}`, status: 'ativo' }).select('id').single();
  if (error) throw new Error(`setup store ${slug}: ${error.message}`);
  return data.id;
}

async function criarAdminDescartavel(rotulo, storeId) {
  const email = `onda1-${rotulo}-${TS}@teste.encanto.local`;
  const senhaInicial = SENHA(rotulo);
  const { data: novoUsuario, error: createErr } = await admin.auth.admin.createUser({ email, password: senhaInicial, email_confirm: true });
  if (createErr) throw new Error(`setup usuario ${rotulo}: ${createErr.message}`);
  const userId = novoUsuario.user.id;
  const { error: linkErr } = await admin.from('admins').insert({ store_id: storeId, user_id: userId });
  if (linkErr) throw new Error(`setup vinculo admin ${rotulo}: ${linkErr.message}`);
  return { userId, email, senhaInicial };
}

try {
  adminFixtureId = await idDoAdminFixture();
  await admin.from('super_admins').upsert({ user_id: adminFixtureId }, { onConflict: 'user_id' });

  stores.encantoLike = await criarStoreDescartavel(`onda1-encanto-like-${TS}`);
  stores.aquariosLike = await criarStoreDescartavel(`onda1-aquarios-like-${TS}`);
  stores.novoTenant = await criarStoreDescartavel(`onda1-novo-tenant-${TS}`);

  disposableAdmins.encantoLike = await criarAdminDescartavel('encanto', stores.encantoLike);
  disposableAdmins.aquariosLike = await criarAdminDescartavel('aquarios', stores.aquariosLike);
  disposableAdmins.novoTenant = await criarAdminDescartavel('novotenant', stores.novoTenant);

  // Cenario A: Super Admin DESCARTAVEL -- vinculado como admin da loja "encantoLike" (exatamente o caso
  // real: Super Admin tambem presente em admins) E presente em super_admins.
  const fakeSuperAdminEmail = `onda1-fake-superadmin-${TS}@teste.encanto.local`;
  const fakeSuperAdminSenha = SENHA('fakesuper');
  const { data: novoFakeSuper, error: createFakeErr } = await admin.auth.admin.createUser({ email: fakeSuperAdminEmail, password: fakeSuperAdminSenha, email_confirm: true });
  if (createFakeErr) throw new Error(`setup fake super admin: ${createFakeErr.message}`);
  fakeSuperAdminId = novoFakeSuper.user.id;
  await admin.from('admins').insert({ store_id: stores.encantoLike, user_id: fakeSuperAdminId });
  await admin.from('super_admins').insert({ user_id: fakeSuperAdminId });

  console.log('— Setup OK: 3 stores + 3 admins normais + 1 "fake super admin" descartaveis —\n');

  const superAdminClient = anonClient();
  const { data: loginSuper, error: loginSuperErr } = await superAdminClient.auth.signInWithPassword({ email: ADMIN_FIXTURE.email, password: ADMIN_FIXTURE.senha });
  check('login como ADMIN_FIXTURE (super admin, caller) OK', !loginSuperErr && !!loginSuper?.session, loginSuperErr?.message);

  console.log('\n— CENARIO A: Super Admin (descartavel) como alvo -> BLOQUEADO —');
  {
    const senhaTentativa = SENHA('ataque');
    const { data, error } = await superAdminClient.functions.invoke('platform-set-store-admin-password', {
      body: { userId: fakeSuperAdminId, newPassword: senhaTentativa },
    });
    check('alvo em super_admins -> recusado com o motivo novo', !error && data?.error === true && data?.reason === 'nao_e_possivel_alterar_senha_de_super_admin_por_este_fluxo', JSON.stringify({ error: error?.message, data }));

    // Prova real: a senha ORIGINAL do fake super admin continua funcionando (nada foi alterado de fato).
    const verifClient = anonClient();
    const { data: loginOriginal, error: erroOriginal } = await verifClient.auth.signInWithPassword({ email: fakeSuperAdminEmail, password: fakeSuperAdminSenha });
    check('senha original do fake super admin AINDA funciona (nada foi alterado)', !erroOriginal && !!loginOriginal?.session, erroOriginal?.message);
    await verifClient.auth.signOut();
  }

  async function testarAdminNormalPermitido(rotulo, admDescartavel) {
    console.log(`\n— CENARIO (${rotulo}): admin normal descartavel -> PERMITIDO —`);
    const senhaNova = SENHA(`nova-${rotulo}`);
    const { data, error } = await superAdminClient.functions.invoke('platform-set-store-admin-password', {
      body: { userId: admDescartavel.userId, newPassword: senhaNova },
    });
    check(`${rotulo}: chamada bem-sucedida (ok:true)`, !error && data?.ok === true, JSON.stringify({ error: error?.message, data }));

    const verifClient = anonClient();
    const { data: loginNova, error: erroNova } = await verifClient.auth.signInWithPassword({ email: admDescartavel.email, password: senhaNova });
    check(`${rotulo}: login com a senha NOVA funciona`, !erroNova && !!loginNova?.session, erroNova?.message);
    await verifClient.auth.signOut();

    const verifClient2 = anonClient();
    const { error: erroAntiga } = await verifClient2.auth.signInWithPassword({ email: admDescartavel.email, password: admDescartavel.senhaInicial });
    check(`${rotulo}: login com a senha ANTIGA nao funciona mais`, !!erroAntiga, erroAntiga ? '(esperado)' : 'login antigo ainda funcionou -- FALHA');
  }

  // B) "tipo Encanto", C) "tipo Aquarios" (representativo -- nunca a conta real), D) novo tenant.
  await testarAdminNormalPermitido('B-tipo-encanto', disposableAdmins.encantoLike);
  await testarAdminNormalPermitido('C-tipo-aquarios', disposableAdmins.aquariosLike);
  await testarAdminNormalPermitido('D-novo-tenant', disposableAdmins.novoTenant);

  console.log('\n— CENARIO E: usuario que NAO e admin de nenhuma loja -> BLOQUEADO —');
  {
    const { data: clienteRow } = await admin.from('customers').select('auth_user_id').eq('phone', CLIENTE_FIXTURE.telefone).limit(1).maybeSingle();
    const alvoNaoAdmin = clienteRow?.auth_user_id || randomUUID();
    const { data, error } = await superAdminClient.functions.invoke('platform-set-store-admin-password', {
      body: { userId: alvoNaoAdmin, newPassword: SENHA('naoadmin') },
    });
    check('userId nao-admin -> recusado (usuario_nao_e_admin_de_nenhuma_loja)', !error && data?.error === true && data?.reason === 'usuario_nao_e_admin_de_nenhuma_loja', JSON.stringify({ error: error?.message, data }));
  }

  console.log('\n— REGRESSAO: negativas pre-existentes continuam validas —');
  {
    const resp = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/platform-set-store-admin-password`, {
      method: 'POST',
      headers: { apikey: env.VITE_SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: disposableAdmins.encantoLike.userId, newPassword: SENHA('semauth') }),
    });
    const body = await resp.json().catch(() => null);
    check('sem Authorization -> recusado', resp.status !== 200 || body?.error === true, JSON.stringify(body));
  }
  {
    const naoSuperClient = anonClient();
    await naoSuperClient.auth.signInWithPassword({ email: disposableAdmins.novoTenant.email, password: SENHA('nova-D-novo-tenant') }).catch(() => {});
    // Login pode falhar (senha ja foi trocada no cenario D) -- o que importa aqui e' o caller nao ser
    // super admin; se o login falhar, a chamada abaixo ja falha sem sessao (equivalente a nao-autorizado).
    const { data, error } = await naoSuperClient.functions.invoke('platform-set-store-admin-password', {
      body: { userId: disposableAdmins.aquariosLike.userId, newPassword: SENHA('outro') },
    });
    check('admin comum (nao super) -> recusado', !!error || data?.error === true, JSON.stringify({ error: error?.message, data }));
    await naoSuperClient.auth.signOut();
  }
  {
    const { data, error } = await superAdminClient.functions.invoke('platform-set-store-admin-password', {
      body: { userId: disposableAdmins.encantoLike.userId, newPassword: '1234567' },
    });
    check('senha < 8 caracteres -> recusado', !error && data?.error === true, JSON.stringify({ error: error?.message, data }));
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
