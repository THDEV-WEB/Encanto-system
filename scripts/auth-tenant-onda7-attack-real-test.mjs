// scripts/auth-tenant-onda7-attack-real-test.mjs — REF-AUTH-TENANT-01 · Onda 7 (gate final de ataque).
// Ataques que exigem REDE/sessao real de verdade (nao dá pra simular só com claims em BEGIN/ROLLBACK):
// logout + reuso de access_token antigo via REST direto, loja inativa via activate_tenant() com sessao
// genuína, duas sessões reais fazendo ataques cruzados ENTRELAÇADOS (addresses + link_customer_to_auth
// na mesma leva, via Promise.all), refresh simultâneo confirmando session_id/tenant_id independentes.
// Roda contra o projeto E2E. Restaura o phone dos customers fixture no final (mesmo padrão da Onda 6).
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
const LOJA_INATIVA = '99999999-9999-4999-8999-999999999996';
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
console.log(' REF-AUTH-TENANT-01 · Onda 7 — ataque via API REAL (gate final) — E2E');
console.log('==================================================================\n');

const { data: baseline } = await admin.from('customers').select('id,phone').in('id', [CUST_ENCANTO, CUST_BAR]);
const originais = Object.fromEntries(baseline.map(c => [c.id, c]));

console.log('— ATAQUE 8 (duas abas, ataques entrelaçados addresses + link_customer_to_auth) —');
const dbA = novoClient();
const dbB = novoClient();
const { data: loginA } = await dbA.auth.signInWithPassword(CLIENTE_FIXTURE);
const { data: loginB } = await dbB.auth.signInWithPassword(CLIENTE_FIXTURE);
check('login real OK (sessao A e sessao B, mesma pessoa)', !!loginA?.session && !!loginB?.session, '');
check('session_id A != session_id B (duas sessoes de verdade, nao a mesma)', loginA.session.access_token !== loginB.session.access_token, '');

await syncTenant({ dbCliente: dbA, accessToken: loginA.session.access_token, storeId: ENCANTO, storeStatus: 'ativo' });
await syncTenant({ dbCliente: dbB, accessToken: loginB.session.access_token, storeId: BAR, storeStatus: 'ativo' });
{
  const [sA, sB] = await Promise.all([dbA.auth.getSession(), dbB.auth.getSession()]);
  check('JWT real A tem tenant_id=Encanto', decodeJwtPayload(sA.data.session.access_token)?.tenant_id === ENCANTO, '');
  check('JWT real B tem tenant_id=Bar', decodeJwtPayload(sB.data.session.access_token)?.tenant_id === BAR, '');
}

// endereco real de cada lado, pra ataque cruzado de addresses
const { data: addrA } = await dbA.rpc('save_structured_address', { p_address: { customer_id: CUST_ENCANTO, rua: 'Onda7 A' } });
const { data: addrB } = await dbB.rpc('save_structured_address', { p_address: { customer_id: CUST_BAR, rua: 'Onda7 B' } });

// rodada ENTRELAÇADA: A e B atacando um ao outro SIMULTANEAMENTE, nas duas superficies ao mesmo tempo
{
  const [linkA, linkB, addrSelA, addrSelB, addrDelA, addrDelB] = await Promise.all([
    dbA.rpc('link_customer_to_auth', { p_phone: '47900001001', p_email: null, p_name: null, p_store_id: BAR }),      // A (Encanto) tenta Bar
    dbB.rpc('link_customer_to_auth', { p_phone: '47900001002', p_email: null, p_name: null, p_store_id: ENCANTO }),  // B (Bar) tenta Encanto
    dbA.from('addresses').select('id').eq('id', addrB),  // A tenta ver endereco de B
    dbB.from('addresses').select('id').eq('id', addrA),  // B tenta ver endereco de A
    dbA.from('addresses').delete().eq('id', addrB).select(), // A tenta apagar endereco de B
    dbB.from('addresses').delete().eq('id', addrA).select(), // B tenta apagar endereco de A
  ]);
  check('ATAQUE ENTRELAÇADO: A (tenant Encanto) link_customer_to_auth p_store_id=Bar -> DENY mesmo sob concorrencia', linkA.data?.ok === false && linkA.data?.error === 'loja invalida', JSON.stringify(linkA.data));
  check('ATAQUE ENTRELAÇADO: B (tenant Bar) link_customer_to_auth p_store_id=Encanto -> DENY mesmo sob concorrencia', linkB.data?.ok === false && linkB.data?.error === 'loja invalida', JSON.stringify(linkB.data));
  check('ATAQUE ENTRELAÇADO: A nao ve endereco de B mesmo sob concorrencia', !addrSelA.error && addrSelA.data?.length === 0, JSON.stringify(addrSelA));
  check('ATAQUE ENTRELAÇADO: B nao ve endereco de A mesmo sob concorrencia', !addrSelB.error && addrSelB.data?.length === 0, JSON.stringify(addrSelB));
  check('ATAQUE ENTRELAÇADO: A nao apaga endereco de B mesmo sob concorrencia', !addrDelA.error && (addrDelA.data?.length ?? 0) === 0, JSON.stringify(addrDelA));
  check('ATAQUE ENTRELAÇADO: B nao apaga endereco de A mesmo sob concorrencia', !addrDelB.error && (addrDelB.data?.length ?? 0) === 0, JSON.stringify(addrDelB));
}

