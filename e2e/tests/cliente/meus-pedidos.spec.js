/* e2e/tests/cliente/meus-pedidos.spec.js — REF-E2E-02 · Onda 3 (estado vazio) + Onda 4 (pedido real).
   Área "Meus Pedidos" (MeusPedidosScreen.jsx) do cliente autenticado. Serializado num único describe
   (não 2 arquivos/describes independentes): os 2 cenários mutam a MESMA coleção de pedidos do
   fixture com expectativas opostas (vazio vs. 1 pedido) — rodar em paralelo correria o risco de um
   teste ver o estado do outro a meio caminho (mesmo achado de concorrência da auditoria REF-E2E-02
   §Riscos). O pedido do 2º teste é criado via support/fixture-order.js (RPC create_order direta,
   sem passar pela UI) — o fluxo de checkout em si já é coberto por checkout-logado.spec.js; aqui o
   que importa é só a LEITURA (lista/timeline/itens). */
import { test, expect } from '@playwright/test';
import { StorePage } from '../../pages/StorePage.js';
import { MeusPedidosPage } from '../../pages/MeusPedidosPage.page.js';
import { contextClienteFixture } from '../../support/authSession.js';
import { garantirClienteFixtureVinculado } from '../../support/fixture-customer.js';
import { criarPedidoFixture } from '../../support/fixture-order.js';
import { limparPedidosDoFixture } from '../../support/cleanup.js';

async function abrirMeusPedidos(browser, baseURL) {
  const context = await contextClienteFixture(browser, baseURL);
  test.skip(!context, 'ambiente de E2E não configurado (.env.e2e)');
  const page = await context.newPage();
  const storePage = new StorePage(page);
  const meusPedidos = new MeusPedidosPage(page);
  await storePage.goto();
  await storePage.abrirMeusPedidos();
  return { context, page, meusPedidos };
}

test.describe('Meus Pedidos', { tag: '@writes' }, () => {
  test.describe.configure({ mode: 'serial' }); // mesma coleção de pedidos do fixture, expectativas opostas entre os 2 testes

  test.beforeAll(async () => {
    await garantirClienteFixtureVinculado();
    await limparPedidosDoFixture(); // garante 0 pedidos no início, mesmo se uma run anterior tiver falhado no meio
  });
  test.afterEach(async () => { await limparPedidosDoFixture(); }); // devolve o fixture a "0 pedidos" para a próxima run/spec

  test('sem pedidos ainda mostra o estado vazio', async ({ browser, baseURL }) => {
    const { context, meusPedidos } = await abrirMeusPedidos(browser, baseURL);
    await expect(meusPedidos.vazio).toBeVisible();
    await context.close();
  });

  test('com um pedido real, aparece na lista e expande timeline/itens', async ({ browser, baseURL }) => {
    await criarPedidoFixture();
    const { context, page, meusPedidos } = await abrirMeusPedidos(browser, baseURL);

    await expect(meusPedidos.vazio).toBeHidden();
    await meusPedidos.expandirPrimeiroPedido();

    // "1× Marmita P" aparece 2x (resumo sempre visível do card + detalhe do PedidoItens expandido) — .first() basta
    await expect(page.getByText('1× Marmita P').first()).toBeVisible();
    await expect(page.getByText('Recebido').first()).toBeVisible();   // PedidoTimeline (status inicial)

    await context.close();
  });
});
