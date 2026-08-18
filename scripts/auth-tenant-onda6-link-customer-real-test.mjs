// scripts/auth-tenant-onda6-link-customer-real-test.mjs — REF-AUTH-TENANT-01 · Onda 6.
// Ataque via API DIRETA (nao pelo frontend): logins reais, RPC real (link_customer_to_auth) com JWT
// genuino — nao simulacao SQL. Roda contra o projeto E2E. Restaura os campos mutaveis do customer
// fixture (phone) ao valor original via service_role no final (nao deixa residuo).
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { syncTenant } from '../src/services/tenantSync.js';
import { decodeJwtPayload } from '../src/utils/jwt.js';

function lerEnvE2e() {
  const txt = readFileSync('.env.e2e', 'utf8');
  const out = {};
  for (const linha of txt.split(/\r?\n/)) { const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i); if (m) out[m[1]] = m[2]; }
  return out;
}
const CLIENTE_FIXTURE = { email: 'e2e-cliente@teste.encanto.local', password: 'e2e-fixture-nao-usar-em-prod-9f2b' };
const ENCANTO = 'be2efc10-c0c8-410f-bcd4-af3f8a371df3';
const BAR = '99999999-9999-4999-8999-999999999998';
const CUST_ENCANTO = '969433f9-3bbd-408a-9628-4582c255aa20';
const CUST_BAR = '99999999-9999-4999-8999-999999999997';

