/* e2e/tests/admin/admin-pedidos-lista.spec.js — REF-E2E-03 · Onda 2 (@writes).
   Ao contrário do Dashboard (achado da auditoria: cliente_nome/cliente_telefone nunca existem no
   retorno de DS.getPedidos), o card de Pedidos usa `order.customers?.name`/`phone` — a forma REAL do
   select aninhado — então aqui dá para provar que os dados do card refletem o pedido real criado no
   backend (cliente, total, tipo), não um placeholder. */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { criarPedidoAvulso } from '../../support/fixture-order.js';
import { limparDadosDeTeste } from '../../support/cleanup.js';

test.describe('lista de Pedidos — dados refletem o backend', { tag: '@writes' }, () => {
  test.afterEach(async () => { await limparDadosDeTeste(); });

  test('card mostra cliente, total e tipo do pedido real', async ({ adminLoginPage, adminPanel, adminPedidosPage }) => {
    const pedido = await criarPedidoAvulso();
    test.skip(pedido.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('pedidos');

    const card = adminPedidosPage.card(pedido.orderId);
    await expect(card).toBeVisible();
    await expect(card.getByText('E2E_TEST_Avulso')).toBeVisible();
    await expect(card).toContainText(/R\$\s*12,50/);
    await expect(card.getByText('🏪 Retirada')).toBeVisible();
  });
});
