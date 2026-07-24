/* e2e/pages/AdminLoginPage.js — REF-E2E-01 (esboço) · completado na REF-E2E-03 · Onda 1.
   Page Object do login do Admin (src/components/admin/AdminLogin.jsx). Labels existem mas SEM
   htmlFor/id associado (getByLabel não funciona) — por isso os 2 campos + a mensagem de erro usam
   data-testid (admin-login-email/admin-login-senha/admin-login-erro, únicos ajustes de produção
   desta Onda além das abas do AdminPanel). O botão usa getByRole por texto estável ("Entrar"/
   "Entrando..."), sem precisar de testid próprio. */
export class AdminLoginPage {
  constructor(page) { this.page = page; }

  async goto() { await this.page.goto('/#admin-encanto'); }

  get emailInput()  { return this.page.locator('[data-testid="admin-login-email"]'); }
  get senhaInput()  { return this.page.locator('[data-testid="admin-login-senha"]'); }
  get submitButton(){ return this.page.getByRole('button', { name: /Entrar/ }); } // texto estável hoje
  get erroMensagem(){ return this.page.locator('[data-testid="admin-login-erro"]'); }

  async login(email, senha) {
    await this.emailInput.fill(email);
    await this.senhaInput.fill(senha);
    await this.submitButton.click();
  }
}
