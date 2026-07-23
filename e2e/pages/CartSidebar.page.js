/* e2e/pages/CartSidebar.page.js — REF-E2E-01. Page Object do carrinho (src/components/CartSidebar.jsx).
   Estado real do componente hoje: `.cart-sidebar` (raiz), 1 `.cart-item` por linha (SEM atributo que
   identifique o item — só `key={item._key}` em React, invisível no DOM), botões só-emoji sem
   aria-label (`.cqty-btn` × 2 por item [0]=−  [1]=+, `.cart-remove`, `.cart-close`), `.checkout-btn`
   com texto estável "Finalizar Pedido →".
   TODO(REF-E2E-01 · Onda cart): promover `.cart-item` a `data-testid="cart-item"` + `data-prod`/
   `data-key` (mesmo padrão do `data-prod` que ProductCard já tem) no commit da 1ª spec de carrinho —
   até lá, `item(nome)` localiza por nome do produto (`.cart-item-name`), a única informação estável
   hoje sem mexer no componente. */
export class CartSidebarPage {
  constructor(page) {
    this.page = page;
    this.root = page.locator('.cart-sidebar');
  }

  /** Localiza a linha do carrinho pelo NOME do produto — interino até existir um identificador
      estrutural (ver TODO acima). Falha (ambíguo) se dois itens tiverem o mesmo nome no carrinho. */
  item(nomeProduto) {
    return this.root.locator('.cart-item').filter({ has: this.page.locator('.cart-item-name', { hasText: nomeProduto }) });
  }

  get closeButton() { return this.root.locator('.cart-close'); }
  get checkoutButton() { return this.root.getByRole('button', { name: /Finalizar Pedido/ }); }

  async close() { await this.closeButton.click(); }
  async goToCheckout() { await this.checkoutButton.click(); }

  async increaseQty(nomeProduto) { await this.item(nomeProduto).locator('.cqty-btn').nth(1).click(); }
  async decreaseQty(nomeProduto) { await this.item(nomeProduto).locator('.cqty-btn').nth(0).click(); }
  async removeItem(nomeProduto) { await this.item(nomeProduto).locator('.cart-remove').click(); }
  async quantidade(nomeProduto) { return this.item(nomeProduto).locator('.cqty-val').innerText(); }
}
