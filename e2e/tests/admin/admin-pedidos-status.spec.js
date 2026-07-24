/* e2e/tests/admin/admin-pedidos-status.spec.js — REF-E2E-03 · Onda 2 (@writes).
   Prova a fonte real (pedidoStatus.js FLUXO_ENTREGA/FLUXO_RETIRADA) fiada de ponta a ponta pela UI:
   retirada NÃO passa por "Saiu para entrega" (pula de Pronto direto p/ Entregue); entrega passa. O
   guard de domínio (test:order-status) já tranca proximoStatus() isoladamente — aqui o valor agregado
   é provar que o CLIQUE real (RPC DS.setStatus + refresh) usa esse mesmo mapeamento, ponta a ponta
   contra o backend. Cancelar/reabrir também é testado aqui (mesma tela, mesmo domínio). */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { criarPedidoAvulso } from '../../support/fixture-order.js';
import { limparDadosDeTeste } from '../../support/cleanup.js';

const ENDERECO_ENTREGA = 'Rua Fixture de Teste, 123 - Centro, Timbó/SC - E2E';

test.describe('trilha de status dos Pedidos', { tag: '@writes' }, () => {
  test.afterEach(async () => { await limparDadosDeTeste(); });

  test('retirada pula "Saiu para entrega" e conclui em 3 avanços', async ({ adminLoginPage, adminPanel, adminPedidosPage }) => {
    const pedido = await criarPedidoAvulso();
    test.skip(pedido.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('pedidos');

    const card = adminPedidosPage.card(pedido.orderId);
    await expect(card.getByText('Saiu para entrega', { exact: true })).toHaveCount(0); // fluxo de retirada não tem esse passo
    await expect(card.getByText('📥 Recebido')).toBeVisible();

    await adminPedidosPage.avancarStatus(pedido.orderId);
    await expect(card.getByText('👨‍🍳 Em preparo')).toBeVisible();
    await adminPedidosPage.avancarStatus(pedido.orderId);
    await expect(card.getByText('🛎️ Pronto')).toBeVisible();
    await adminPedidosPage.avancarStatus(pedido.orderId);
    await expect(card.getByText('✅ Entregue')).toBeVisible();
    await expect(card.getByText('✅ Pedido concluído')).toBeVisible();
    await expect(adminPedidosPage.avancarButton(pedido.orderId)).toHaveCount(0);
  });

  test('entrega passa por "Saiu para entrega" antes de concluir em 4 avanços', async ({ adminLoginPage, adminPanel, adminPedidosPage }) => {
    const pedido = await criarPedidoAvulso({ endereco: ENDERECO_ENTREGA });
    test.skip(pedido.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('pedidos');

    const card = adminPedidosPage.card(pedido.orderId);
    await expect(card.getByText('Saiu para entrega', { exact: true })).toBeVisible(); // chip do fluxo (badge ainda mostra Recebido)

    await adminPedidosPage.avancarStatus(pedido.orderId);
    await expect(card.getByText('👨‍🍳 Em preparo')).toBeVisible();
    await adminPedidosPage.avancarStatus(pedido.orderId);
    await expect(card.getByText('🛎️ Pronto')).toBeVisible();
    await adminPedidosPage.avancarStatus(pedido.orderId);
    await expect(card.getByText('🛵 Saiu para entrega')).toBeVisible();
    await adminPedidosPage.avancarStatus(pedido.orderId);
    await expect(card.getByText('✅ Entregue')).toBeVisible();
    await expect(adminPedidosPage.avancarButton(pedido.orderId)).toHaveCount(0);
  });

  test('cancelar e reabrir devolve o pedido ao início da trilha', async ({ adminLoginPage, adminPanel, adminPedidosPage }) => {
    const pedido = await criarPedidoAvulso();
    test.skip(pedido.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('pedidos');

    const card = adminPedidosPage.card(pedido.orderId);
    await adminPedidosPage.cancelar(pedido.orderId);

    await expect(card.getByText('✖️ Cancelado')).toBeVisible();
    await expect(adminPedidosPage.reabrirButton(pedido.orderId)).toBeVisible();
    await expect(adminPedidosPage.cancelarButton(pedido.orderId)).toHaveCount(0);

    await adminPedidosPage.reabrir(pedido.orderId);

    await expect(card.getByText('📥 Recebido')).toBeVisible();
    await expect(adminPedidosPage.avancarButton(pedido.orderId)).toBeVisible();
  });
});
