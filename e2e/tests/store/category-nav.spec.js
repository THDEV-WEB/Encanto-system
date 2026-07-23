/* e2e/tests/store/category-nav.spec.js — REF-E2E-01 · Onda 2 (@read-only).
   Dropdown "Categorias" (src/components/nav/CategoryNav.jsx) no topo da página — antes de qualquer
   scroll, é a ÚNICA instância acessível (a cópia da barra sticky fica aria-hidden até ser revelada
   por rolagem, ver StickyBar.jsx), então os seletores por role aqui não são ambíguos. */
import { test, expect } from '../../fixtures/index.js';

const CATEGORIAS = [
  'Cardápio de Marmitas', 'Destaques', 'Copos Prontos', 'Monte seu Copo',
  'Batidinhas', 'Combos', 'Pedido Fitness', 'Bebidas',
];

test.describe('navegação por categorias', { tag: '@read-only' }, () => {
  test.beforeEach(async ({ storePage }) => { await storePage.goto(); });

  test('abre o dropdown e lista todas as categorias visíveis do catálogo mock', async ({ storePage, page }) => {
    await storePage.categoryMenuTrigger.click();
    await expect(page.getByRole('listbox', { name: 'Categorias' })).toBeVisible();
    for (const nome of CATEGORIAS) {
      await expect(page.getByRole('option', { name: nome })).toBeVisible();
    }
  });

  test('ESC fecha o dropdown e devolve o foco ao gatilho', async ({ storePage, page }) => {
    await storePage.categoryMenuTrigger.click();
    await expect(page.getByRole('listbox', { name: 'Categorias' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox', { name: 'Categorias' })).toBeHidden();
    await expect(storePage.categoryMenuTrigger).toBeFocused();
  });

  test('selecionar "Combos" rola até a seção correspondente', async ({ storePage, page }) => {
    // A precisão pixel-a-pixel do MARCADOR ativo (scroll-spy) já é golden-tested isoladamente em
    // utils/scrollSpyPick.js (test:spy) — reafirmar aria-selected aqui, num layout real com seções
    // lazy que podem mudar de altura durante a animação de rolagem, é sensível a timing sem agregar
    // proteção real. Esta spec fica só com o comportamento que o usuário de fato observa: clicar
    // navega até a seção certa.
    await storePage.selectCategory('Combos');
    await expect(page.locator('#sec-combos')).toBeInViewport();
  });
});
