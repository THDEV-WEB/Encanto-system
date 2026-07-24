/* e2e/pages/AdminProductsPage.page.js — REF-E2E-03 · Onda 4.
   Page Object da aba Products (src/components/admin/AdminProducts.jsx) — o formulário mais complexo
   do projeto (nome/descrição/preço/preço-promo/tamanhos dinâmicos/categoria principal+extras/ordem/
   badge/adicionais grátis/grupos de adicionais/imagem/disponível/destaque), nenhum campo com <label
   htmlFor>. Densidade de data-testid maior que qualquer outra tela da suíte (previsto na auditoria,
   ADR §1.5) — não por escolha, não há alternativa semântica sem reescrever o formulário inteiro
   (fora de escopo). Cada testid só existe porque um spec desta onda o usa. */
export class AdminProductsPage {
  constructor(page) { this.page = page; }

  get novoButton() { return this.page.getByRole('button', { name: '+ Novo' }); }
  row(id) { return this.page.locator(`[data-testid="prod-row-${id}"]`); }
  editarButton(id)      { return this.row(id).getByRole('button', { name: '✏️' }); }
  excluirButton(id)     { return this.row(id).getByRole('button', { name: '🗑' }); }
  /* `.toggle-switch input{opacity:0;width:0;height:0}` (index.css) — o <input> real nunca é "visível"
     para o Playwright; o alvo de clique de um usuário real é o `.toggle-slider` visível ao lado (o
     <label> pai associa os dois, clicar em qualquer um ativa o mesmo controle). Usar o <input> direto
     só para ASSERÇÕES (toBeChecked), nunca para `.click()`/`.check()` (trava esperando visibilidade). */
  disponivelToggleRow(id)         { return this.row(id).locator('input[type="checkbox"]'); }
  disponivelToggleRowClicavel(id) { return this.row(id).locator('.toggle-slider'); }

  async abrirNovo() { await this.novoButton.click(); }
  async editar(id) { await this.editarButton(id).click(); }
  async alternarDisponivelNaLista(id) { await this.disponivelToggleRowClicavel(id).click(); }

  async excluir(id) {
    this.page.once('dialog', (d) => d.accept());
    await this.excluirButton(id).click();
  }

  // ── Formulário (modal) ──────────────────────────────────────────────
  get nomeInput()        { return this.page.locator('[data-testid="prod-form-nome"]'); }
  get descricaoInput()   { return this.page.locator('[data-testid="prod-form-descricao"]'); }
  get precoInput()       { return this.page.locator('[data-testid="prod-form-preco"]'); }       // só existe sem tamanhos
  get precoPromoInput()  { return this.page.locator('[data-testid="prod-form-preco-promo"]'); } // idem
  get categoriaSelect()  { return this.page.locator('[data-testid="prod-form-categoria"]'); }
  get ordemInput()       { return this.page.locator('[data-testid="prod-form-ordem"]'); }
  get badgeSelect()      { return this.page.locator('[data-testid="prod-form-badge"]'); }
  get adicionaisGratisInput() { return this.page.locator('[data-testid="prod-form-adicionais-gratis"]'); }
  /* Mesmo racional do toggle da lista — <input> só para asserção, `.toggle-slider` p/ clicar. */
  get disponivelCheckbox()         { return this.page.locator('[data-testid="prod-form-disponivel"]'); }
  get disponivelToggleClicavel()   { return this.disponivelCheckbox.locator('xpath=following-sibling::span[1]'); }
  get destaqueCheckbox()           { return this.page.locator('[data-testid="prod-form-destaque"]'); }
  get destaqueToggleClicavel()     { return this.destaqueCheckbox.locator('xpath=following-sibling::span[1]'); }
  get erroMensagem()     { return this.page.locator('[data-testid="prod-form-erro"]'); }
  get salvarButton()     { return this.page.getByRole('button', { name: /Salvar produto/ }); }
  get cancelarButton()   { return this.page.getByRole('button', { name: 'Cancelar' }); }

  /* "Aparece também em" (multi-categoria) — toggle-buttons por nome de categoria. */
  categoriaExtraButton(nome) { return this.page.locator('[data-testid="prod-form-categorias-extra"]').getByRole('button', { name: nome, exact: true }); }
  async alternarCategoriaExtra(nome) { await this.categoriaExtraButton(nome).click(); }

  /* Grupos de adicionais disponíveis — toggle-buttons; o rótulo inclui emoji (ex.: "🍇 Adicionais Açaí"). */
  grupoAdButton(rotulo) { return this.page.locator('[data-testid="prod-form-grupos-ad"]').getByRole('button', { name: rotulo }); }
  async alternarGrupoAd(rotulo) { await this.grupoAdButton(rotulo).click(); }

  /* Tamanhos (array dinâmico) — escopado por índice (0-based, ordem de inserção nesta sessão do form). */
  get adicionarTamanhoButton() { return this.page.getByRole('button', { name: '+ Adicionar tamanho' }); }
  async adicionarTamanho() { await this.adicionarTamanhoButton.click(); }
  tamanhoLabelInput(i)      { return this.page.locator(`[data-testid="prod-tamanho-label-${i}"]`); }
  tamanhoPrecoInput(i)      { return this.page.locator(`[data-testid="prod-tamanho-preco-${i}"]`); }
  tamanhoAdicionaisInput(i) { return this.page.locator(`[data-testid="prod-tamanho-adicionais-${i}"]`); }
  tamanhoRemoverButton(i)   { return this.page.locator(`[data-testid="prod-tamanho-remover-${i}"]`); }
  async preencherTamanho(i, { label, preco, adicionaisGratis } = {}) {
    if (label != null) await this.tamanhoLabelInput(i).fill(label);
    if (preco != null) await this.tamanhoPrecoInput(i).fill(String(preco));
    if (adicionaisGratis != null) await this.tamanhoAdicionaisInput(i).fill(String(adicionaisGratis));
  }

  /* Imagem (ImageUploader.jsx). */
  get imagemArquivoInput() { return this.page.locator('[data-testid="img-uploader-arquivo"]'); }
  get imagemUrlInput()     { return this.page.locator('[data-testid="img-uploader-url"]'); }
  get imagemRemoverButton(){ return this.page.locator('[data-testid="img-uploader-remover"]'); }
  get imagemErro()         { return this.page.locator('[data-testid="img-uploader-erro"]'); }

  async preencher({ nome, descricao, preco, precoPromo, categoriaId, ordem, badge, adicionaisGratis } = {}) {
    if (nome != null)        await this.nomeInput.fill(nome);
    if (descricao != null)   await this.descricaoInput.fill(descricao);
    if (preco != null)       await this.precoInput.fill(String(preco));
    if (precoPromo != null)  await this.precoPromoInput.fill(String(precoPromo));
    if (categoriaId != null) await this.categoriaSelect.selectOption(categoriaId);
    if (ordem != null)       await this.ordemInput.fill(String(ordem));
    if (badge != null)       await this.badgeSelect.selectOption(badge);
    if (adicionaisGratis != null) await this.adicionaisGratisInput.fill(String(adicionaisGratis));
  }

  async salvar() { await this.salvarButton.click(); }
}
