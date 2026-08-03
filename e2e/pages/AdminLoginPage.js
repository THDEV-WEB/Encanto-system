/* e2e/pages/AdminLoginPage.js — REF-E2E-01 (esboço) · completado na REF-E2E-03 · Onda 1 · getters da
   tela de confirmação de sessão adicionados na REF-UX-SESSION-01 · Onda 2 · REF-ADMIN-04 · Onda 5
   (goto() aponta pro bundle próprio do admin, não mais pelo hash dentro da loja).
   Page Object do login do Admin (src/components/admin/AdminLogin.jsx). Labels existem mas SEM
   htmlFor/id associado (getByLabel não funciona) — por isso os campos + mensagens usam data-testid
   (admin-login-*, únicos ajustes de produção destas ondas além das abas do AdminPanel). O botão do
   formulário de credencial usa getByRole por texto estável ("Entrar"/"Entrando..."), sem testid próprio.

   REF-UX-SESSION-01: quando "Entrar" encontra uma sessão reaproveitável, a tela de confirmação
   substitui o formulário (mesmo card) — usar continuarButton/usarOutraContaButton nesse caso, nunca
   submitButton de novo (ele só existe no formulário de credencial). */
export class AdminLoginPage {
  constructor(page) { this.page = page; }

  /* REF-ADMIN-04: o admin é um bundle próprio (admin.html/AdminApp.jsx), sem StoreApp/mode-switch —
     em produção vive em admin.encanto.valionsistemas.com.br; no E2E, o MESMO dev server (`vite --mode
     e2e`) já serve admin.html em dev (rollupOptions.input só restringe `vite build`), sob o mesmo
     `base:'/encanto/'` da loja — daí o path completo abaixo. */
  async goto() { await this.page.goto('/encanto/admin.html'); }

  get emailInput()  { return this.page.locator('[data-testid="admin-login-email"]'); }
  get senhaInput()  { return this.page.locator('[data-testid="admin-login-senha"]'); }
  get submitButton(){ return this.page.getByRole('button', { name: /Entrar/ }); } // texto estável hoje
  get erroMensagem(){ return this.page.locator('[data-testid="admin-login-erro"]'); }

  // REF-UX-SESSION-01: tela de confirmação de sessão reaproveitada.
  get sessaoEncontrada()      { return this.page.locator('[data-testid="admin-login-sessao-encontrada"]'); }
  get continuarButton()       { return this.page.locator('[data-testid="admin-login-continuar"]'); }
  get usarOutraContaButton()  { return this.page.locator('[data-testid="admin-login-usar-outra-conta"]'); }

  async login(email, senha) {
    await this.emailInput.fill(email);
    await this.senhaInput.fill(senha);
    await this.submitButton.click();
  }

  // REF-UX-SESSION-01: clica "Entrar" numa sessão reaproveitável e confirma a tela de continuação —
  // substitui o antigo "1 clique entra direto" nos specs que testam reaproveitamento de sessão.
  async entrarReaproveitandoSessao() {
    await this.submitButton.click();
    await this.continuarButton.click();
  }
}
