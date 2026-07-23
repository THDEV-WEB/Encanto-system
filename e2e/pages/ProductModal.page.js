/* e2e/pages/ProductModal.page.js — REF-E2E-01 · Onda 3. Page Object do modal de produto
   (src/components/ProductModal/ProductModalInner.jsx), aberto a partir do card (StorePage.openProduct)
   ou do botão "+" (StorePage.addToCartFromCard — ambos chamam o mesmo onOpen). O botão "Adicionar"
   tem texto estável (+ preço concatenado no nome acessível, daí a regex). Produtos com `variantes`
   (ex.: sabor/tamanho obrigatório fora do array `tamanhos`) exigem seleção antes — fora do escopo
   desta Onda (specs usam produtos simples, sem variantes obrigatórias). */
export class ProductModalPage {
  constructor(page) {
    this.page = page;
    this.root = page.locator('.modal-overlay');
  }

  get addToCartButton() { return this.root.getByRole('button', { name: /Adicionar/ }); }
  get closeButton()      { return this.root.locator('.modal-close'); }
  get qtyValue()         { return this.root.locator('.qty-value'); }

  async increaseQty() { await this.root.locator('.qty-btn').nth(1).click(); }
  async decreaseQty() { await this.root.locator('.qty-btn').nth(0).click(); }

  /** Adiciona ao carrinho e espera o modal fechar (onAdd + onClose são síncronos no componente). */
  async adicionar() {
    await this.addToCartButton.click();
    await this.root.waitFor({ state: 'detached' });
  }
}
