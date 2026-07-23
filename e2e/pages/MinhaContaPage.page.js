/* e2e/pages/MinhaContaPage.page.js — REF-E2E-02 · Onda 3.
   Page Object da tela "Minha Conta" (src/components/conta/MinhaContaScreen.jsx), aberta via
   StorePage.abrirMinhaConta() (drawer -> "Minha Conta", só visível quando logado). Sem data-testid:
   os campos têm placeholder/role estáveis o bastante (nenhum outro elemento visível ao mesmo tempo
   colide com eles). Ganho arquitetural de um POM próprio: vários inputs/estados de salvamento,
   reusado por specs de edição de perfil e de e-mail. */
export class MinhaContaPage {
  constructor(page) { this.page = page; }

  get nomeInput()     { return this.page.getByPlaceholder('Seu nome'); }
  get telefoneInput() { return this.page.getByPlaceholder('(38) 99999-9999'); }
  get salvarPerfilButton() { return this.page.getByRole('button', { name: 'Salvar alterações' }); }

  get novoEmailInput()   { return this.page.getByPlaceholder('novo@email.com'); }
  get enviarEmailButton() { return this.page.getByRole('button', { name: 'Enviar confirmação' }); }

  /** Preenche só os campos informados (undefined preserva o valor atual) e salva. */
  async editarPerfil({ nome, telefone } = {}) {
    if (nome !== undefined) await this.nomeInput.fill(nome);
    if (telefone !== undefined) await this.telefoneInput.fill(telefone);
    await this.salvarPerfilButton.click();
  }

  async solicitarTrocaEmail(novoEmail) {
    await this.novoEmailInput.fill(novoEmail);
    await this.enviarEmailButton.click();
  }
}