console.log('\n— ATAQUE 8b (refresh simultâneo) —');
{
  const [rA, rB] = await Promise.all([dbA.auth.refreshSession(), dbB.auth.refreshSession()]);
  check('refresh simultaneo de A e B nao lanca erro em nenhum dos dois', !rA.error && !rB.error, JSON.stringify({ eA: rA.error?.message, eB: rB.error?.message }));
  const tA = decodeJwtPayload(rA.data.session.access_token);
  const tB = decodeJwtPayload(rB.data.session.access_token);
  check('pos-refresh simultaneo: session_id A != session_id B', tA.session_id !== tB.session_id, JSON.stringify({ a: tA.session_id, b: tB.session_id }));
  check('pos-refresh simultaneo: tenant A continua Encanto (nenhuma contaminacao cruzada)', tA.tenant_id === ENCANTO, tA.tenant_id);
  check('pos-refresh simultaneo: tenant B continua Bar (nenhuma contaminacao cruzada)', tB.tenant_id === BAR, tB.tenant_id);
}

console.log('\n— ATAQUE 9 (logout + reuso de access_token antigo via REST direto) —');
{
  const tokenAntigoA = (await dbA.auth.getSession()).data.session.access_token;
  await dbA.auth.signOut();
  // reuso MANUAL do token antigo, direto via fetch -- NUNCA pelo supabase-js (que usaria o storage,
  // ja limpo). Confirma revogacao real no servidor, nao so limpeza de localStorage no client.
  const restResp = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/addresses?id=eq.${addrA}&select=id`, {
    headers: { apikey: env.VITE_SUPABASE_KEY, Authorization: `Bearer ${tokenAntigoA}` },
  });
  const restBody = await restResp.json().catch(() => null);
  check('access_token antigo (pos-signOut) via REST direto -> REJEITADO pelo servidor (nao 200 com dado)', restResp.status !== 200 || (Array.isArray(restBody) && restBody.length === 0), `status=${restResp.status} body=${JSON.stringify(restBody)}`);

  const rpcResp = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/link_customer_to_auth`, {
    method: 'POST',
    headers: { apikey: env.VITE_SUPABASE_KEY, Authorization: `Bearer ${tokenAntigoA}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_phone: '47900001003', p_email: null, p_name: null, p_store_id: ENCANTO }),
  });
  const rpcBody = await rpcResp.json().catch(() => null);
  const rpcNegado = rpcResp.status !== 200 || rpcBody?.ok === false;
  check('access_token antigo (pos-signOut) chamando RPC direto -> REJEITADO (nem "nao autenticado" deveria suceder como se fosse sessao valida sendo reconhecida)', rpcNegado, `status=${rpcResp.status} body=${JSON.stringify(rpcBody)}`);
}

console.log('\n— ATAQUE 10 (loja inativa, cadeia completa com sessao real) —');
{
  const { data: loginC } = await dbB.auth.signInWithPassword(CLIENTE_FIXTURE); // dbB ja deslogado? nao -- login de novo pra sessao limpa
  const { data: activInativa, error: errInativa } = await dbB.rpc('activate_tenant', { p_store_id: LOJA_INATIVA });
  // activate_tenant nega via RAISE EXCEPTION (nao via {ok:false} jsonb) -- mensagem generica "tenant
  // indisponivel", mesma pra loja inexistente/inativa/sem vinculo (anti-enumeracao, ja provado na Onda 2).
  check('activate_tenant(Loja Inativa) com sessao real -> nega (excecao "tenant indisponivel")', !!errInativa && /tenant indisponivel/i.test(errInativa.message) && !activInativa, JSON.stringify({ errInativa: errInativa?.message, activInativa }));
  await dbB.auth.refreshSession();
  const { data: sFinal } = await dbB.auth.getSession();
  check('pos-refresh, JWT real NUNCA ganhou tenant_id da loja inativa', decodeJwtPayload(sFinal.session.access_token)?.tenant_id !== LOJA_INATIVA, decodeJwtPayload(sFinal.session.access_token)?.tenant_id);
  await dbB.auth.signOut();
}

console.log('\n— ATAQUE 6/7 (sessao sem tenant + payload/dominio forjado, via API real) —');
{
  const dbC = novoClient();
  const { data: loginD } = await dbC.auth.signInWithPassword(CLIENTE_FIXTURE);
  // NUNCA chama syncTenant -- sessao real, mas SEM tenant_id (equivalente ao Hook desligado em producao hoje)
  check('sessao real recem-logada, sem ativar tenant, NAO tem tenant_id no JWT', !decodeJwtPayload(loginD.session.access_token)?.tenant_id, '');
  // payload "forjando" a loja (equivalente a dominio manipulado): p_store_id=Bar sem NUNCA ter tido tenant
  const { data: r1 } = await dbC.rpc('link_customer_to_auth', { p_phone: '47900001004', p_email: null, p_name: null, p_store_id: BAR });
  check('sem tenant, p_store_id=Bar (payload/dominio "forjado") -> cai no comportamento LEGADO documentado (nao e bypass -- e a excecao ja aprovada na Onda 6), continua sendo o proprio auth.uid() operando, nunca outra pessoa', r1?.ok === true, JSON.stringify(r1));
  // addresses continua fail-closed mesmo sem tenant (Onda5) -- domino/payload nao ajudam em nada aqui
  const { data: r2, error: e2 } = await dbC.from('addresses').select('id').limit(1);
  check('sem tenant, SELECT addresses -> 0 linhas (fail-closed da Onda5, payload/dominio irrelevantes)', !e2 && r2?.length === 0, JSON.stringify({ e2: e2?.message, r2 }));
  await dbC.auth.signOut();
}

console.log('\n— ATAQUE 15 (revalidação FIX-GET-MEUCUSTOMER sob resposta fora de ordem) —');
{
  const dbE = novoClient();
  const { data: loginE } = await dbE.auth.signInWithPassword(CLIENTE_FIXTURE);
  const [custEncanto, custBar] = await Promise.all([
    dbE.from('customers').select('id,name').eq('auth_user_id', loginE.user.id).eq('store_id', ENCANTO).limit(1).maybeSingle(),
    dbE.from('customers').select('id,name').eq('auth_user_id', loginE.user.id).eq('store_id', BAR).limit(1).maybeSingle(),
  ]);
  check('query real filtrada por store_id=Encanto devolve SO o customer de Encanto', custEncanto.data?.id === CUST_ENCANTO, JSON.stringify(custEncanto));
  check('query real filtrada por store_id=Bar devolve SO o customer da Bar', custBar.data?.id === CUST_BAR, JSON.stringify(custBar));
  await dbE.auth.signOut();
}

await dbA.auth.signOut().catch(() => {}); // dbA ja foi deslogado no ataque 9; no-op seguro
await dbB.auth.signOut().catch(() => {});

// limpeza: enderecos de teste + phone original dos customers fixture
{
  const { error } = await admin.from('addresses').delete().in('id', [addrA, addrB].filter(Boolean));
  const restauracoes = await Promise.all(Object.values(originais).map(c => admin.from('customers').update({ phone: c.phone }).eq('id', c.id)));
  const erro = error || restauracoes.find(r => r.error)?.error;
  console.log(`\nLimpeza: enderecos de teste removidos + phone original restaurado${erro ? ' (erro: ' + erro.message + ')' : ''}.`);
}

console.log('');
console.log(`— Resumo — PASS: ${passes} · FAIL: ${failures}`);
console.log('====================================');
console.log(`STATE: ${failures ? 'FAILED' : 'SUCCESS'} · PASS=${passes} FAIL=${failures}`);
console.log('====================================');
if (failures) process.exitCode = 1;
