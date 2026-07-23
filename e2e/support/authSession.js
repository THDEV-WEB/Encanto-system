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

/* Exportado (nao so local): specs de sessao invalida/forjada (REF-E2E-02 Onda 2) precisam do MESMO
   nome de chave para montar um storageState com um token forjado, sem duplicar o literal. */
export const STORAGE_KEY = 'encanto-cliente-auth';   // literal de src/lib/dbCliente.js — nao duplica logica, so o nome da chave

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

/** Devolve um storageState no formato REAL exigido pelo Playwright — `{cookies, origins:[{origin,
    localStorage}]}` (o `origins` É um array; um objeto {origin,localStorage} solto, sem o array por
    fora, é silenciosamente ignorado por `browser.newContext({storageState})`, sem erro nenhum: o
    contexto simplesmente nasce sem a sessão, e o app mostra o estado anônimo normalmente — foi
    exatamente esse bug, presente desde a criação deste helper na Onda 1 da E2E-01 e nunca antes
    exercitado por nenhum spec, que a Onda 2 da E2E-02 pegou ao usar isto pela primeira vez de verdade).
    Pronto para `browser.newContext({storageState})`. null se o ambiente de E2E ainda não estiver
    configurado. */
export async function sessaoClienteFixture(baseURL) {
  if (!E2E_ENV_PRONTO) { avisarAmbientePendente('sessao real do cliente fixture'); return null; }
  const admin = supabaseAdmin();
  await garantirUsuarioFixture(admin);
  const anon = supabaseAnon();
  const { data, error } = await anon.auth.signInWithPassword({ email: CLIENTE_FIXTURE.email, password: CLIENTE_FIXTURE.senha });
  if (error || !data?.session) throw new Error(`[e2e] login do cliente fixture falhou: ${error?.message || 'sem sessao'}`);
  return {
    cookies: [],
    origins: [{
      origin: new URL(baseURL).origin,
      localStorage: [{ name: STORAGE_KEY, value: JSON.stringify(data.session) }],
    }],
  };
}

/** REF-E2E-02 · Onda 2: browser context com a sessao real do cliente fixture ja injetada
    (storageState), pronto para `context.newPage()`. Evita repetir `browser.newContext({storageState})`
    em cada spec de sessao/cliente autenticado (session-restore, Minha Conta, Meus Pedidos, checkout
    logado, etc.). null se o ambiente de E2E nao estiver configurado — a spec deve `test.skip`. */
export async function contextClienteFixture(browser, baseURL) {
  const storageState = await sessaoClienteFixture(baseURL);
  if (!storageState) return null;
  return browser.newContext({ storageState });
}
