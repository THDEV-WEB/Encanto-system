/* e2e/pages/AdminCategoriasPage.page.js — REF-E2E-03 · Onda 3.
   Page Object da aba Categorias (src/components/admin/AdminCategorias.jsx). O formulário não tem
   nenhum <label htmlFor> (achado da auditoria, ADR §1.5 — label e input são irmãos, não associados) —
   por isso os campos usam data-testid (cat-form-nome/icone/ordem), único ajuste de produção desta
   tela além de `data-testid="cat-row-{id}"` na linha da tabela (escopa editar/excluir por categoria,
   sem depender de posição). Botões "Salvar"/"Cancelar"/"+ Nova" já são texto estável — getByRole. */
export class AdminCategoriasPage {
  constructor(page) { this.page = page; }

  get novaButton() { return this.page.getByRole('button', { name: '+ Nova' }); }
  row(id) { return this.page.locator(`[data-testid="cat-row-${id}"]`); }
  editarButton(id)  { return this.row(id).getByRole('button', { name: /Editar/ }); }
  excluirButton(id) { return this.row(id).getByRole('button', { name: '🗑' }); }

  get nomeInput()  { return this.page.locator('[data-testid="cat-form-nome"]'); }
  get iconeInput() { return this.page.locator('[data-testid="cat-form-icone"]'); }
  get ordemInput() { return this.page.locator('[data-testid="cat-form-ordem"]'); }
  get salvarButton()   { return this.page.getByRole('button', { name: 'Salvar' }); }
  get cancelarButton() { return this.page.getByRole('button', { name: 'Cancelar' }); }

  async abrirNova() { await this.novaButton.click(); }
  async editar(id) { await this.editarButton(id).click(); }

  async preencher({ nome, icone, ordem } = {}) {
    if (nome != null)  await this.nomeInput.fill(nome);
    if (icone != null) await this.iconeInput.fill(icone);
    if (ordem != null) await this.ordemInput.fill(String(ordem));
  }

  async salvar() { await this.salvarButton.click(); }

  /** `window.confirm` nativo (AdminCategorias.jsx) — sem listener, o Playwright o DESCARTA por
      padrão, e a exclusão nunca aconteceria (mesmo racional de AdminPedidosPage.cancelar). */
  async excluir(id) {
    this.page.once('dialog', (d) => d.accept());
    await this.excluirButton(id).click();
  }
}
