/* e2e/pages/AdminAdicionaisPage.page.js — REF-E2E-03 · Onda 3.
   Page Object da aba Adicionais (src/components/admin/AdminAdicionais.jsx). Mesma ausência de
   <label htmlFor> do form de Categorias — data-testid nos campos (ad-form-nome/tipo/grupo/preco,
   `preco` só existe no DOM quando tipo==='pago') + `data-testid="ad-row-{id}"` na linha da tabela. */
export class AdminAdicionaisPage {
  constructor(page) { this.page = page; }

  get novoButton() { return this.page.getByRole('button', { name: '+ Novo' }); }
  row(id) { return this.page.locator(`[data-testid="ad-row-${id}"]`); }
  editarButton(id)  { return this.row(id).getByRole('button', { name: '✏️' }); }
  excluirButton(id) { return this.row(id).getByRole('button', { name: '🗑' }); }

  get nomeInput()   { return this.page.locator('[data-testid="ad-form-nome"]'); }
  get tipoSelect()  { return this.page.locator('[data-testid="ad-form-tipo"]'); }
  get grupoSelect() { return this.page.locator('[data-testid="ad-form-grupo"]'); }
  get precoInput()  { return this.page.locator('[data-testid="ad-form-preco"]'); } // só no DOM se tipo==='pago'
  get salvarButton()   { return this.page.getByRole('button', { name: 'Salvar' }); }
  get cancelarButton() { return this.page.getByRole('button', { name: 'Cancelar' }); }

  async abrirNovo() { await this.novoButton.click(); }
  async editar(id) { await this.editarButton(id).click(); }

  async preencher({ nome, tipo, grupo, preco } = {}) {
    if (nome != null)  await this.nomeInput.fill(nome);
    if (tipo != null)  await this.tipoSelect.selectOption(tipo);
    if (grupo != null) await this.grupoSelect.selectOption(grupo);
    if (preco != null) await this.precoInput.fill(String(preco));
  }

  async salvar() { await this.salvarButton.click(); }

  /** `window.confirm` nativo — mesmo racional de AdminCategoriasPage.excluir. */
  async excluir(id) {
    this.page.once('dialog', (d) => d.accept());
    await this.excluirButton(id).click();
  }
}
