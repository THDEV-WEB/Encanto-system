/* e2e/pages/AdminLoginPage.js — REF-E2E-01. Page Object do login do Admin
   (src/components/admin/AdminLogin.jsx). Labels existem mas SEM htmlFor/id associado (getByLabel não
   funciona) — TODO(REF-E2E-01 · Onda admin, BLOQUEADA pela conta de admin de teste — ver auditoria):
   promover para data-testid (admin-login-email/admin-login-senha/admin-login-submit) no commit da
   1ª spec de Admin. */
export class AdminLoginPage {
  constructor(page) { this.page = page; }

  async goto() { await this.page.goto('/#admin-encanto'); }

  get emailInput()  { return this.page.locator('[data-testid="admin-login-email"]'); }
  get senhaInput()  { return this.page.locator('[data-testid="admin-login-senha"]'); }
  get submitButton(){ return this.page.getByRole('button', { name: /Entrar/ }); } // texto estável hoje
  get erroMensagem(){ return this.page.locator('.admin-login-card p[style*="red"]'); } // TODO: sem data-testid dedicado

  async login(email, senha) {
    await this.emailInput.fill(email);
    await this.senhaInput.fill(senha);
    await this.submitButton.click();
  }
}
