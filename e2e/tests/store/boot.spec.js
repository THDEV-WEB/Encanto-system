/* e2e/tests/store/boot.spec.js — REF-E2E-01 · Onda 1 (infra).
   Spec trivial que prova a esteira inteira (Playwright -> vite --mode e2e -> app real no browser)
   antes de qualquer spec de negócio. Roda HOJE sem o projeto Supabase de E2E: sem VITE_SUPABASE_URL/
   KEY em .env.e2e, o app cai no modo degradado (db=null) e usa o catálogo MOCK
   (src/data/mockCatalog.js) — determinístico, sem rede, sem tocar nenhum Supabase. @read-only. */
import { test, expect } from '../../fixtures/index.js';

test.describe('boot da loja', () => {
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

  test('renderiza o catálogo (fallback mock quando .env.e2e ainda não aponta para um Supabase)', async ({ storePage, page }) => {
    await storePage.goto();
    await expect(page.locator('[data-prod]').first()).toBeVisible({ timeout: 15_000 });
  });
});
