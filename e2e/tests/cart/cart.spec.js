/* e2e/tests/cart/cart.spec.js — REF-E2E-01 · Onda 3 (@read-only).
   Carrinho é 100% local (localStorage, src/hooks/useCart.js) — nenhuma chamada ao backend. Roda hoje
   contra o catálogo mock, igual às Ondas 1/2. Produtos usados (p9 "Marmita P", pac "Agua de Coco")
   não têm `tamanhos`/`variantes` obrigatórios — "Adicionar" no modal funciona sem seleção prévia
   (produtos com variante obrigatória ficam fora desta onda, ver ProductModal.page.js). */
import { test, expect } from '../../fixtures/index.js';

test.describe('carrinho', { tag: '@read-only' }, () => {
  test.beforeEach(async ({ storePage }) => { await storePage.goto(); });

  test('adicionar um produto simples atualiza o badge do carrinho no header', async ({ storePage, productModal }) => {
    await storePage.openProduct('p9');
    await productModal.adicionar();
    await expect(storePage.cartBadge).toHaveText('1');
  });

  test('abre o carrinho e mostra o item com nome e preço corretos', async ({ storePage, productModal, cartSidebar }) => {
    await storePage.openProduct('p9');
    await productModal.adicionar();
    await storePage.openCart();
    await expect(cartSidebar.item('p9')).toBeVisible();
    await expect(cartSidebar.item('p9')).toContainText('Marmita P');
    await expect(cartSidebar.item('p9')).toContainText(/R\$\s*15,99/);
  });

  test('aumentar a quantidade recalcula o preço da linha', async ({ storePage, productModal, cartSidebar }) => {
    await storePage.openProduct('p9');
    await productModal.adicionar();
    await storePage.openCart();
    await cartSidebar.increaseQty('p9');
    await expect(cartSidebar.qty('p9')).toHaveText('2');
    await expect(cartSidebar.item('p9')).toContainText(/R\$\s*31,98/); // 15,99 × 2
  });

  test('diminuir a quantidade não passa de 1', async ({ storePage, productModal, cartSidebar }) => {
    await storePage.openProduct('p9');
    await productModal.adicionar();
    await storePage.openCart();
    await cartSidebar.decreaseQty('p9'); // já está em 1 — updateQty trava no mínimo (useCart.js)
    await expect(cartSidebar.qty('p9')).toHaveText('1');
  });

  test('remover o único item deixa o carrinho vazio e desabilita o checkout', async ({ storePage, productModal, cartSidebar }) => {
    await storePage.openProduct('p9');
    await productModal.adicionar();
    await storePage.openCart();
    await cartSidebar.removeItem('p9');
    await expect(cartSidebar.empty).toBeVisible();
    await expect(cartSidebar.checkoutButton).toBeDisabled();
  });

  test('carrinho vazio começa com o botão Finalizar Pedido desabilitado', async ({ storePage, cartSidebar }) => {
    await storePage.openCart();
    await expect(cartSidebar.checkoutButton).toBeDisabled();
  });

  test('adicionar dois produtos diferentes mantém as duas linhas e habilita o checkout', async ({ storePage, productModal, cartSidebar, page }) => {
    await storePage.openProduct('p9');
    await productModal.adicionar();

    await page.locator('#sec-bebidas').scrollIntoViewIfNeeded(); // pac (Agua de Coco) é lazy — monta só perto do viewport
    await storePage.openProduct('pac');
    await productModal.adicionar();

    await storePage.openCart();
    await expect(cartSidebar.item('p9')).toBeVisible();
    await expect(cartSidebar.item('pac')).toBeVisible();
    await expect(cartSidebar.checkoutButton).toBeEnabled();
  });
});
