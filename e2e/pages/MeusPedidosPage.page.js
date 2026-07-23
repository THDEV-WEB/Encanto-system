/* e2e/pages/MeusPedidosPage.page.js — REF-E2E-02 · Onda 4.
   Page Object da tela "Meus Pedidos" (src/components/pedidos/MeusPedidosScreen.jsx +
   PedidoCard.jsx). O card inteiro (número/status/data/resumo/"ver acompanhamento"/total) é UM único
   `<button aria-expanded>` — sem `data-testid` (nome acessível concatenado, mas único o bastante via
   regex por não haver 2 pedidos simultâneos nos specs desta REF). Ganho arquitetural de um POM
   próprio: expandir/timeline/itens/recompra são reusados por múltiplos specs (Meus Pedidos, Fidelidade
   depois de um pedido). */
export class MeusPedidosPage {
  constructor(page) { this.page = page; }

  get vazio() { return this.page.getByText(/Você ainda não fez pedidos/); }

  get pedidoToggle() { return this.page.getByRole('button', { name: /ver acompanhamento|ocultar acompanhamento/ }); }

  get recomprarButton() { return this.page.getByRole('button', { name: /Pedir novamente/ }); }

  async expandirPrimeiroPedido() {
    await this.pedidoToggle.first().click();
  }
}
