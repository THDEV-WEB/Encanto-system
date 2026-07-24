/* e2e/tests/admin/admin-pedidos-comanda.spec.js — REF-E2E-03 · Onda 2 (@writes).
   ComandaModal.jsx: preview WYSIWYG (iframe srcDoc) + seletor de largura (80mm/58mm) + "Imprimir/
   Reimprimir". printComanda.js chama window.print() no contentWindow de um 2º iframe (oculto, criado
   só na hora de imprimir, distinto do de preview) — não há diálogo de SO em modo headless, então a
   garantia testável é que o clique DISPARA window.print() (ADR §1.4), não o resultado físico. Usa um
   init script que sobrescreve window.print em TODO documento/frame (Playwright aplica addInitScript a
   frames futuros também, inclusive o iframe de impressão criado depois do clique). O conteúdo
   detalhado da comanda (itens/totais/endereço) já é golden test de domínio (tests/comanda.golden.mjs)
   — aqui só confirma que o modal abriu para o PEDIDO CERTO. */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { criarPedidoAvulso } from '../../support/fixture-order.js';
import { limparDadosDeTeste } from '../../support/cleanup.js';

async function habilitarContadorDePrint(page) {
  await page.addInitScript(() => {
    const alvo = window.top || window;
    if (typeof alvo.__ENC_PRINT_CALLS__ !== 'number') alvo.__ENC_PRINT_CALLS__ = 0;
    const original = window.print;
    window.print = function (...args) {
      alvo.__ENC_PRINT_CALLS__ += 1;
      if (original) return original.apply(window, args);
    };
  });
}

test.describe('comanda do Pedido', { tag: '@writes' }, () => {
  test.afterEach(async () => { await limparDadosDeTeste(); });

  test('abre para o pedido certo, troca de largura e o botão Imprimir dispara window.print', async ({ adminLoginPage, adminPanel, adminPedidosPage, page }) => {
    const pedido = await criarPedidoAvulso();
    test.skip(pedido.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    await habilitarContadorDePrint(page);
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('pedidos');
    await adminPedidosPage.abrirComanda(pedido.orderId);

    await expect(adminPedidosPage.comandaDialog).toBeVisible();
    await expect(adminPedidosPage.comandaFrame.getByText('E2E_TEST_Avulso')).toBeVisible();
    await expect(adminPedidosPage.comandaFrame.getByText('RETIRADA')).toBeVisible();

    await adminPedidosPage.paperButton('58mm').click();
    await expect(adminPedidosPage.comandaDialog).toBeVisible(); // troca de largura não derruba o modal
    await adminPedidosPage.paperButton('80mm').click();

    await adminPedidosPage.comandaImprimirButton.click();
    await expect.poll(() => page.evaluate(() => window.__ENC_PRINT_CALLS__ || 0)).toBeGreaterThan(0);

    await adminPedidosPage.fecharComanda();
    await expect(adminPedidosPage.comandaDialog).toBeHidden();
  });
});
