/* e2e/pages/StorePage.js — REF-E2E-01. Page Object da loja (home). Seletores em ordem de
   preferencia: role/label acessivel > data-testid > (ultimo caso, marcado) classe CSS temporaria.
   `data-prod` no ProductCard já existe hoje (não é novidade desta REF — reaproveitado do próprio
   render.smoke.mjs). */
export class StorePage {
  constructor(page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto('/');
  }

  /** Acesso ao Admin — mesma rota que a app real usa (App.jsx le location.hash), sem seletor algum. */
  async gotoAdmin() {
    await this.page.goto('/#admin-encanto');
  }

  productCard(prodId) {
    return this.page.locator(`[data-prod="${prodId}"]`);
  }

  async addToCartFromCard(prodId) {
    // botão "+" do card — hoje só existe como `.add-btn` (sem texto/aria); ao introduzir a 1ª spec
    // de carrinho, promover para data-testid="product-card-add" (ver auditoria, tabela de seletores).
    await this.productCard(prodId).locator('.add-btn').click();
  }

  async openProduct(prodId) {
    await this.productCard(prodId).click();
  }

  get searchInput() {
    return this.page.getByLabel('Buscar na loja'); // aria-label já existe (SearchBar.jsx) — nada a adicionar
  }

  async search(termo) {
    await this.searchInput.fill(termo);
  }

  get categoryMenuTrigger() {
    return this.page.getByRole('button', { name: 'Categorias' }); // texto estável do catnav-trigger (CategoryNav.jsx)
  }

  async selectCategory(nomeCategoria) {
    await this.categoryMenuTrigger.click();
    await this.page.getByRole('option', { name: nomeCategoria }).click();
  }

  /** TODO(REF-E2E-01 · Onda cart): `.header-cart-btn` não tem aria-label nem data-testid — o texto
      visível muda conforme o carrinho (🛒 vazio vs 🛒 R$ x,xx). Promover para
      data-testid="header-cart-btn" no commit que introduzir o 1º spec de carrinho. */
  get cartButton() {
    return this.page.locator('.header-cart-btn');
  }

  async openCart() {
    await this.cartButton.click();
  }

  /** Botão ☰ do header — já tem aria-label="Menu" (StoreMenu.jsx), nada a adicionar. */
  get menuButton() {
    return this.page.getByRole('button', { name: 'Menu' });
  }

  async openMenu() {
    await this.menuButton.click();
  }
}
