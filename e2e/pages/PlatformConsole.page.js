/* e2e/pages/PlatformConsole.page.js — REF-SAAS-02 · Onda 1.
   Page Object do Platform Console (src/components/admin/PlatformConsole.jsx) -- console separado da
   VALION SISTEMAS, onde um super admin pousa apos o login (ver AdminApp.jsx/AdminAuthedShell). Distinto
   de AdminPanel.page.js (Admin de UMA loja): testids com prefixo "platform-" (nao "admin-"), nunca se
   sobrepoe. */
const TABS = ['dashboard', 'lojas'];

export class PlatformConsolePage {
  constructor(page) { this.page = page; }

  get titulo() { return this.page.locator('[data-testid="platform-console-titulo"]'); }
  get logoutButton() { return this.page.locator('[data-testid="platform-logout"]'); }

  tab(id) {
    if (!TABS.includes(id)) throw new Error(`[e2e] aba do Platform Console desconhecida: ${id}`);
    return this.page.locator(`[data-testid="platform-tab-${id}"]`);
  }

  async abrirAba(id) { await this.tab(id).click(); }
  async logout() { await this.logoutButton.click(); }

  // --- Lojas / provisionamento ---
  async preencherNovaLoja({ nome, slug, emailAdmin, telefone, whatsapp, emailContato }) {
    await this.page.getByTestId('plataforma-nova-nome').fill(nome);
    if (slug) await this.page.getByTestId('plataforma-nova-slug').fill(slug);
    if (emailAdmin) await this.page.getByTestId('plataforma-nova-email').fill(emailAdmin);
    if (telefone) await this.page.getByTestId('plataforma-nova-telefone').fill(telefone);
    if (whatsapp) await this.page.getByTestId('plataforma-nova-whatsapp').fill(whatsapp);
    if (emailContato) await this.page.getByTestId('plataforma-nova-contato-email').fill(emailContato);
  }

  async criarLoja() { await this.page.getByTestId('plataforma-nova-criar').click(); }

  linhaLoja(slug) { return this.page.locator(`[data-testid="plataforma-linha-${slug}"]`); }
  statusLoja(slug) { return this.page.locator(`[data-testid="plataforma-status-${slug}"]`); }

  async abrirDetalhe(slug) { await this.page.getByTestId(`plataforma-ver-detalhe-${slug}`).click(); }

  async vincularAdmin(slug, email) {
    await this.page.getByTestId(`plataforma-vincular-email-${slug}`).fill(email);
    await this.page.getByTestId(`plataforma-vincular-btn-${slug}`).click();
  }

  async abrirAdminDaLoja(slug) { await this.page.getByTestId(`plataforma-abrir-admin-lista-${slug}`).click(); }

  async suspenderLoja(slug) {
    this.page.once('dialog', (d) => d.accept());
    await this.page.getByTestId(`plataforma-suspender-${slug}`).click();
  }
  async reativarLoja(slug) {
    this.page.once('dialog', (d) => d.accept());
    await this.page.getByTestId(`plataforma-ativar-${slug}`).click();
  }
}
