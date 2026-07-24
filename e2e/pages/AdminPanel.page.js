/* e2e/pages/AdminPanel.page.js — REF-E2E-01 (esboço) · completado na REF-E2E-03 · Onda 1.
   Page Object do painel Admin (src/components/admin/AdminPanel.jsx). As abas são <div onClick> sem
   role/aria-label — promovidas a data-testid="admin-tab-{id}" (único ajuste de produção desta REF
   além dos data-testid do login). O botão "← Ver loja" é um <button> real com texto estável — usável
   via getByRole; é o mesmo handler `onExit` do item "Sair" da sidebar (um <div>, sem role), então
   testar um cobre o outro — não duplicamos seletor/teste para o segundo. */
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
