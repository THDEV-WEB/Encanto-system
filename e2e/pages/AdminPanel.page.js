/* e2e/pages/AdminPanel.page.js — REF-E2E-01. Page Object do painel Admin
   (src/components/admin/AdminPanel.jsx). As abas são hoje <div onClick> sem role/aria-label —
   TODO(REF-E2E-01 · Onda admin): promover cada uma a data-testid="admin-tab-{id}" no commit da
   1ª spec de Admin (ver tabela de seletores na auditoria). O botão "← Ver loja" é um <button> real
   com texto estável — usável hoje via getByRole. */
const TABS = ['dashboard', 'pedidos', 'products', 'categorias', 'adicionais', 'status', 'fidelidade', 'saude'];

export class AdminPanelPage {
  constructor(page) { this.page = page; }

  tab(id) {
    if (!TABS.includes(id)) throw new Error(`[e2e] aba de Admin desconhecida: ${id}`);
    return this.page.locator(`[data-testid="admin-tab-${id}"]`);
  }

  async abrirAba(id) { await this.tab(id).click(); }

  get sairButton() { return this.page.getByRole('button', { name: /Ver loja/ }); }

  async sair() { await this.sairButton.click(); }
}
