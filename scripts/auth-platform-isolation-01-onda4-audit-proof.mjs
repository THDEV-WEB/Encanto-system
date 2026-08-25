// scripts/auth-platform-isolation-01-onda4-audit-proof.mjs — REF-AUTH-PLATFORM-ISOLATION-01 · Onda 4.
// Prova empirica (chamada de rede real, projeto E2E) da alegacao central que sustenta a Onda 5-7 desta
// REF: um Super Admin SEM nenhuma linha em public.admins para uma loja continua conseguindo operar
// aquela loja inteira (Platform Console E o Admin operacional da loja), porque is_admin_of(store_id) =
// is_super_admin() OR EXISTS(admins...) -- o OR sozinho ja basta. Nenhum teste anterior desta REF havia
// provado isso: em todos os testes ate' aqui, o caller super admin (ADMIN_FIXTURE) SEMPRE tinha (tambem)
// uma linha real em admins da Encanto no projeto E2E -- nunca foi testado o caso "super admin SEM
// nenhum vinculo administrativo na loja alvo", que e' exatamente o estado em que o Super Admin real vai
// ficar em relacao a Encanto apos a Onda 7.
//
// Usa os 2 fixtures PERMANENTES e deliberadamente sem admin do projeto E2E (scripts/e2e-tenant-fixture-
// stores.mjs, REF-AUTH-TENANT-01 Onda 4): bar-da-sogra-e2e e loja-inativa-e2e (admin_count=0 desde a
// criacao). NENHUM dado novo e criado ou destruido -- so' promocao/revogacao TEMPORARIA de ADMIN_FIXTURE
// em super_admins (mesmo padrao ja usado nos scripts anteriores desta REF).
//
// NAO cria loja, NAO cria usuario, NAO altera producao, NAO toca o Super Admin real nem o admin real da
// Aquarios Bar.
//
// Exit 0 = SUCCESS.
import { readFileSync } from 'node:fs';
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
console.log(' REF-AUTH-PLATFORM-ISOLATION-01 (Onda 4) · prova: Super Admin SEM vinculo administra a loja');
console.log('==========================================================================\n');

let adminFixtureId = null;

try {
  // Confirma a premissa (nao presume): estes 2 fixtures continuam permanentemente sem admin.
  const { data: fixtures } = await admin.from('stores').select('id, slug').in('slug', ['bar-da-sogra-e2e', 'loja-inativa-e2e']);
  const barDaSogra = fixtures?.find((s) => s.slug === 'bar-da-sogra-e2e');
  check('fixture bar-da-sogra-e2e existe', !!barDaSogra, JSON.stringify(fixtures));
  const { count: adminCount } = await admin.from('admins').select('user_id', { count: 'exact', head: true }).eq('store_id', barDaSogra.id);
  check('bar-da-sogra-e2e continua com admin_count=0 (premissa do teste)', adminCount === 0, `admin_count=${adminCount}`);

  adminFixtureId = await idDoAdminFixture();
  const { count: vinculoFixture } = await admin.from('admins').select('user_id', { count: 'exact', head: true }).eq('store_id', barDaSogra.id).eq('user_id', adminFixtureId);
  check('ADMIN_FIXTURE (caller) NAO tem nenhuma linha em admins para esta loja', vinculoFixture === 0, `vinculo=${vinculoFixture}`);

  await admin.from('super_admins').upsert({ user_id: adminFixtureId }, { onConflict: 'user_id' });
  console.log('— ADMIN_FIXTURE promovido a super_admins (temporario, revogado no finally) —\n');

  const superAdminClient = anonClient();
  const { data: loginSuper, error: loginSuperErr } = await superAdminClient.auth.signInWithPassword({ email: ADMIN_FIXTURE.email, password: ADMIN_FIXTURE.senha });
  check('login como ADMIN_FIXTURE (super admin, caller) OK', !loginSuperErr && !!loginSuper?.session, loginSuperErr?.message);

  console.log('\n— PROVA (claim 4): Super Admin SEM vinculo opera o Platform Console desta loja —');
  {
    const { data, error } = await superAdminClient.rpc('platform_tenant_detail', { p_store_id: barDaSogra.id });
    check('platform_tenant_detail funciona sem nenhum vinculo em admins', !error && data?.store?.slug === 'bar-da-sogra-e2e', JSON.stringify({ error: error?.message, data }));
    check('a resposta confirma admins.length=0 para esta loja (nao e um efeito colateral de vinculo oculto)', Array.isArray(data?.admins) && data.admins.length === 0, JSON.stringify(data?.admins));
  }

  console.log('\n— PROVA (claim 4/9): Super Admin SEM vinculo opera o Admin OPERACIONAL desta loja (is_admin_of bypass) —');
  {
    const { data, error } = await superAdminClient.rpc('admin_orders_stats', { p_store_id: barDaSogra.id });
    check('admin_orders_stats (gate is_admin_of) funciona sem vinculo em admins -- so por ser super admin', !error && typeof data?.total_geral === 'number', JSON.stringify({ error: error?.message, data }));
  }
  {
    const { data, error } = await superAdminClient.rpc('admin_orders_search', { p_store_id: barDaSogra.id, p_limit: 5 });
    check('admin_orders_search (gate is_admin_of) funciona sem vinculo em admins', !error && Array.isArray(data), JSON.stringify({ error: error?.message, data: data?.length }));
  }

  console.log('\n— CONTROLE NEGATIVO (claim 9): usuario comum (cliente, nao admin, nao super admin) continua BLOQUEADO nesta mesma loja —');
  {
    const clienteClient = anonClient();
    const { error: loginClienteErr } = await clienteClient.auth.signInWithPassword({ email: CLIENTE_FIXTURE.email, password: CLIENTE_FIXTURE.senha /* fixture-accounts.js usa `senha`, nao `password` */ });
    check('login como CLIENTE_FIXTURE OK', !loginClienteErr, loginClienteErr?.message);
    const { data, error } = await clienteClient.rpc('admin_orders_stats', { p_store_id: barDaSogra.id });
    check('cliente comum -> admin_orders_stats recusado (isolamento continua protegido)', !!error, JSON.stringify({ error: error?.message, data }));
    await clienteClient.auth.signOut();
  }

  await superAdminClient.auth.signOut();
} finally {
  console.log('\n— Limpeza —');
  if (adminFixtureId) {
    await admin.from('super_admins').delete().eq('user_id', adminFixtureId);
    console.log('ADMIN_FIXTURE revogado de super_admins (nenhum outro dado foi criado ou alterado).');
  }
}

console.log('');
console.log(`— Resumo — PASS: ${passes} · FAIL: ${failures}`);
console.log('====================================');
console.log(`STATE: ${failures ? 'FAILED' : 'SUCCESS'} · PASS=${passes} FAIL=${failures}`);
console.log('====================================');
if (failures) process.exitCode = 1;
