/* e2e/pages/LoginModal.page.js — REF-E2E-01. Page Object da tela de login
   (src/components/menu/LoginScreen.jsx), aberta via StoreMenu (☰). Os dígitos do código OTP já têm
   aria-label="Dígito {n}" (nada a adicionar); os 4 CTAs (Google/e-mail/enviar/confirmar) hoje só têm
   texto — TODO(REF-E2E-01 · Onda auth): promover a data-testid junto do commit da spec de mecânica de
   login (login-google-btn/login-email-btn/login-send-code-btn/login-confirm-code-btn). */
export class LoginModalPage {
  constructor(page) { this.page = page; }

  get googleButton()      { return this.page.locator('[data-testid="login-google-btn"]'); }
  get emailButton()        { return this.page.locator('[data-testid="login-email-btn"]'); }
  get emailInput()         { return this.page.getByPlaceholder('seu@email.com'); } // já estável hoje (LoginScreen.jsx)
  get sendCodeButton()     { return this.page.locator('[data-testid="login-send-code-btn"]'); }
  get confirmCodeButton()  { return this.page.locator('[data-testid="login-confirm-code-btn"]'); }
  get erroMensagem()       { return this.page.getByText(/Não foi possível continuar|Código inválido|Digite/); }

  digitoInput(indice1a6) {
    return this.page.getByLabel(`Dígito ${indice1a6}`); // já existe hoje — CodigoInput em LoginScreen.jsx
  }

  async preencherCodigo(codigo) {
    const digitos = String(codigo).split('');
    for (let i = 0; i < digitos.length; i++) await this.digitoInput(i + 1).fill(digitos[i]);
  }

  async entrarComEmail(email) {
    await this.emailButton.click();
    await this.emailInput.fill(email);
    await this.sendCodeButton.click();
  }
}
