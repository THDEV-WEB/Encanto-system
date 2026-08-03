/* e2e/tests/admin/admin-logout.spec.js — REF-E2E-03 · Onda 1 (@writes) · reescrito na REF-ADMIN-01 ·
   Onda 2 (fix: logout que não deslogava) · ajustado na REF-STABILITY-02 (reload sempre volta pra Loja)
   · reescrito de novo na REF-ADMIN-04 · Onda 5.
   Achado original (REF-E2E-03, ADR §1.2): "Sair" (sidebar) e "← Ver loja" (topo) chamavam o MESMO
   handler `onExit` (App.jsx) — só trocava o `mode` de volta para 'store', sem chamar
   db.auth.signOut() nunca. REF-ADMIN-01 · Onda 2 separou os dois comportamentos (useAdminSession.js):
   "Ver loja" continua só trocando de tela (prévia — sessão do Supabase permanece válida); "Sair" agora
   chama signOut() de verdade.

   REF-ADMIN-04 · Onda 5: o Admin virou bundle/app próprios (AdminApp.jsx, sem StoreApp nenhum aqui
   dentro). Isso muda o que cada botão faz de verdade:
   - "← Ver loja" deixou de ser troca de `mode` no MESMO bundle — agora é uma navegação real
     (window.location.href) para fora do admin, pro domínio da loja (VITE_STORE_URL, ver .env.e2e —
     relativo em E2E pra nunca sair batendo em produção de verdade). Depois dela, não sobra NENHUM DOM
     do admin na página — é a loja de verdade que carrega.
   - "Sair" não navega pra lugar nenhum — só troca `mode` de volta pra 'login' DENTRO do próprio bundle
     do admin (não existe mais "cair na loja" nesse caminho, porque não há loja neste bundle).

   Prova por rede (POST .../auth/v1/logout via page.route), não só navegação — se algum dia esses
   handlers voltarem a se misturar, este teste quebra. */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';

test.describe('sair do Admin', { tag: '@writes' }, () => {
  test('"← Ver loja" navega pra loja de verdade SEM chamar signOut() — é uma prévia, não um logout', async ({ page, adminLoginPage, adminPanel }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');

    let logoutChamado = false;
    await page.route('**/auth/v1/logout**', (route) => { logoutChamado = true; return route.continue(); });

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await expect(adminPanel.tab('dashboard')).toBeVisible();

    await adminPanel.verLoja();

    // Navegação real pra fora do admin — nenhum DOM do painel sobrevive, a loja renderiza de verdade.
    await expect(page.locator('.header')).toBeVisible();
    await expect(adminPanel.tab('dashboard')).toHaveCount(0);
    expect(logoutChamado).toBe(false);

    // A sessão do admin continua válida (persistência normal do Supabase) — voltando pro bundle do
    // admin direto (não existe mais engrenagem/hash na loja), "Entrar" reaproveita sem pedir senha de
    // novo (REF-UX-SESSION-01 exige confirmar explicitamente antes de entrar).
    await adminLoginPage.goto();
    await expect(page.locator('[data-testid="admin-login-senha"]')).toBeVisible(); // form de credencial (padrão), antes de clicar "Entrar"
    await adminLoginPage.entrarReaproveitandoSessao();
    await expect(adminPanel.tab('dashboard')).toBeVisible();
  });

  test('"Sair" desloga de verdade — chama signOut() e volta pro formulário de login (não pro painel)', async ({ page, adminLoginPage, adminPanel }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');

    let logoutChamado = false;
    await page.route('**/auth/v1/logout**', (route) => { logoutChamado = true; return route.continue(); });

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await expect(adminPanel.tab('dashboard')).toBeVisible();

    await adminPanel.logout();

    // "Sair" não navega pra loja nenhuma — o próprio bundle do admin volta pro formulário de login.
    await expect(adminPanel.tab('dashboard')).toBeHidden();
    await expect(adminLoginPage.emailInput).toBeVisible();
    expect(logoutChamado).toBe(true); // fix REF-ADMIN-01 · Onda 2 — antes era sempre false

    // Sessão realmente encerrada: um reload do bundle do admin não restaura o painel (precisaria logar
    // de novo — "Entrar" sem sessão válida cai direto no formulário de credencial).
    await page.reload();
    await expect(adminPanel.tab('dashboard')).toHaveCount(0);
    await expect(adminLoginPage.emailInput).toBeVisible();
  });
});
