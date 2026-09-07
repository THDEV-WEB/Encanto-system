/* e2e/tests/store/back-button.spec.js — REF-UX-BACKBUTTON-01 (@read-only).
   Reproduz exatamente o bug relatado pelo dono (2026-09-07): no navegador/PWA (fora do Capacitor,
   ver hooks/useCapacitorBackButton.js), abrir um produto ou o carrinho e apertar "voltar" saía do
   site inteiro em vez de fechar a camada aberta. page.goBack() do Playwright dispara o MESMO evento
   'popstate' que o botão físico do Android dispara num navegador real — teste fiel ao mecanismo
   real (hooks/useBrowserBackClose.js), não só à lógica pura (ver tests/browserBackClose.golden.mjs). */
import { test, expect } from '../../fixtures/index.js';
import { PROD_MARMITA_P } from '../../support/fixture-catalog.js';

test.describe('botão voltar do navegador fecha overlays', { tag: '@read-only' }, () => {
  test.beforeEach(async ({ storePage }) => { await storePage.goto(); });

  test('produto aberto + voltar fecha o modal e permanece na loja (não sai do site)', async ({ storePage, productModal, page }) => {
    await storePage.openProduct(PROD_MARMITA_P);
    await expect(productModal.root).toBeVisible();

    await page.goBack();

    await expect(productModal.root).toBeHidden();
    // Continua na mesma loja -- a URL não mudou para fora do app (prova que não "saiu" do site).
    await expect(page).toHaveURL(/\/encanto\/?$/);
  });

  test('carrinho aberto + voltar fecha o carrinho e permanece na loja', async ({ storePage, productModal, cartSidebar, page }) => {
    await storePage.openProduct(PROD_MARMITA_P);
    await productModal.adicionar();
    await storePage.openCart();
    await expect(cartSidebar.root).toBeVisible();

    await page.goBack();

    await expect(cartSidebar.root).toBeHidden();
    await expect(page).toHaveURL(/\/encanto\/?$/);
  });

  test('fechar o produto pelo "X" consome a entrada de histórico (voltar depois não reabre o modal "fantasma")', async ({ storePage, productModal, page }) => {
    await storePage.openProduct(PROD_MARMITA_P);
    await expect(productModal.root).toBeVisible();
    await productModal.closeButton.click();
    await expect(productModal.root).toBeHidden();

    // Nada aberto agora -- a entrada de histórico empurrada ao abrir o modal precisa ter sido
    // consumida no fechamento pelo "X" (useBrowserBackClose). Se tivesse sobrado uma entrada
    // "fantasma", "voltar" aqui reabriria o modal em vez de continuar navegando para fora da loja.
    await page.goBack();
    await expect(productModal.root).toBeHidden();
  });

  // Camadas aninhadas (2+ overlays abertos simultaneamente) não são alcançáveis nesta UI a partir
  // do catálogo (o overlay escurecido do carrinho bloqueia clique em outro produto por baixo, por
  // desenho) — essa lógica (fechar 1 camada por vez, na ordem certa) já está coberta pela função
  // pura em tests/browserBackClose.golden.mjs (cenários de profundidade 2 -> 1 -> 0).
});
