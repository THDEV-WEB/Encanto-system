// scripts/prod-readiness-01-a6-set-password-test.mjs — REF-PROD-READINESS-01 (A6), gate real.
// Prova platform-set-store-admin-password de ponta a ponta via chamada de rede real (Edge Function),
// nunca simulavel so com claims em BEGIN/ROLLBACK. Cria e destroi TUDO que usa (loja descartavel +
// admin descartavel) -- nunca toca ADMIN_FIXTURE/ADMIN_B_FIXTURE nem qualquer store/fixture existente.
// Roda SOMENTE contra o projeto E2E (.env.e2e). Exit 0 = SUCCESS.
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

console.log('==================================================================');
console.log(' REF-PROD-READINESS-01 (A6) · platform-set-store-admin-password -- E2E');
console.log('==================================================================\n');

const SLUG = `a6-teste-${Date.now()}`;
const DISPOSABLE_EMAIL = `a6-teste-admin-${Date.now()}@teste.encanto.local`;
const SENHA_INICIAL = `Inicial${randomBytes(6).toString('base64url')}!1`;
const SENHA_NOVA = `Nova${randomBytes(6).toString('base64url')}!1`;

let storeId = null;
let disposableUserId = null;
let adminFixtureId = null;

try {
  // ADMIN_FIXTURE NAO e' super admin permanente no projeto E2E -- so' vira super admin dentro da janela
  // de um teste que precisa disso (mesmo padrao de platform-console.spec.js: upsert em beforeEach,
  // delete em afterEach). Replicado aqui, com a mesma limpeza no finally.
  adminFixtureId = await idDoAdminFixture();
  await admin.from('super_admins').upsert({ user_id: adminFixtureId }, { onConflict: 'user_id' });
  // Setup: loja descartavel + admin descartavel, vinculado.
  const { data: loja, error: lojaErr } = await admin.from('stores')
    .insert({ slug: SLUG, nome: 'A6 Teste Descartavel', status: 'ativo' })
    .select('id').single();
  if (lojaErr) throw new Error(`setup loja: ${lojaErr.message}`);
  storeId = loja.id;

  const { data: novoUsuario, error: createErr } = await admin.auth.admin.createUser({
    email: DISPOSABLE_EMAIL, password: SENHA_INICIAL, email_confirm: true,
  });
  if (createErr) throw new Error(`setup usuario: ${createErr.message}`);
  disposableUserId = novoUsuario.user.id;

  const { error: linkErr } = await admin.from('admins').insert({ store_id: storeId, user_id: disposableUserId });
  if (linkErr) throw new Error(`setup vinculo admin: ${linkErr.message}`);

  console.log('— Setup OK: loja e admin descartaveis criados —\n');

  // Login como ADMIN_FIXTURE (ja e' super admin no projeto E2E). Fixture usa a chave `senha`
  // (fixture-accounts.js), signInWithPassword espera `password` -- mapeado explicitamente.
  const superAdminClient = anonClient();
  const { data: loginSuper, error: loginSuperErr } = await superAdminClient.auth.signInWithPassword({ email: ADMIN_FIXTURE.email, password: ADMIN_FIXTURE.senha });
  check('login como ADMIN_FIXTURE (super admin) OK', !loginSuperErr && !!loginSuper?.session, loginSuperErr?.message);

  console.log('\n— ATAQUE/NEGATIVO 1: sem Authorization —');
  {
    const resp = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/platform-set-store-admin-password`, {
      method: 'POST',
      headers: { apikey: env.VITE_SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: disposableUserId, newPassword: SENHA_NOVA }),
    });
    const body = await resp.json().catch(() => null);
    // Pode ser recusado pelo gateway do Supabase (verify_jwt, antes de chegar no nosso codigo) ou pela
    // nossa propria checagem -- os dois sao evidencia valida de "recusado sem Authorization".
    check('sem Authorization -> recusado (gateway ou codigo proprio)', resp.status !== 200 || body?.error === true, JSON.stringify(body));
  }

  console.log('\n— NEGATIVO 2: caller autenticado, mas NAO e super admin (o proprio admin descartavel) —');
  {
    const naoSuperClient = anonClient();
    const { data: loginNaoSuper } = await naoSuperClient.auth.signInWithPassword({ email: DISPOSABLE_EMAIL, password: SENHA_INICIAL });
    const { data, error } = await naoSuperClient.functions.invoke('platform-set-store-admin-password', {
      body: { userId: disposableUserId, newPassword: SENHA_NOVA },
    });
    check('admin comum (nao super) -> recusado', !error && data?.error === true, JSON.stringify({ error: error?.message, data }));
    await naoSuperClient.auth.signOut();
  }

  console.log('\n— NEGATIVO 3: super admin, senha curta (<8) —');
  {
    const { data, error } = await superAdminClient.functions.invoke('platform-set-store-admin-password', {
      body: { userId: disposableUserId, newPassword: '1234567' },
    });
    check('senha < 8 caracteres -> recusado', !error && data?.error === true, JSON.stringify({ error: error?.message, data }));
  }

  console.log('\n— NEGATIVO 4: super admin, userId que NAO e admin de loja nenhuma (cliente fixture) —');
  {
    const { data: clienteRow } = await admin.from('customers').select('auth_user_id').eq('phone', CLIENTE_FIXTURE.telefone).limit(1).maybeSingle();
    const alvoNaoAdmin = clienteRow?.auth_user_id || randomUUID();
    const { data, error } = await superAdminClient.functions.invoke('platform-set-store-admin-password', {
      body: { userId: alvoNaoAdmin, newPassword: SENHA_NOVA },
    });
    check('userId nao-admin -> recusado (usuario_nao_e_admin_de_nenhuma_loja)', !error && data?.error === true && data?.reason === 'usuario_nao_e_admin_de_nenhuma_loja', JSON.stringify({ error: error?.message, data }));
  }

  console.log('\n— POSITIVO: super admin define senha nova do admin descartavel —');
  {
    const { data, error } = await superAdminClient.functions.invoke('platform-set-store-admin-password', {
      body: { userId: disposableUserId, newPassword: SENHA_NOVA },
    });
    check('chamada bem-sucedida (ok:true)', !error && data?.ok === true, JSON.stringify({ error: error?.message, data }));
  }

  console.log('\n— VERIFICACAO REAL: login com a SENHA NOVA funciona (senha antiga nao) —');
  {
    const verifClient = anonClient();
    const { data: loginNova, error: erroNova } = await verifClient.auth.signInWithPassword({ email: DISPOSABLE_EMAIL, password: SENHA_NOVA });
    check('login com a senha NOVA funciona', !erroNova && !!loginNova?.session, erroNova?.message);
    await verifClient.auth.signOut();

    const verifClient2 = anonClient();
    const { error: erroAntiga } = await verifClient2.auth.signInWithPassword({ email: DISPOSABLE_EMAIL, password: SENHA_INICIAL });
    check('login com a senha ANTIGA nao funciona mais', !!erroAntiga, erroAntiga ? '(esperado)' : 'login antigo ainda funcionou -- FALHA');
  }

  await superAdminClient.auth.signOut();
} finally {
  console.log('\n— Limpeza —');
  if (adminFixtureId) {
    await admin.from('super_admins').delete().eq('user_id', adminFixtureId);
    console.log('ADMIN_FIXTURE revogado de super_admins (volta ao estado normal, so admin da Encanto).');
  }
  if (disposableUserId) {
    await admin.from('admins').delete().eq('user_id', disposableUserId);
    const { error } = await admin.auth.admin.deleteUser(disposableUserId);
    console.log(`Usuario descartavel removido${error ? ' (erro: ' + error.message + ')' : ''}.`);
  }
  if (storeId) {
    await admin.from('stores').delete().eq('id', storeId);
    console.log('Loja descartavel removida.');
  }
}

console.log('');
console.log(`— Resumo — PASS: ${passes} · FAIL: ${failures}`);
console.log('====================================');
console.log(`STATE: ${failures ? 'FAILED' : 'SUCCESS'} · PASS=${passes} FAIL=${failures}`);
console.log('====================================');
if (failures) process.exitCode = 1;
