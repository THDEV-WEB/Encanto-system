/* e2e/tests/store/catalog.spec.js — REF-E2E-01 · Onda 2 (@read-only).
   Catalogo renderizado a partir do fallback MOCK (src/data/mockCatalog.js) — roda hoje sem o projeto
   Supabase de E2E (ver e2e/README.md). Cada categoria vira 1 secao (utils/catSection.js define o id
   de ancora); cada produto vira um card com data-prod estavel (ja usado pelo proprio test:render). */
import { test, expect } from '../../fixtures/index.js';

const SECOES = [
  ['sec-marmitas',   'Cardápio de Marmitas'],
  ['sec-destaques',  'Destaques'],
  ['sec-prontos',    'Copos Prontos'],
  ['sec-monte',      'Monte seu Copo'],
  ['sec-batidinha',  'Batidinhas'],
  ['sec-combos',     'Combos'],
  ['sec-fitness',    'Pedido Fitness'],
  ['sec-bebidas',    'Bebidas'],
];

test.describe('catálogo (fallback mock)', { tag: '@read-only' }, () => {
  test.beforeEach(async ({ storePage }) => { await storePage.goto(); });

  for (const [id, titulo] of SECOES) {
    test(`renderiza a secao "${titulo}" com pelo menos 1 produto`, async ({ page }) => {
      const secao = page.locator(`#${id}`);
      await secao.scrollIntoViewIfNeeded();
      await expect(secao.getByRole('heading', { name: new RegExp(titulo) })).toBeVisible();
      await expect(secao.locator('[data-prod]').first()).toBeVisible();
    });
  }

  test('mostra nome e preço corretos de produtos conhecidos do catálogo mock', async ({ storePage, page }) => {
    // o card de cada produto só monta quando a SEÇÃO (sempre presente no DOM) entra perto do
    // viewport (LazySection) — rolar até a seção primeiro é o que força esse mount.
    await page.locator('#sec-marmitas').scrollIntoViewIfNeeded();
    await expect(storePage.productCard('p9')).toContainText('Marmita P');
    await expect(storePage.productCard('p9')).toContainText(/R\$\s*15,99/);

    await page.locator('#sec-bebidas').scrollIntoViewIfNeeded();
    await expect(storePage.productCard('pac')).toContainText('Agua de Coco');
    await expect(storePage.productCard('pac')).toContainText(/R\$\s*10,00/);

    await page.locator('#sec-destaques').scrollIntoViewIfNeeded();
    await expect(storePage.productCard('pd2')).toContainText('Açaí 500 ml');
    await expect(storePage.productCard('pd2')).toContainText(/R\$\s*15,99/);
  });

  test('abrir um produto mostra o modal com nome/descrição/preço', async ({ storePage, page }) => {
    await storePage.openProduct('p9');
    const modal = page.locator('.modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.modal-title')).toHaveText('Marmita P');
    await expect(modal.locator('.modal-price')).toContainText(/R\$\s*15,99/);
  });
});
