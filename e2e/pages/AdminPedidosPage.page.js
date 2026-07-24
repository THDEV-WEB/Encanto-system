/* e2e/pages/AdminPedidosPage.page.js — REF-E2E-03 · Onda 2.
   Page Object da aba Pedidos (src/components/admin/AdminPedidos.jsx) — quadro de cards (OrderCard),
   não tabela. Cada card leva `data-testid="pedido-card-{order.id}"` (único ajuste de produção desta
   onda em AdminPedidos.jsx) — o número sequencial exibido (#N) é POSIÇÃO na lista, não estável entre
   reloads (achado da auditoria, ADR §1.4), então todo locator aqui é escopado por `orderId` (conhecido
   pelos specs via fixture-order.js), nunca por posição/número. Os botões de ação já são <button> reais
   com texto estável — sem necessidade de mais data-testid. Histórico/Mensagens (PedidoHistorico.jsx/
   PedidoNotificacoes.jsx) renderizam DENTRO do próprio card ao expandir — os locators de conteúdo
   também ficam aqui, escopados ao card, em vez de um Page Object à parte (não há ganho arquitetural
   nisso: são 2 painéis pequenos, só leitura, sem estado próprio de navegação). */
export class AdminPedidosPage {
  constructor(page) { this.page = page; }

  card(orderId) { return this.page.locator(`[data-testid="pedido-card-${orderId}"]`); }

  get atualizarButton() { return this.page.getByRole('button', { name: /Atualizar/ }); }

  avancarButton(orderId)   { return this.card(orderId).getByRole('button', { name: /Avançar/ }); }
  cancelarButton(orderId)  { return this.card(orderId).getByRole('button', { name: 'Cancelar' }); }
  reabrirButton(orderId)   { return this.card(orderId).getByRole('button', { name: 'Reabrir' }); }
  comandaButton(orderId)   { return this.card(orderId).getByRole('button', { name: /Comanda/ }); }
  historicoButton(orderId) { return this.card(orderId).getByRole('button', { name: /Histórico/ }); }
  mensagensButton(orderId) { return this.card(orderId).getByRole('button', { name: /Mensagens/ }); }

  async avancarStatus(orderId) { await this.avancarButton(orderId).click(); }
  async abrirHistorico(orderId) { await this.historicoButton(orderId).click(); }
  async abrirMensagens(orderId) { await this.mensagensButton(orderId).click(); }
  async abrirComanda(orderId) { await this.comandaButton(orderId).click(); }
  async reabrir(orderId) { await this.reabrirButton(orderId).click(); }

  /** `window.confirm` nativo (AdminPedidos.jsx) — sem um listener de `dialog`, o Playwright o
      DESCARTA por padrão (equivalente a clicar "Cancelar" no confirm), então `mudar('cancelado')`
      nunca rodaria. Registra o accept ANTES do clique. */
  async cancelar(orderId) {
    this.page.once('dialog', (d) => d.accept());
    await this.cancelarButton(orderId).click();
  }

  // ── Comanda (ComandaModal.jsx) ──────────────────────────────────────────────
  get comandaDialog()        { return this.page.getByRole('dialog', { name: 'Comanda do pedido' }); }
  get comandaFrame()         { return this.page.frameLocator('iframe[title="Pré-visualização da comanda"]'); }
  paperButton(largura)       { return this.comandaDialog.getByRole('button', { name: largura, exact: true }); } // '80mm' | '58mm'
  get comandaFecharButton()  { return this.comandaDialog.getByRole('button', { name: 'Fechar' }); }
  get comandaImprimirButton(){ return this.comandaDialog.getByRole('button', { name: /Imprimir/ }); }
  async fecharComanda() { await this.comandaFecharButton.click(); }
}
