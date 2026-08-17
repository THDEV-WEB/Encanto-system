/* tests/tenantSync.golden.mjs — REF-AUTH-TENANT-01 · Onda 4 · roda com: node tests/tenantSync.golden.mjs
   Testa a logica PURA de src/services/tenantSync.js (dbCliente mockado, zero rede) — mesmo modulo
   usado pelo hook real do AuthProvider e pelo script de validacao contra o E2E, entao o que este teste
   prova e exatamente o que roda em producao.
   Cobre: convidado (sem token) nunca chama nada; loja nao resolvida/inativa nunca chama nada; claim
   ja correto nao chama nada (base da convergencia sem loop); precisa ativar -> chama RPC + refresh
   nesta ordem; RPC falha -> refresh NUNCA e chamado (nao ha nada novo pra buscar); refresh falha ->
   erro propagado sem lancar excecao. */
import assert from 'node:assert/strict';
import { precisaAtivarTenant, syncTenant } from '../src/services/tenantSync.js';

let fail = 0;
const check = (m, fn) => { try { fn(); } catch (e) { fail++; console.error('✗', m, '—', e?.message ?? e); } };
const checkAsync = async (m, fn) => { try { await fn(); } catch (e) { fail++; console.error('✗', m, '—', e?.message ?? e); } };

const ENCANTO = '8604324d-0529-443d-aa79-4337057bfa01';
const BAR = '776a01c8-f836-417a-a957-a0e1109f90a2';

