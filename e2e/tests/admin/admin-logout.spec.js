/* e2e/tests/admin/admin-logout.spec.js — REF-E2E-03 · Onda 1 (@writes).
   "Sair" (rodapé da sidebar) e "← Ver loja" (topo) chamam o MESMO handler `onExit` (App.jsx) — que só
   troca o `mode` de volta para 'store', SEM chamar db.auth.signOut() (achado real, ADR §1.2). Por isso
   este teste não é equivalente a e2e/tests/auth/logout.spec.js (cliente): não há sessão a "desfazer"
   no app — nada relê o token do Admin do localStorage, nem antes nem depois do clique (ver
   admin-sessao.spec.js). O que se prova aqui é a navegação (volta à loja, painel desaparece) + a
   ausência real da chamada de rede de logout (POST .../auth/v1/logout), interceptada via page.route —
   se algum dia esse botão passar a chamar signOut(), este teste quebra e força atualizar o achado do
   ADR, não só o código. */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';

test.describe('sair do Admin', { tag: '@writes' }, () => {
  test('volta para a loja e NÃO chama signOut() no backend', async ({ page, adminLoginPage, adminPanel }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');

    let logoutChamado = false;
    await page.route('**/auth/v1/logout**', (route) => { logoutChamado = true; return route.continue(); });

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await expect(adminPanel.tab('dashboard')).toBeVisible();

    await adminPanel.sair();

    await expect(adminPanel.tab('dashboard')).toBeHidden();
    await expect(page.locator('.header')).toBeVisible(); // loja renderizou

    expect(logoutChamado).toBe(false); // achado real do ADR §1.2 — onExit não desloga do Supabase
  });
});
