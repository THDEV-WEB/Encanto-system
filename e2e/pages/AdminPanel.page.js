/* e2e/pages/AdminPanel.page.js — REF-E2E-01 (esboço) · completado na REF-E2E-03 · Onda 1 · ajustado
   na REF-ADMIN-01 · Onda 2 (sessão do Admin).
   Page Object do painel Admin (src/components/admin/AdminPanel.jsx). As abas são <div onClick> sem
   role/aria-label — promovidas a data-testid="admin-tab-{id}" (único ajuste de produção da REF-E2E-03
   além dos data-testid do login). Até a REF-ADMIN-01, "← Ver loja" (botão) e "Sair" (div da sidebar)
   chamavam o MESMO handler `onExit` — testar um cobria o outro. A Onda 2 separou os dois: "Ver loja"
   agora só troca de tela (sessão do Supabase permanece válida); "Sair" chama db.auth.signOut() de
   verdade. A sidebar "Sair" ganhou `data-testid="admin-logout"` (era um <div> sem role nenhum). */
const TABS = ['dashboard', 'pedidos', 'products', 'categorias', 'adicionais', 'status', 'fidelidade', 'saude'];

export class AdminPanelPage {
  constructor(page) { this.page = page; }

  tab(id) {
    if (!TABS.includes(id)) throw new Error(`[e2e] aba de Admin desconhecida: ${id}`);
    return this.page.locator(`[data-testid="admin-tab-${id}"]`);
  }

  async abrirAba(id) { await this.tab(id).click(); }

  get verLojaButton() { return this.page.getByRole('button', { name: /Ver loja/ }); }
  get logoutButton()  { return this.page.locator('[data-testid="admin-logout"]'); }

  async verLoja() { await this.verLojaButton.click(); }
  async logout()  { await this.logoutButton.click(); }
}
