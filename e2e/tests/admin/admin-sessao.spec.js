/* e2e/tests/admin/admin-sessao.spec.js — REF-E2E-03 · Onda 1 (@writes) · reescrito na REF-ADMIN-01 ·
   Onda 2 (fix: restauração de sessão do Admin).
   Achado original (REF-E2E-03, ADR §1.2): nenhum código chamava db.auth.getSession()/
   onAuthStateChange() fora de AdminLogin.jsx, e App.jsx só entrava em mode='admin' via onLogin(). Um
   reload no meio do painel remontava o React do zero; o hash '#admin-encanto' já tinha sido limpo via
   history.replaceState no 1º mount, então o F5 (sem hash na URL) inicializava mode='store' — caía na
   LOJA, mesmo com o token do Supabase ainda válido em localStorage.

   REF-ADMIN-01 · Onda 2 corrigiu via hooks/useAdminSession.js: getSession() no mount (espelha o
   padrão já usado por AuthProvider/AuthService do lado do cliente) restaura mode='admin' quando há
   sessão válida — tanto vindo de mode='store' (F5 direto) quanto de mode='login' (link com o hash
   '#admin-encanto' enquanto já autenticado, não precisa digitar senha de novo). onAuthStateChange
   mantém o modo sincronizado se a sessão cair (ex.: refresh token revogado) enquanto o Admin está
   aberto — sem loop, uma única transição para 'store'. */
import { test, expect } from '../../fixtures/index.js';
import { AdminLoginPage } from '../../pages/AdminLoginPage.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { E2E_ENV, E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';

function chaveStorageAdmin() {
  const ref = new URL(E2E_ENV.url).hostname.split('.')[0];
  return `sb-${ref}-auth-token`; // default do supabase-js quando storageKey não é customizado (GoTrueClient)
}

function sessaoAdminForjada() {
  const expiradoHaUmaHora = Math.floor(Date.now() / 1000) - 3600;
  return {
    access_token: 'invalido.invalido.invalido',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiradoHaUmaHora,
    refresh_token: 'refresh-token-forjado-nao-existe',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      aud: 'authenticated',
      email: 'sessao-admin-invalida@teste.encanto.local',
      app_metadata: {}, user_metadata: {},
    },
  };
}

test.describe('sessão do Admin', { tag: '@writes' }, () => {
  test('reload no meio do painel mantém o Admin autenticado (fix REF-ADMIN-01 · Onda 2)', async ({ adminLoginPage, adminPanel, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await expect(adminPanel.tab('dashboard')).toBeVisible();

    await page.reload();

    await expect(adminPanel.tab('dashboard')).toBeVisible(); // sessão restaurada, sem pedir login de novo
    await expect(page.locator('[data-testid="admin-login-senha"]')).toHaveCount(0);
  });

  test('reload com sessão de Admin salva nunca busca o catálogo da Loja (fix REF-ADMIN-02 · Onda 2 — flash)', async ({ adminLoginPage, adminPanel, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await expect(adminPanel.tab('dashboard')).toBeVisible();

    // Achado (ADR REF-ADMIN-01, limitação conhecida): antes, o 1º render de um reload SEMPRE assumia
    // mode='store' até getSession() resolver — StoreApp montava e useCategories/useProducts disparavam
    // esses 2 fetches imediatamente. Prova por rede (não por timing): se o fix (mode='checking' isolado)
    // funciona, a Loja nunca chega a montar entre o reload e o painel reaparecer — zero chamadas.
    let chamouCatalogoDaLoja = false;
    await page.route('**/rest/v1/products**', (route) => { chamouCatalogoDaLoja = true; return route.continue(); });
    await page.route('**/rest/v1/categories**', (route) => { chamouCatalogoDaLoja = true; return route.continue(); });

    await page.reload();
    await expect(adminPanel.tab('dashboard')).toBeVisible(); // sessão restaurada (dashboard não usa products/categories)
    expect(chamouCatalogoDaLoja).toBe(false);
  });

  test('acessar #admin-encanto já autenticado pula a tela de login direto para o painel', async ({ adminLoginPage, adminPanel, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await expect(adminPanel.tab('dashboard')).toBeVisible();

    // Simula reabrir pelo link com hash (ex.: favorito) enquanto a sessão do 1º login ainda é válida.
    await adminLoginPage.goto();

    await expect(adminPanel.tab('dashboard')).toBeVisible();
    await expect(page.locator('[data-testid="admin-login-senha"]')).toHaveCount(0);
  });

  test('sessão forjada não trava o boot — tela de login aparece normalmente', async ({ browser, baseURL }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');

    const context = await browser.newContext({
      storageState: {
        cookies: [],
        origins: [{
          origin: new URL(baseURL).origin,
          localStorage: [{ name: chaveStorageAdmin(), value: JSON.stringify(sessaoAdminForjada()) }],
        }],
      },
    });
    const page = await context.newPage();
    const erros = [];
    page.on('pageerror', (err) => erros.push(err));

    const adminLoginPage = new AdminLoginPage(page);
    await adminLoginPage.goto();

    // useAdminSession AGORA lê essa chave (getSession()) para tentar restaurar — mas um refresh_token
    // forjado só falha ao tentar renovar (sem lançar) e a sessão vira null: a tela de login continua
    // aparecendo normalmente, sem travar o boot nem gerar erro não capturado.
    await expect(page.locator('#enc-loader')).toHaveCount(0, { timeout: 15_000 });
    await expect(adminLoginPage.emailInput).toBeVisible();

    expect(erros, `erros JS não capturados: ${erros.map(String).join('; ')}`).toHaveLength(0);
    await context.close();
  });
});
