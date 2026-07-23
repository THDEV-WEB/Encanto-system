/* e2e/tests/cliente/meus-pedidos.spec.js — REF-E2E-02 · Onda 3, parte 1 (@writes).
   Área "Meus Pedidos" (MeusPedidosScreen.jsx) do cliente autenticado, ainda SEM nenhum pedido —
   estado vazio. A parte com pedido real (lista/timeline/itens) entra na Onda 4, junto do checkout
   logado (precisa de 1 pedido de verdade para existir — ver auditoria REF-E2E-02). */
import { test, expect } from '@playwright/test';
import { StorePage } from '../../pages/StorePage.js';
import { contextClienteFixture } from '../../support/authSession.js';
import { garantirClienteFixtureVinculado } from '../../support/fixture-customer.js';
import { limparPedidosDoFixture } from '../../support/cleanup.js';

test.describe('Meus Pedidos (estado vazio)', { tag: '@writes' }, () => {
  test.beforeAll(async () => {
    await garantirClienteFixtureVinculado();
    await limparPedidosDoFixture(); // garante 0 pedidos p/ este cenário, mesmo se uma run anterior tiver falhado no meio
  });

  test('sem pedidos ainda mostra o estado vazio', async ({ browser, baseURL }) => {
    const context = await contextClienteFixture(browser, baseURL);
    test.skip(!context, 'ambiente de E2E não configurado (.env.e2e)');

    const page = await context.newPage();
    const storePage = new StorePage(page);
    await storePage.goto();
    await storePage.abrirMeusPedidos();

    await expect(page.getByText(/Você ainda não fez pedidos/)).toBeVisible();

    await context.close();
  });
});
