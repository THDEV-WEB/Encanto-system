/* e2e/tests/auth/session-persist-reload.spec.js — REF-E2E-02 · Onda 2 (@writes).
   Prova a PERSISTÊNCIA da sessão (não só a restauração no primeiro load): dbCliente usa
   `persistSession:true` — um reload força o app inteiro a remontar do zero e chamar `getSession()` de
   novo, lendo a mesma chave de localStorage. Sem isso, a sessão só "pareceria" viva por estar em
   memória React, e um F5 real do usuário derrubaria o login sem avisar (regressão que os testes
   read-only não conseguem ver, porque nunca recarregam a página). */
import { test, expect } from '@playwright/test';
import { StorePage } from '../../pages/StorePage.js';
import { contextClienteFixture } from '../../support/authSession.js';
import { garantirClienteFixtureVinculado } from '../../support/fixture-customer.js';

test.describe('sessão persiste entre reloads', { tag: '@writes' }, () => {
  /* Baseline vinculado — ver comentário em session-restore.spec.js. */
  test.beforeAll(async () => { await garantirClienteFixtureVinculado(); });

  test('F5 mantém o cliente logado', async ({ browser, baseURL }) => {
    const context = await contextClienteFixture(browser, baseURL);
    test.skip(!context, 'ambiente de E2E não configurado (.env.e2e)');

    const page = await context.newPage();
    const storePage = new StorePage(page);
    await storePage.goto();
    await storePage.abrirLogin();
    await expect(page.getByRole('button', { name: /Sair da conta/ })).toBeVisible();

    await page.reload();

    await storePage.abrirLogin();
    await expect(page.getByRole('button', { name: /Sair da conta/ })).toBeVisible();

    await context.close();
  });
});
