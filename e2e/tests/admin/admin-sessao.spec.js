/* e2e/tests/admin/admin-sessao.spec.js — REF-E2E-03 · Onda 1 (@writes).
   2 achados reais da auditoria (ADR §1.2), testados como SE COMPORTAM hoje — não como alguém
   assumiria que deveriam se comportar:
   1. Não existe restauração de sessão do Admin: nenhum código chama db.auth.getSession()/
      onAuthStateChange() fora de AdminLogin.jsx, e App.jsx só entra em mode='admin' via onLogin(). Um
      reload no meio do painel remonta o React do zero; o hash '#admin-encanto' já foi limpo via
      history.replaceState no 1º mount (AdminLogin.jsx), então o F5 (sem hash na URL) inicializa
      mode='store' — cai na LOJA, não numa tela de login.
   2. Uma sessão forjada sob a chave padrão do client `db` (sb-<ref>-auth-token — sem storageKey
      customizado, ver lib/supabase.js) não trava o boot: nada no app relê essa chave para decidir
      `mode`, e o supabase-js só tenta o refresh internamente sem gerar erro não-capturado (mesma
      garantia já provada para o cliente em e2e/tests/auth/session-invalida.spec.js). */
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
  test('reload no meio do painel perde o estado e cai na loja (sem restauração — achado real)', async ({ adminLoginPage, adminPanel, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await expect(adminPanel.tab('dashboard')).toBeVisible();

    await page.reload();

    await expect(adminPanel.tab('dashboard')).toBeHidden();
    await expect(page.locator('.header')).toBeVisible(); // loja, não a tela de login
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

    await expect(page.locator('#enc-loader')).toHaveCount(0, { timeout: 15_000 });
    await expect(adminLoginPage.emailInput).toBeVisible();

    expect(erros, `erros JS não capturados: ${erros.map(String).join('; ')}`).toHaveLength(0);
    await context.close();
  });
});