const env = lerEnvE2e();
const novoClient = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(env.VITE_SUPABASE_URL, env.E2E_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let passes = 0, failures = 0;
function check(desc, ok, detail) {
  if (ok) { passes++; console.log(`  [PASS] ${desc}`); }
  else { failures++; console.log(`  [FAIL] ${desc} -> ${detail ?? ''}`); }
}

console.log('==================================================================');
console.log(' REF-AUTH-TENANT-01 · Onda 6 — ataque via API REAL contra link_customer_to_auth (E2E)');
console.log('==================================================================\n');

// Guarda o estado original (so campos que a RPC pode mutar) pra restaurar no final — o fixture e
// reusado por outras suites/specs, nao pode sair daqui alterado.
const { data: baseline } = await admin.from('customers').select('id,phone,name,email').in('id', [CUST_ENCANTO, CUST_BAR]);
const originais = Object.fromEntries(baseline.map(c => [c.id, c]));

const dbA = novoClient();
const { data: loginA } = await dbA.auth.signInWithPassword(CLIENTE_FIXTURE);
check('login real OK (sessao A)', !!loginA?.session, '');

// ── Sessao A ativa tenant=Encanto de verdade (activate_tenant + Hook + refreshSession) ──
await syncTenant({ dbCliente: dbA, accessToken: loginA.session.access_token, storeId: ENCANTO, storeStatus: 'ativo' });
{
  const { data: s } = await dbA.auth.getSession();
  check('JWT real da sessao A tem tenant_id=Encanto', decodeJwtPayload(s.session.access_token)?.tenant_id === ENCANTO, '');
}

// RPC real: tenant=Encanto + p_store_id=Encanto (usa o PROPRIO telefone real -> update idempotente, sem mutar)
{
  const { data, error } = await dbA.rpc('link_customer_to_auth', { p_phone: originais[CUST_ENCANTO].phone, p_email: null, p_name: null, p_store_id: ENCANTO });
  check('link_customer_to_auth (RPC real) tenant=Encanto + p_store_id=Encanto -> ALLOW', !error && data?.ok === true && data?.customer_id === CUST_ENCANTO, JSON.stringify({ error: error?.message, data }));
}

// ATAQUE via API direta: mesma sessao (tenant=Encanto), tentando manipular p_store_id=Bar
{
  const { data, error } = await dbA.rpc('link_customer_to_auth', { p_phone: '47900000401', p_email: null, p_name: null, p_store_id: BAR });
  check('ATAQUE API direta: tenant=Encanto + p_store_id=Bar manipulado -> REJEITADO pela RPC (loja invalida)', !error && data?.ok === false && data?.error === 'loja invalida', JSON.stringify({ error: error?.message, data }));
}

// Troca REAL de tenant -> Bar (mesma sessao A)
await syncTenant({ dbCliente: dbA, accessToken: (await dbA.auth.getSession()).data.session.access_token, storeId: BAR, storeStatus: 'ativo' });
{
  const { data: s } = await dbA.auth.getSession();
  check('JWT real da sessao A trocou pra tenant_id=Bar', decodeJwtPayload(s.session.access_token)?.tenant_id === BAR, '');
}
{
  const { data, error } = await dbA.rpc('link_customer_to_auth', { p_phone: '47900000402', p_email: null, p_name: null, p_store_id: ENCANTO });
  check('ATAQUE API direta: tenant=Bar + p_store_id=Encanto manipulado -> REJEITADO pela RPC (loja invalida)', !error && data?.ok === false && data?.error === 'loja invalida', JSON.stringify({ error: error?.message, data }));
}
{
  const { data, error } = await dbA.rpc('link_customer_to_auth', { p_phone: '47900000403', p_email: null, p_name: null, p_store_id: BAR });
  check('link_customer_to_auth (RPC real) tenant=Bar + p_store_id=Bar -> ALLOW', !error && data?.ok === true && data?.customer_id === CUST_BAR, JSON.stringify({ error: error?.message, data }));
}

// ── DUAS SESSOES REAIS E SIMULTANEAS (aba A = Bar, aba B = Encanto) ──
const dbB = novoClient();
const { data: loginB } = await dbB.auth.signInWithPassword(CLIENTE_FIXTURE);
await syncTenant({ dbCliente: dbB, accessToken: loginB.session.access_token, storeId: ENCANTO, storeStatus: 'ativo' });
{
  const { data: s } = await dbB.auth.getSession();
  check('JWT real da sessao B (DIFERENTE, mesma pessoa) tem tenant_id=Encanto', decodeJwtPayload(s.session.access_token)?.tenant_id === ENCANTO, '');
}
{
  const [rA, rB] = await Promise.all([
    dbA.rpc('link_customer_to_auth', { p_phone: '47900000404', p_email: null, p_name: null, p_store_id: BAR }),      // sessao A esta em Bar
    dbB.rpc('link_customer_to_auth', { p_phone: '47900000405', p_email: null, p_name: null, p_store_id: ENCANTO }),  // sessao B esta em Encanto
  ]);
  check('sessao A (tenant Bar) opera no proprio tenant simultaneamente -> ALLOW', !rA.error && rA.data?.ok === true && rA.data?.customer_id === CUST_BAR, JSON.stringify(rA));
  check('sessao B (tenant Encanto, sessao DIFERENTE, mesma pessoa) opera no proprio tenant simultaneamente -> ALLOW', !rB.error && rB.data?.ok === true && rB.data?.customer_id === CUST_ENCANTO, JSON.stringify(rB));
  const [rACross, rBCross] = await Promise.all([
    dbA.rpc('link_customer_to_auth', { p_phone: '47900000406', p_email: null, p_name: null, p_store_id: ENCANTO }), // A (Bar) tentando Encanto
    dbB.rpc('link_customer_to_auth', { p_phone: '47900000407', p_email: null, p_name: null, p_store_id: BAR }),     // B (Encanto) tentando Bar
  ]);
  check('sessao A (tenant Bar) NAO consegue operar em Encanto mesmo em paralelo -> DENY', !rACross.error && rACross.data?.ok === false && rACross.data?.error === 'loja invalida', JSON.stringify(rACross));
  check('sessao B (tenant Encanto) NAO consegue operar em Bar mesmo em paralelo -> DENY', !rBCross.error && rBCross.data?.ok === false && rBCross.data?.error === 'loja invalida', JSON.stringify(rBCross));
}

// Guest/anon real via REST — sem sessao nenhuma
{
  const anonClient = novoClient();
  const { data, error } = await anonClient.rpc('link_customer_to_auth', { p_phone: '47900000408', p_email: null, p_name: null });
  check('anon real (sem login) chamando a RPC -> recebe erro (EXECUTE revogado)', !!error, JSON.stringify({ error: error?.message, data }));
}

await dbA.auth.signOut();
await dbB.auth.signOut();

// restauracao (service_role, fora da RLS) — devolve phone ao valor original capturado no inicio
{
  const restauracoes = await Promise.all(Object.values(originais).map(c =>
    admin.from('customers').update({ phone: c.phone }).eq('id', c.id)
  ));
  const erro = restauracoes.find(r => r.error);
  console.log(`\nRestauracao: phone original devolvido para ${Object.keys(originais).length} customer(s) fixture${erro ? ' (erro: ' + erro.error.message + ')' : ''}.`);
}

console.log('');
console.log(`— Resumo — PASS: ${passes} · FAIL: ${failures}`);
console.log('====================================');
console.log(`STATE: ${failures ? 'FAILED' : 'SUCCESS'} · PASS=${passes} FAIL=${failures}`);
console.log('====================================');
if (failures) process.exitCode = 1;
