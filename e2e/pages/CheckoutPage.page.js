/* e2e/pages/CheckoutPage.page.js — REF-E2E-01. Page Object do checkout
   (src/components/checkout/CheckoutPage.jsx). Hoje os inputs de nome/telefone/observação NÃO têm
   <label htmlFor> associado nem data-testid — só className="form-input"/placeholder.
   TODO(REF-E2E-01 · Onda checkout, BLOQUEADA pelo projeto Supabase de E2E — ver auditoria): promover
   para data-testid (checkout-nome/checkout-telefone/checkout-obs/checkout-submit) no commit que
   introduzir a 1ª spec de checkout real (create_order só deve rodar contra o ambiente dedicado). */
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
