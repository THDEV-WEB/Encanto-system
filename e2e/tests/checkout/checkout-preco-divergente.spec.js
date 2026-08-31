/* e2e/tests/checkout/checkout-preco-divergente.spec.js — REF-CART-PRICE-DRIFT-01 (@writes).
   Prova end-to-end: o preço do produto muda no catálogo (simula edição no Admin) enquanto o item já
   está no carrinho do cliente (localStorage sobrevive a um reload) — ao chegar no checkout, o aviso
   de preço atualizado aparece, SEM bloquear o envio (create_order()/_resolve_item_pricing() sempre
   recalculam com autoridade — isto é só transparência client-side, ver src/utils/orderPayload.js
   buildPrecoDivergenteView). Produto de teste ISOLADO (PREFIXO_TESTE), nunca reusa/muda preço do
   catálogo fixture compartilhado (outros specs @writes rodam em paralelo e dependem de preços fixos
   do fixture — mudar um deles no meio da suíte seria flaky). */
import { test, expect } from '../../fixtures/index.js';
import { supabaseAdmin } from '../../support/supabaseAdmin.js';
import { limparCatalogoDeTeste } from '../../support/fixture-catalog-admin.js';
import { PREFIXO_TESTE } from '../../support/cleanup.js';
import { CAT_MARMITAS } from '../../support/fixture-catalog.js';
import { randomUUID } from 'node:crypto';

test.describe('checkout — aviso de preço divergente no carrinho (REF-CART-PRICE-DRIFT-01)', { tag: '@writes' }, () => {
  test.afterEach(async () => {
    await limparCatalogoDeTeste();
  });

  test('preço do item mudou desde que foi adicionado -> banner aparece, submit continua liberado', async ({ storePage, productModal, cartSidebar, checkoutPage, page }) => {
    const produtoId = randomUUID();
    const admin = supabaseAdmin();
    const { error } = await admin.from('products').insert({
      id: produtoId, nome: `${PREFIXO_TESTE}Preco Divergente`, preco: 20.00,
      categoria_id: CAT_MARMITAS, disponivel: true, adicionais_gratis: 0,
    });
    if (error) throw new Error(`[e2e] setup produto: ${error.message}`);

    await storePage.goto();
    await storePage.selecionarRetirada();
    await storePage.openProduct(produtoId);
    await productModal.adicionar();

    // simula o Admin mudando o preço enquanto o cliente já tem o item congelado no carrinho.
    const { error: errUpd } = await admin.from('products').update({ preco: 25.00 }).eq('id', produtoId);
    if (errUpd) throw new Error(`[e2e] update preco: ${errUpd.message}`);

    // nova carga de página: StoreApp busca o catálogo de novo (produtosVivos fresco), o carrinho
    // (localStorage) sobrevive ao reload com o preço antigo — exatamente o cenário do banner.
    await storePage.goto();
    await storePage.selecionarRetirada();
    await storePage.openCart();
    await cartSidebar.goToCheckout();

    const banner = page.getByTestId('checkout-preco-divergente');
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner).toContainText('R$ 20,00');
    await expect(banner).toContainText('R$ 25,00');
    // não bloqueia — servidor recalcula com autoridade de qualquer forma.
    await expect(checkoutPage.submitButton).toBeEnabled({ timeout: 15_000 });
  });

  test('preço não mudou -> banner não aparece', async ({ storePage, productModal, cartSidebar, checkoutPage, page }) => {
    const produtoId = randomUUID();
    const admin = supabaseAdmin();
    const { error } = await admin.from('products').insert({
      id: produtoId, nome: `${PREFIXO_TESTE}Preco Estavel`, preco: 20.00,
      categoria_id: CAT_MARMITAS, disponivel: true, adicionais_gratis: 0,
    });
    if (error) throw new Error(`[e2e] setup produto: ${error.message}`);

    await storePage.goto();
    await storePage.selecionarRetirada();
    await storePage.openProduct(produtoId);
    await productModal.adicionar();
    await storePage.openCart();
    await cartSidebar.goToCheckout();

    await expect(checkoutPage.submitButton).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByTestId('checkout-preco-divergente')).not.toBeVisible();
  });
});
