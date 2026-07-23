/* e2e/pages/CartSidebar.page.js — REF-E2E-01 · Onda 3. Page Object do carrinho
   (src/components/CartSidebar.jsx). `.cart-item` ganhou `data-prod` (mesma convenção do
   ProductCard) e o botão de fechar ganhou `data-testid="cart-close"` nesta Onda — os dois únicos
   elementos que precisavam de identificador estável para os specs de carrinho. Os botões de
   qty/remover continuam por classe (`.cqty-btn`/`.cart-remove`), mas agora SCOPED dentro do
   `[data-prod=X]` já identificado — par determinístico (sempre 2 botões, ordem fixa no JSX), não
   uma classe solta usada como identidade da página inteira. */
export class CartSidebarPage {
  constructor(page) {
    this.page = page;
    this.root = page.locator('.cart-sidebar');
  }

  item(prodId) {
    return this.root.locator(`[data-prod="${prodId}"]`);
  }

  get closeButton() { return this.root.getByTestId('cart-close'); }
  get checkoutButton() { return this.root.getByRole('button', { name: /Finalizar Pedido/ }); }
  get empty() { return this.root.locator('.cart-empty'); }

  async close() { await this.closeButton.click(); }
  async goToCheckout() { await this.checkoutButton.click(); }

  async increaseQty(prodId) { await this.item(prodId).locator('.cqty-btn').nth(1).click(); }
  async decreaseQty(prodId) { await this.item(prodId).locator('.cqty-btn').nth(0).click(); }
  async removeItem(prodId)  { await this.item(prodId).locator('.cart-remove').click(); }
  qty(prodId) { return this.item(prodId).locator('.cqty-val'); }
}
