/* e2e/tests/store/boot.spec.js — REF-E2E-01 · Onda 1 (infra).
   Spec trivial que prova a esteira inteira (Playwright -> vite --mode e2e -> app real no browser)
   antes de qualquer spec de negócio. Roda com QUALQUER catálogo (fallback mock local se .env.e2e
   estiver em branco, ou o catálogo fixture do projeto de E2E — Onda 4 em diante) — a única coisa
   afirmada aqui é que o boot não quebra e que ALGUM produto renderiza. @read-only. */
import { test, expect } from '../../fixtures/index.js';

test.describe('boot da loja', { tag: '@read-only' }, () => {
  test('carrega sem erro e sai do loader inicial', async ({ page }) => {
    const erros = [];
    page.on('pageerror', (err) => erros.push(err));

    await page.goto('/');

    // o loader estático (index.html) some assim que o React faz o commit da árvore real
    await expect(page.locator('#enc-loader')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('.header')).toBeVisible();
    await expect(page).toHaveTitle(/Encanto/);

    expect(erros, `erros JS não capturados durante o boot: ${erros.map(String).join('; ')}`).toHaveLength(0);
  });

  test('renderiza ao menos 1 produto do catálogo', async ({ storePage, page }) => {
    await storePage.goto();
    await expect(page.locator('[data-prod]').first()).toBeVisible({ timeout: 15_000 });
  });
});
