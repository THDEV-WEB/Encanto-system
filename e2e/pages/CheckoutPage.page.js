/* e2e/pages/CheckoutPage.page.js — REF-E2E-01 · Onda 4. Page Object do checkout
   (src/components/checkout/CheckoutPage.jsx). Os inputs de nome/telefone/observação não tinham
   <label htmlFor> associado — data-testid adicionados nesta Onda (checkout-nome/checkout-telefone/
   checkout-obs/checkout-submit/checkout-erro), junto com a 1ª spec de checkout real. */
export class CheckoutPagePO {
  constructor(page) { this.page = page; }

  get nomeInput()     { return this.page.locator('[data-testid="checkout-nome"]'); }
  get telefoneInput() { return this.page.locator('[data-testid="checkout-telefone"]'); }
  get obsInput()       { return this.page.locator('[data-testid="checkout-obs"]'); }
  get submitButton()  { return this.page.locator('[data-testid="checkout-submit"]'); }
  get erroMensagem()  { return this.page.locator('[data-testid="checkout-erro"]'); }

  async preencher({ nome, telefone, obs }) {
    if (nome)     await this.nomeInput.fill(nome);
    if (telefone) await this.telefoneInput.fill(telefone);
    if (obs)      await this.obsInput.fill(obs);
  }

  async finalizar() { await this.submitButton.click(); }
}