function makeToken(claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.assinatura-fake`;
}

const TOKEN_SEM_TENANT = makeToken({ sub: 'user-1', session_id: 'sess-1' });
const TOKEN_TENANT_ENCANTO = makeToken({ sub: 'user-1', session_id: 'sess-1', tenant_id: ENCANTO });
const TOKEN_TENANT_BAR = makeToken({ sub: 'user-1', session_id: 'sess-1', tenant_id: BAR });

/* ── precisaAtivarTenant (decisao pura) ──────────────────────────────────────────────────────── */
check('sem accessToken -> false (convidado)', () => {
  assert.strictEqual(precisaAtivarTenant({ accessToken: null, storeId: ENCANTO, storeStatus: 'ativo' }), false);
});
check('sem storeId (loja ainda nao resolvida) -> false', () => {
  assert.strictEqual(precisaAtivarTenant({ accessToken: TOKEN_SEM_TENANT, storeId: null, storeStatus: undefined }), false);
});
check('storeStatus != ativo -> false (nao tenta ativar loja suspensa/cancelada)', () => {
  assert.strictEqual(precisaAtivarTenant({ accessToken: TOKEN_SEM_TENANT, storeId: ENCANTO, storeStatus: 'suspenso' }), false);
});
check('token sem tenant_id + loja ativa -> true (precisa ativar)', () => {
  assert.strictEqual(precisaAtivarTenant({ accessToken: TOKEN_SEM_TENANT, storeId: ENCANTO, storeStatus: 'ativo' }), true);
});
check('token com tenant_id JA correto -> false (base da convergencia sem loop)', () => {
  assert.strictEqual(precisaAtivarTenant({ accessToken: TOKEN_TENANT_ENCANTO, storeId: ENCANTO, storeStatus: 'ativo' }), false);
});
check('token com tenant_id de OUTRA loja -> true (precisa trocar)', () => {
  assert.strictEqual(precisaAtivarTenant({ accessToken: TOKEN_TENANT_ENCANTO, storeId: BAR, storeStatus: 'ativo' }), true);
});
check('token malformado -> true (nao trava silenciosamente pra sempre)', () => {
  assert.strictEqual(precisaAtivarTenant({ accessToken: 'lixo.nao-jwt', storeId: ENCANTO, storeStatus: 'ativo' }), true);
});

/* ── syncTenant (efeito, dbCliente mockado) ──────────────────────────────────────────────────── */
function mockDb({ rpcError = null, refreshError = null } = {}) {
  const chamadas = { rpc: [], refresh: 0 };
  return {
    chamadas,
    rpc: async (nome, params) => { chamadas.rpc.push({ nome, params }); return { data: null, error: rpcError }; },
    auth: { refreshSession: async () => { chamadas.refresh++; return { data: null, error: refreshError }; } },
  };
}

await checkAsync('convidado (sem accessToken) -> zero chamadas', async () => {
  const db = mockDb();
  const r = await syncTenant({ dbCliente: db, accessToken: null, storeId: ENCANTO, storeStatus: 'ativo' });
  assert.strictEqual(r.ativado, false);
  assert.strictEqual(db.chamadas.rpc.length, 0);
  assert.strictEqual(db.chamadas.refresh, 0);
});

await checkAsync('claim ja correto -> zero chamadas (nao re-ativa a toa)', async () => {
  const db = mockDb();
  const r = await syncTenant({ dbCliente: db, accessToken: TOKEN_TENANT_ENCANTO, storeId: ENCANTO, storeStatus: 'ativo' });
  assert.strictEqual(r.ativado, false);
  assert.strictEqual(db.chamadas.rpc.length, 0);
  assert.strictEqual(db.chamadas.refresh, 0);
});

await checkAsync('precisa ativar -> chama activate_tenant com p_store_id certo, depois refreshSession', async () => {
  const db = mockDb();
  const r = await syncTenant({ dbCliente: db, accessToken: TOKEN_SEM_TENANT, storeId: ENCANTO, storeStatus: 'ativo' });
  assert.strictEqual(r.ativado, true);
  assert.strictEqual(db.chamadas.rpc.length, 1);
  assert.strictEqual(db.chamadas.rpc[0].nome, 'activate_tenant');
  assert.deepStrictEqual(db.chamadas.rpc[0].params, { p_store_id: ENCANTO });
  assert.strictEqual(db.chamadas.refresh, 1);
});

await checkAsync('troca de loja (token com tenant de OUTRA loja) -> reativa pra loja certa', async () => {
  const db = mockDb();
  const r = await syncTenant({ dbCliente: db, accessToken: TOKEN_TENANT_ENCANTO, storeId: BAR, storeStatus: 'ativo' });
  assert.strictEqual(r.ativado, true);
  assert.deepStrictEqual(db.chamadas.rpc[0].params, { p_store_id: BAR });
});

await checkAsync('activate_tenant falha (sem vinculo) -> refreshSession NUNCA e chamado', async () => {
  const db = mockDb({ rpcError: { message: 'tenant indisponivel' } });
  const r = await syncTenant({ dbCliente: db, accessToken: TOKEN_SEM_TENANT, storeId: ENCANTO, storeStatus: 'ativo' });
  assert.strictEqual(r.ativado, false);
  assert.ok(r.error);
  assert.strictEqual(db.chamadas.rpc.length, 1);
  assert.strictEqual(db.chamadas.refresh, 0);
});

await checkAsync('refreshSession falha -> erro propagado, nunca lanca excecao', async () => {
  const db = mockDb({ refreshError: { message: 'refresh falhou' } });
  const r = await syncTenant({ dbCliente: db, accessToken: TOKEN_SEM_TENANT, storeId: ENCANTO, storeStatus: 'ativo' });
  assert.strictEqual(r.ativado, false);
  assert.ok(r.error);
});

await checkAsync('dbCliente null -> nao lanca, so devolve ativado:false', async () => {
  const r = await syncTenant({ dbCliente: null, accessToken: TOKEN_SEM_TENANT, storeId: ENCANTO, storeStatus: 'ativo' });
  assert.strictEqual(r.ativado, false);
});

console.log(fail === 0 ? '✅ tenantSync.golden OK' : `❌ ${fail} falha(s)`);
process.exit(fail === 0 ? 0 : 1);
