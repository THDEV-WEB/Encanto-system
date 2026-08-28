// scripts/store-onboard-02-onda1-checklist-test.mjs — REF-STORE-ONBOARD-02 · Onda 1.
// Prova, via chamada de rede real a platform_tenant_detail, que os 4 indicadores novos do checklist de
// lancamento (tem_catalogo/tem_coordenadas/tem_eta_customizado/tem_modo_customizado) refletem o estado
// real da loja -- tanto para uma loja recem-criada (tudo pendente) quanto para uma loja totalmente
// configurada (tudo ok). 100% dados descartaveis, 100% projeto E2E (.env.e2e).
import { readFileSync } from 'node:fs';
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
console.log(' REF-STORE-ONBOARD-02 (Onda 1) · checklist de lancamento -- platform_tenant_detail (E2E)');
console.log('==========================================================================\n');

const TS = Date.now();
const SLUG = `onda1-checklist-${TS}`;
let adminFixtureId = null;
let storeId = null;
let productId = null;

try {
  adminFixtureId = await idDoAdminFixture();
  await admin.from('super_admins').upsert({ user_id: adminFixtureId }, { onConflict: 'user_id' });

  const superAdminClient = anonClient();
  const { data: loginData, error: loginErr } = await superAdminClient.auth.signInWithPassword({ email: ADMIN_FIXTURE.email, password: ADMIN_FIXTURE.senha });
  check('login como ADMIN_FIXTURE (super admin, caller)', !loginErr && !!loginData?.session, loginErr?.message);

  console.log('\n--- Caso A: loja recem-criada (provision_store) -- tudo deve estar PENDENTE ---');
  const { data: prov, error: provErr } = await superAdminClient.rpc('provision_store', { p_nome: 'Onda1 Checklist Teste', p_slug: SLUG });
  check('provision_store criou a loja', !provErr && !!prov?.store_id, provErr?.message);
  storeId = prov?.store_id;

  const { data: detalheA, error: detalheAErr } = await superAdminClient.rpc('platform_tenant_detail', { p_store_id: storeId });
  check('platform_tenant_detail respondeu (loja nova)', !detalheAErr && !!detalheA, detalheAErr?.message);
  check('A: tem_catalogo = false', detalheA?.config?.tem_catalogo === false, JSON.stringify(detalheA?.config));
  check('A: tem_coordenadas = false', detalheA?.config?.tem_coordenadas === false, JSON.stringify(detalheA?.config));
  check('A: tem_eta_customizado = false', detalheA?.config?.tem_eta_customizado === false, JSON.stringify(detalheA?.config));
  check('A: tem_modo_customizado = false', detalheA?.config?.tem_modo_customizado === false, JSON.stringify(detalheA?.config));
  check('A: tem_horario_config = false (regressao -- campo pre-existente)', detalheA?.config?.tem_horario_config === false);
  check('A: tem_delivery_config = false (regressao -- campo pre-existente)', detalheA?.config?.tem_delivery_config === false);
  check('A: delivery_eta_min = "45" (regressao -- fallback pre-existente)', detalheA?.config?.delivery_eta_min === '45');

  console.log('\n--- Caso B: mesma loja, agora totalmente configurada -- tudo deve estar OK ---');
  const { data: novoProduto, error: prodErr } = await admin.from('products').insert({
    store_id: storeId, nome: 'Produto Teste Onda1', preco: 10, disponivel: false,
  }).select('id').single();
  check('produto descartavel criado (simula catalogo nao-vazio)', !prodErr, prodErr?.message);
  productId = novoProduto?.id;

  // upsert (nao insert) -- provision_store ja semeia uma linha 'company_info' pra esta loja; as demais
  // chaves nao existem ainda, mas upsert cobre os dois casos sem precisar diferenciar.
  const { error: settingsErr } = await admin.from('store_settings').upsert([
    { store_id: storeId, chave: 'business_hours_schedule', valor: '{}' },
    { store_id: storeId, chave: 'delivery_fee_config', valor: '{}' },
    { store_id: storeId, chave: 'delivery_eta_min', valor: '30' },
    { store_id: storeId, chave: 'store_mode', valor: 'OPEN' },
    { store_id: storeId, chave: 'company_info', valor: JSON.stringify({ lojaLat: -26.9, lojaLng: -48.6 }) },
  ], { onConflict: 'store_id,chave' });
  check('store_settings de teste inseridos/atualizados', !settingsErr, settingsErr?.message);

  const { data: detalheB, error: detalheBErr } = await superAdminClient.rpc('platform_tenant_detail', { p_store_id: storeId });
  check('platform_tenant_detail respondeu (loja configurada)', !detalheBErr && !!detalheB, detalheBErr?.message);
  check('B: tem_catalogo = true', detalheB?.config?.tem_catalogo === true, JSON.stringify(detalheB?.config));
  check('B: tem_coordenadas = true', detalheB?.config?.tem_coordenadas === true, JSON.stringify(detalheB?.config));
  check('B: tem_eta_customizado = true', detalheB?.config?.tem_eta_customizado === true, JSON.stringify(detalheB?.config));
  check('B: tem_modo_customizado = true', detalheB?.config?.tem_modo_customizado === true, JSON.stringify(detalheB?.config));
  check('B: tem_horario_config = true (regressao)', detalheB?.config?.tem_horario_config === true);
  check('B: tem_delivery_config = true (regressao)', detalheB?.config?.tem_delivery_config === true);
  check('B: delivery_eta_min = "30" (regressao -- agora customizado)', detalheB?.config?.delivery_eta_min === '30');
  check('B: company_info.lojaLat/lojaLng presentes no retorno', detalheB?.company_info?.lojaLat === -26.9 && detalheB?.company_info?.lojaLng === -48.6);

  console.log('\n--- REGRESSAO: caller que nao e super admin continua recusado ---');
  const naoSuperClient = anonClient();
  const { error: rpcErr } = await naoSuperClient.rpc('platform_tenant_detail', { p_store_id: storeId });
  check('sem sessao -> recusado', !!rpcErr, rpcErr?.message);

  await superAdminClient.auth.signOut();

  console.log('\n===== CONCLUSAO =====');
  console.log(failures === 0
    ? 'CHECKLIST VALIDADO: os 4 indicadores novos refletem corretamente o estado real da loja, sem regressao nos campos pre-existentes.'
    : 'ATENCAO: ver [FAIL] acima.');
} finally {
  console.log('\n--- Limpeza ---');
  if (productId) await admin.from('products').delete().eq('id', productId);
  if (storeId) {
    await admin.from('store_settings').delete().eq('store_id', storeId);
    await admin.from('admins').delete().eq('store_id', storeId);
    await admin.from('stores').delete().eq('id', storeId);
    console.log('Loja descartavel e settings removidos.');
  }
  if (adminFixtureId) {
    await admin.from('super_admins').delete().eq('user_id', adminFixtureId);
    console.log('ADMIN_FIXTURE revogado de super_admins.');
  }
}

console.log('');
console.log(`— Resumo — PASS: ${passes} · FAIL: ${failures}`);
if (failures) process.exitCode = 1;
