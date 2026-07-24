/* e2e/tests/admin/admin-logout.spec.js — REF-E2E-03 · Onda 1 (@writes) · reescrito na REF-ADMIN-01 ·
   Onda 2 (fix: logout que não deslogava).
   Achado original (REF-E2E-03, ADR §1.2): "Sair" (sidebar) e "← Ver loja" (topo) chamavam o MESMO
   handler `onExit` (App.jsx) — só trocava o `mode` de volta para 'store', sem chamar
   db.auth.signOut() nunca. REF-ADMIN-01 · Onda 2 separou os dois comportamentos (useAdminSession.js):
   "Ver loja" continua só trocando de tela (prévia — sessão do Supabase permanece válida, F5 depois
   volta para o Admin, ver admin-sessao.spec.js); "Sair" agora chama signOut() de verdade.

   Prova por rede (POST .../auth/v1/logout via page.route), não só navegação — se algum dia esses
   handlers voltarem a se misturar, este teste quebra. */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';

test.describe('sair do Admin', { tag: '@writes' }, () => {
  test('"← Ver loja" volta para a loja SEM chamar signOut() — é uma prévia, não um logout', async ({ page, adminLoginPage, adminPanel }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');

    let logoutChamado = false;
    await page.route('**/auth/v1/logout**', (route) => { logoutChamado = true; return route.continue(); });

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await expect(adminPanel.tab('dashboard')).toBeVisible();

    await adminPanel.verLoja();

    await expect(adminPanel.tab('dashboard')).toBeHidden();
    await expect(page.locator('.header')).toBeVisible(); // loja renderizou
    expect(logoutChamado).toBe(false);

    // A sessão continua válida: um F5 agora volta direto para o Admin (não pede login de novo).
    await page.reload();
    await expect(adminPanel.tab('dashboard')).toBeVisible();
  });

  test('"Sair" desloga de verdade — chama signOut() e um F5 depois cai na loja, não no Admin', async ({ page, adminLoginPage, adminPanel }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');

    let logoutChamado = false;
    await page.route('**/auth/v1/logout**', (route) => { logoutChamado = true; return route.continue(); });

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await expect(adminPanel.tab('dashboard')).toBeVisible();

    await adminPanel.logout();

    await expect(adminPanel.tab('dashboard')).toBeHidden();
    await expect(page.locator('.header')).toBeVisible(); // loja renderizou
    expect(logoutChamado).toBe(true); // fix REF-ADMIN-01 · Onda 2 — antes era sempre false

    // Sessão realmente encerrada: F5 não restaura o Admin (precisaria logar de novo).
    await page.reload();
    await expect(adminPanel.tab('dashboard')).toHaveCount(0);
    await expect(page.locator('.header')).toBeVisible();
  });
});
