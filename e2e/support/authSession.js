/* e2e/support/authSession.js — REF-E2E-01.
   Sessao REAL de um cliente fixture, injetada via storageState — pula a tela de login (mecanica ja
   coberta em e2e/tests/auth/*, com o backend mockado via network-stubs.js), mas a sessao resultante e
   genuina: Admin API garante o usuario fixture (senha conhecida, idempotente); um client ANON comum
   faz signInWithPassword (o mesmo metodo que qualquer usuario real usaria), que devolve
   access_token/refresh_token de verdade — RLS funciona igual a producao. Cobre tanto o caminho
   e-mail quanto o Google: uma vez que existe sessao, o AuthProvider nao diferencia por qual provedor
   ela veio (ver docs/adr/REF-E2E-01-auditoria-playwright.md §Estrategia de autenticacao).
   Env-gated: sem o projeto de E2E, retorna null (specs que precisam de sessao real devem pular). */
import { supabaseAdmin, supabaseAnon, E2E_ENV_PRONTO, avisarAmbientePendente } from './supabaseAdmin.js';
import { CLIENTE_FIXTURE } from './fixture-accounts.js';

const STORAGE_KEY = 'encanto-cliente-auth';   // literal de src/lib/dbCliente.js — nao duplica logica, so o nome da chave

async function garantirUsuarioFixture(admin) {
  const { error } = await admin.auth.admin.createUser({
    email: CLIENTE_FIXTURE.email,
    password: CLIENTE_FIXTURE.senha,
    email_confirm: true,
  });
  if (error && !/already.*registered/i.test(error.message || '')) {
    throw new Error(`[e2e] criar cliente fixture falhou: ${error.message}`);
  }
}

/** Devolve um storageState (formato Playwright: {origin, localStorage:[{name,value}]}) com a sessao
    real do cliente fixture, pronto para `browserContext.addInitScript`/`context.storageState`.
    null se o ambiente de E2E ainda nao estiver configurado. */
export async function sessaoClienteFixture(baseURL) {
  if (!E2E_ENV_PRONTO) { avisarAmbientePendente('sessao real do cliente fixture'); return null; }
  const admin = supabaseAdmin();
  await garantirUsuarioFixture(admin);
  const anon = supabaseAnon();
  const { data, error } = await anon.auth.signInWithPassword({ email: CLIENTE_FIXTURE.email, password: CLIENTE_FIXTURE.senha });
  if (error || !data?.session) throw new Error(`[e2e] login do cliente fixture falhou: ${error?.message || 'sem sessao'}`);
  return {
    origin: new URL(baseURL).origin,
    localStorage: [{ name: STORAGE_KEY, value: JSON.stringify(data.session) }],
  };
}
