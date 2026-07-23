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

  /** O botão "+" do card e o clique no card em si chamam o MESMO onOpen (ProductCard.jsx) — nenhum
      dos dois adiciona direto ao carrinho; ambos abrem o ProductModal (ver ProductModal.page.js). */
  async openProduct(prodId) {
    await this.productCard(prodId).click();
  }

  get searchInput() {
    return this.page.getByLabel('Buscar na loja'); // aria-label já existe (SearchBar.jsx) — nada a adicionar
  }

  /** A busca só existe na barra sticky (StickyBar.jsx), que fica aria-hidden até "surgir ao rolar"
      (useStickyReveal). Rolar a página é o próprio fluxo real do usuário, não um atalho de teste. */
  async revelarBuscaSticky() {
    // espera o catálogo ter renderizado (altura da página estável) ANTES de rolar — senão a página
    // ainda está curta (Spinner) e o scrollTo(600) clampa aquém do limiar de revelação da sticky bar.
    await this.page.locator('[data-prod]').first().waitFor({ state: 'visible' });
    await this.page.evaluate(() => window.scrollTo(0, 600));
    await this.searchInput.waitFor({ state: 'visible' }); // espera, não afirma — a asserção fica no spec
  }

  async search(termo) {
    await this.searchInput.fill(termo);
  }

  get suggestionsListbox() {
    return this.page.getByRole('listbox', { name: 'Sugestões de busca' });
  }

  /** Dropdown "Categorias" do TOPO da página (StoreApp.jsx). Só é a única instância acessível
      ANTES de rolar — a cópia dentro da barra sticky (StickyBar.jsx) fica aria-hidden até "surgir
      ao rolar" (useStickyReveal); depois de rolar, as duas coexistem na árvore de acessibilidade
      (mesmo texto "Categorias"). Specs que precisarem reabrir o dropdown DEPOIS de rolar precisam
      escopar por `.enc-stickybar` para não colidir com esta instância. */
  get categoryMenuTrigger() {
    return this.page.getByRole('button', { name: 'Categorias' });
  }

  async selectCategory(nomeCategoria) {
    await this.categoryMenuTrigger.click();
    await this.page.getByRole('option', { name: nomeCategoria }).click();
  }

  get cartButton() {
    return this.page.getByTestId('header-cart-btn');
  }

  get cartBadge() {
    return this.cartButton.locator('.cart-badge');
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

  /** Abre a tela de login (StoreMenu.jsx: topo do drawer, SideDrawer.jsx). O rótulo visível varia com
      o estado (anônimo: "Entre ou cadastre-se"; logado: nome/e-mail do cliente, concatenados) — por
      isso o botão ganhou `aria-label="Login"` fixo (REF-E2E-02), igual ao padrão já usado no botão
      "Menu": nome estável independente do estado de login. `exact:true` evita colidir com o item de
      menu "👤 Minha Conta" (só visível quando logado, navega direto para MinhaContaScreen — tela
      diferente desta). */
  async abrirLogin() {
    await this.openMenu();
    await this.page.getByRole('button', { name: 'Login', exact: true }).click();
  }

  /** Select real com aria-label já existente (DeliveryBar.jsx) — nada a adicionar. "retirada" evita
      a spec de checkout precisar do fluxo de endereço/geocoding (fora do escopo desta Onda). */
  get deliveryModeSelect() {
    return this.page.getByLabel('Escolher entre entrega ou retirada');
  }

  async selecionarRetirada() {
    await this.deliveryModeSelect.selectOption('retirada');
  }
}
