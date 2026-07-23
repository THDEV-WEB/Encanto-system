/* e2e/tests/store/catalog.spec.js — REF-E2E-01 · Onda 2 (@read-only).
   Catálogo semeado no projeto Supabase DEDICADO a E2E (e2e/support/seed-catalog.sql, aplicado via
   `node scripts/e2e-seed.mjs`) — espelha nomes/categorias/ordem de src/data/mockCatalog.js, então o
   comportamento observado aqui é idêntico ao que era validado contra o fallback mock (Onda 1-3, antes
   do .env.e2e ganhar credenciais reais). Cada categoria vira 1 seção (utils/catSection.js define o id
   de âncora pelo NOME da categoria); cada produto vira um card com data-prod estável. */
import { test, expect } from '../../fixtures/index.js';
import { PROD_MARMITA_P, PROD_AGUA_DE_COCO, PROD_ACAI_500ML } from '../../support/fixture-catalog.js';

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

test.describe('catálogo (fixture E2E)', { tag: '@read-only' }, () => {
  test.beforeEach(async ({ storePage }) => { await storePage.goto(); });

  for (const [id, titulo] of SECOES) {
    test(`renderiza a secao "${titulo}" com pelo menos 1 produto`, async ({ page }) => {
      const secao = page.locator(`#${id}`);
      await secao.scrollIntoViewIfNeeded();
      await expect(secao.getByRole('heading', { name: new RegExp(titulo) })).toBeVisible();
      await expect(secao.locator('[data-prod]').first()).toBeVisible();
    });
  }

  test('mostra nome e preço corretos de produtos conhecidos do catálogo fixture', async ({ storePage, page }) => {
    // o card de cada produto só monta quando a SEÇÃO (sempre presente no DOM) entra perto do
    // viewport (LazySection) — rolar até a seção primeiro é o que força esse mount.
    await page.locator('#sec-marmitas').scrollIntoViewIfNeeded();
    await expect(storePage.productCard(PROD_MARMITA_P)).toContainText('Marmita P');
    await expect(storePage.productCard(PROD_MARMITA_P)).toContainText(/R\$\s*15,99/);

    await page.locator('#sec-bebidas').scrollIntoViewIfNeeded();
    await expect(storePage.productCard(PROD_AGUA_DE_COCO)).toContainText('Agua de Coco');
    await expect(storePage.productCard(PROD_AGUA_DE_COCO)).toContainText(/R\$\s*10,00/);

    await page.locator('#sec-destaques').scrollIntoViewIfNeeded();
    await expect(storePage.productCard(PROD_ACAI_500ML)).toContainText('Açaí 500 ml');
    await expect(storePage.productCard(PROD_ACAI_500ML)).toContainText(/R\$\s*15,99/);
  });

  test('abrir um produto mostra o modal com nome/descrição/preço', async ({ storePage, page }) => {
    await storePage.openProduct(PROD_MARMITA_P);
    const modal = page.locator('.modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.modal-title')).toHaveText('Marmita P');
    await expect(modal.locator('.modal-price')).toContainText(/R\$\s*15,99/);
  });
});
