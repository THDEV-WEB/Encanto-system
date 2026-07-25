/* e2e/tests/auth/logout.spec.js — REF-E2E-02 · Onda 2 (@writes).
   `sair()` (AuthProvider.jsx) = signOut() + limpa customer/precisaTelefone local. LoginScreen.jsx
   fecha a própria tela ao clicar "Sair da conta" (onClose após o await) — por isso a spec reabre o
   login para confirmar que voltou ao ramo anônimo (não fica testando o fechamento do modal em si,
   que é incidental). O 2º reload prova que o logout também limpou a sessão persistida, não só o
   estado React em memória (mesmo racional de session-persist-reload.spec.js). */
import { test, expect } from '@playwright/test';
import { StorePage } from '../../pages/StorePage.js';
import { contextClienteFixture } from '../../support/authSession.js';
import { garantirClienteFixtureVinculado } from '../../support/fixture-customer.js';

test.describe('logout', { tag: '@writes' }, () => {
  /* Baseline vinculado — ver comentário em session-restore.spec.js. */
  test.beforeAll(async () => { await garantirClienteFixtureVinculado(); });

  test('sair volta ao estado anônimo e sobrevive a um reload', async ({ browser, baseURL }) => {
    const context = await contextClienteFixture(browser, baseURL);
    test.skip(!context, 'ambiente de E2E não configurado (.env.e2e)');

    const page = await context.newPage();
    const storePage = new StorePage(page);
    await storePage.goto();

    await storePage.abrirLogin();
    await page.getByRole('button', { name: /Sair da conta/ }).click();

    await storePage.abrirLogin();
    await expect(page.getByRole('button', { name: 'Continuar com Google' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Sair da conta/ })).toBeHidden();

    await page.reload();

    await storePage.abrirLogin();
    await expect(page.getByRole('button', { name: 'Continuar com Google' })).toBeVisible();

    await context.close();
  });

  test('sair também limpa o cache local de visitante (fix REF-CUSTOMER-01 — dispositivo compartilhado)', async ({ browser, baseURL }) => {
    const context = await contextClienteFixture(browser, baseURL);
    test.skip(!context, 'ambiente de E2E não configurado (.env.e2e)');

    const page = await context.newPage();
    const storePage = new StorePage(page);
    await storePage.goto();

    // Simula um cache de visitante deixado por OUTRA pessoa neste mesmo navegador antes deste login.
    await page.evaluate(() => {
      window.localStorage.setItem('encanto_guest_identity', JSON.stringify({ version: 1, nome: 'Visitante Anterior', telefone: '11988887777', savedAt: Date.now() }));
    });

    await storePage.abrirLogin();
    await page.getByRole('button', { name: /Sair da conta/ }).click();

    const cacheAposLogout = await page.evaluate(() => window.localStorage.getItem('encanto_guest_identity'));
    expect(cacheAposLogout).toBeNull();

    await context.close();
  });
});
