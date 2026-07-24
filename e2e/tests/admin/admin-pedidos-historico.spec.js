/* e2e/tests/admin/admin-pedidos-historico.spec.js — REF-E2E-03 · Onda 2 (@writes).
   PedidoHistorico.jsx é só leitura (order_events, gravado por TRIGGER de banco no INSERT/UPDATE de
   orders.status — trg_order_audit, nunca pelo front). Cria o pedido (gera o evento PEDIDO_CRIADO,
   status_novo='recebido') e avança 1 status pela própria UI (gera STATUS_ALTERADO,
   status_novo='preparo') — confirma que os 2 aparecem na trilha ao expandir o painel. */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { criarPedidoAvulso } from '../../support/fixture-order.js';
import { limparDadosDeTeste } from '../../support/cleanup.js';

test.describe('histórico de status do Pedido', { tag: '@writes' }, () => {
  test.afterEach(async () => { await limparDadosDeTeste(); });

  test('mostra os eventos reais de criação e mudança de status', async ({ adminLoginPage, adminPanel, adminPedidosPage, page }) => {
    const pedido = await criarPedidoAvulso();
    test.skip(pedido.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('pedidos');

    const card = adminPedidosPage.card(pedido.orderId);
    await adminPedidosPage.avancarStatus(pedido.orderId); // recebido -> preparo (2º evento na trilha)
    // aguarda o refresh (onChanged -> useOrders.load) assentar: enquanto `loading` é true, AdminPedidos
    // troca a lista inteira por <Spinner/>, desmontando e REMONTANDO o OrderCard — clicar em Histórico
    // antes disso corre risco real de o clique acontecer no card antigo, que está prestes a ser trocado.
    await expect(card.getByText('👨‍🍳 Em preparo')).toBeVisible();

    await adminPedidosPage.abrirHistorico(pedido.orderId);

    const historico = page.locator('[data-testid="pedido-historico"]');
    await expect(historico.getByText('Histórico de status')).toBeVisible();
    await expect(historico.getByText('Recebido', { exact: true })).toBeVisible();
    await expect(historico.getByText('Em preparo', { exact: true })).toBeVisible();
  });
});
