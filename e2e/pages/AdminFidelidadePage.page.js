/* e2e/pages/AdminFidelidadePage.page.js — REF-E2E-03 · Onda 5.
   Page Object da aba Fidelidade (src/components/admin/AdminFidelidade.jsx) — 3 sub-painéis (toggle
   Ativo/Desativado, busca+ações de um cliente, config do programa). Só os campos do form de config
   (Pedidos p/ recompensa/Desconto) e o toggle Ativo precisam de data-testid (mesma ausência de
   <label htmlFor>); busca/nota usam `getByPlaceholder` (placeholder estável, equivalente a um rótulo
   real aqui — não há outro texto associável) e os botões de ação já são texto real (getByRole). */
export class AdminFidelidadePage {
  constructor(page) { this.page = page; }

  /* Toggle "Ativo/Desativado" do programa — mesmo padrão `.toggle-switch input{opacity:0}` da Onda 4:
     o <input> só serve para asserção, o clique real mira o `.toggle-slider` visível ao lado. */
  get enabledCheckbox() { return this.page.locator('[data-testid="fid-form-enabled"]'); }
  get enabledToggleClicavel() { return this.enabledCheckbox.locator('xpath=following-sibling::span[1]'); }

  get buscarInput()  { return this.page.getByPlaceholder('Telefone (com DDD) ou nome do cliente'); }
  get buscarButton() { return this.page.getByRole('button', { name: /Buscar/ }); }
  async buscar(query) { await this.buscarInput.fill(query); await this.buscarButton.click(); }

  get notaInput()      { return this.page.getByPlaceholder('Motivo do ajuste (opcional)'); }
  get maisSeloButton() { return this.page.getByRole('button', { name: '+ Selo' }); }
  get menosSeloButton(){ return this.page.getByRole('button', { name: '− Selo' }); }
  get resgatarButton() { return this.page.getByRole('button', { name: /Resgatar recompensa/ }); }

  get requiredInput() { return this.page.locator('[data-testid="fid-form-required"]'); }
  get discountInput() { return this.page.locator('[data-testid="fid-form-discount"]'); }
  /* REF-LOYALTY-AUDIT-01 · Onda 3: testid estavel (nao mais texto/role) -- o rotulo do botao muda pra
     "Salvando…"/"✓ Salvo!" durante e apos o save (guarda de reentrancia cfgSaving), entao um locator
     por nome ("Salvar configurações") deixa de casar exatamente durante a janela que os testes de
     corrida precisam observar. */
  get salvarConfigButton() { return this.page.locator('[data-testid="fid-form-salvar"]'); }
  async salvarConfig({ required, discount } = {}) {
    if (required != null) await this.requiredInput.fill(String(required));
    if (discount != null) await this.discountInput.fill(String(discount));
    await this.salvarConfigButton.click();
  }
}
