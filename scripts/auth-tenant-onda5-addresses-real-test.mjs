// scripts/auth-tenant-onda5-addresses-real-test.mjs — REF-AUTH-TENANT-01 · Onda 5.
// Ataque via API DIRETA (nao pelo frontend): logins reais, RPC real (save_structured_address), leitura/
// escrita direta via REST (.from('addresses')...) com JWT genuino — nao simulacao SQL. Roda contra o
// projeto E2E. Limpa os proprios dados no final via service_role (nao deixa residuo).
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
const idsCriados = [];

console.log('==================================================================');
console.log(' REF-AUTH-TENANT-01 · Onda 5 — ataque via API REAL contra addresses (E2E)');
console.log('==================================================================\n');

const dbA = novoClient();
const { data: loginA } = await dbA.auth.signInWithPassword(CLIENTE_FIXTURE);
check('login real OK', !!loginA?.session, '');

await syncTenant({ dbCliente: dbA, accessToken: loginA.session.access_token, storeId: ENCANTO, storeStatus: 'ativo' });
{
  const { data: s } = await dbA.auth.getSession();
  check('JWT real agora tem tenant_id=Encanto', decodeJwtPayload(s.session.access_token)?.tenant_id === ENCANTO, '');
}

// RPC real: cria endereco vinculado ao customer Encanto
const { data: addrEncantoId, error: errRpc } = await dbA.rpc('save_structured_address', { p_address: { customer_id: CUST_ENCANTO, rua: 'Rua Teste Onda5 API', numero: '1' } });
check('save_structured_address (RPC real) criou endereco vinculado', !errRpc && !!addrEncantoId, errRpc?.message);
if (addrEncantoId) idsCriados.push(addrEncantoId);

// Leitura direta via REST (mesmo tenant) -> deve ver
{
  const { data, error } = await dbA.from('addresses').select('id,customer_id,store_id').eq('id', addrEncantoId);
  check('SELECT direto via REST (mesmo tenant) ve o proprio endereco', !error && data?.length === 1, JSON.stringify({ error: error?.message, data }));
}

// Troca real de tenant -> Bar
await syncTenant({ dbCliente: dbA, accessToken: (await dbA.auth.getSession()).data.session.access_token, storeId: BAR, storeStatus: 'ativo' });
{
  const { data: s } = await dbA.auth.getSession();
  check('JWT real trocou pra tenant_id=Bar', decodeJwtPayload(s.session.access_token)?.tenant_id === BAR, '');
}

// SELECT direto via REST no MESMO id, agora com tenant errado -> DENY (0 linhas, nao erro)
{
  const { data, error } = await dbA.from('addresses').select('id').eq('id', addrEncantoId);
  check('SELECT direto via REST (tenant trocado p/ Bar) NAO ve mais o endereco da Encanto', !error && data?.length === 0, JSON.stringify({ error: error?.message, data }));
}
// UPDATE direto via REST cross-tenant -> DENY
{
  const { data, error } = await dbA.from('addresses').update({ numero: 'HACK-API' }).eq('id', addrEncantoId).select();
  check('UPDATE direto via REST cross-tenant nao afeta nenhuma linha', !error && (data?.length ?? 0) === 0, JSON.stringify({ error: error?.message, data }));
}
// DELETE direto via REST cross-tenant -> DENY
{
  const { data, error } = await dbA.from('addresses').delete().eq('id', addrEncantoId).select();
  check('DELETE direto via REST cross-tenant nao afeta nenhuma linha', !error && (data?.length ?? 0) === 0, JSON.stringify({ error: error?.message, data }));
}
// INSERT direto via REST tentando escrever pra Encanto enquanto tenant=Bar, com customer_id da Bar mas store_id da Encanto (manipulado)
{
  const { data, error } = await dbA.from('addresses').insert({ customer_id: CUST_BAR, store_id: ENCANTO, rua: 'ataque REST' }).select();
  check('INSERT direto via REST com store_id manipulado (!=tenant atual) é REJEITADO pela RLS', !!error, JSON.stringify({ error: error?.message, data }));
}

// Endereco real da Bar, pra provar ISOLAMENTO NAS DUAS DIREÇÕES
const { data: addrBarId } = await dbA.rpc('save_structured_address', { p_address: { customer_id: CUST_BAR, rua: 'Rua Bar Onda5 API', numero: '2' } });
if (addrBarId) idsCriados.push(addrBarId);
{
  const { data, error } = await dbA.from('addresses').select('id').eq('id', addrBarId);
  check('SELECT direto via REST (tenant=Bar) ve o proprio endereco da Bar', !error && data?.length === 1, JSON.stringify({ error: error?.message, data }));
}

// ── DUAS SESSOES REAIS E SIMULTANEAS (aba A = Encanto, aba B = Bar) via REST direto ──
const dbB = novoClient();
const { data: loginB } = await dbB.auth.signInWithPassword(CLIENTE_FIXTURE);
await syncTenant({ dbCliente: dbB, accessToken: loginB.session.access_token, storeId: ENCANTO, storeStatus: 'ativo' });
{
  const [rA, rB] = await Promise.all([
    dbA.from('addresses').select('id').eq('id', addrBarId), // dbA agora esta em Bar
    dbB.from('addresses').select('id').eq('id', addrEncantoId), // dbB agora esta em Encanto (mesma pessoa, sessao DIFERENTE)
  ]);
  check('aba A (tenant Bar) ve o endereco da Bar', !rA.error && rA.data?.length === 1, JSON.stringify(rA));
  check('aba B (tenant Encanto, sessao DIFERENTE, mesma pessoa) ve o endereco da Encanto', !rB.error && rB.data?.length === 1, JSON.stringify(rB));
  const [rACross, rBCross] = await Promise.all([
    dbA.from('addresses').select('id').eq('id', addrEncantoId), // dbA (Bar) tentando ver o da Encanto
    dbB.from('addresses').select('id').eq('id', addrBarId),     // dbB (Encanto) tentando ver o da Bar
  ]);
  check('aba A (tenant Bar) NAO ve o endereco da Encanto', !rACross.error && rACross.data?.length === 0, JSON.stringify(rACross));
  check('aba B (tenant Encanto) NAO ve o endereco da Bar', !rBCross.error && rBCross.data?.length === 0, JSON.stringify(rBCross));
}

// Guest/anon real via REST
{
  const anonClient = novoClient();
  const { data, error } = await anonClient.from('addresses').select('id').limit(1);
  check('anon real via REST recebe erro de permissao (sem grant)', !!error, JSON.stringify({ error: error?.message, data }));
}

await dbA.auth.signOut();
await dbB.auth.signOut();

// limpeza (service_role, fora da RLS)
if (idsCriados.length) {
  const { error } = await admin.from('addresses').delete().in('id', idsCriados);
  console.log(`\nLimpeza: ${idsCriados.length} endereco(s) de teste removido(s)${error ? ' (erro: ' + error.message + ')' : ''}.`);
}

console.log('');
console.log(`— Resumo — PASS: ${passes} · FAIL: ${failures}`);
console.log('====================================');
console.log(`STATE: ${failures ? 'FAILED' : 'SUCCESS'} · PASS=${passes} FAIL=${failures}`);
console.log('====================================');
if (failures) process.exitCode = 1;
