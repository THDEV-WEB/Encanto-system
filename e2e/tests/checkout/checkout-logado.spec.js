/* e2e/tests/checkout/checkout-logado.spec.js — REF-E2E-02 · Onda 4 (@writes).
   Checkout do cliente AUTENTICADO: nome/telefone pré-preenchidos do customer (telefone TRAVADO —
   identidade, ver CheckoutPage.jsx `identidadeTravada`), pedido concluído, e o vínculo pedido↔conta
   verificado por QUERY DIRETA (não só pela UI) — create_order associa por TELEFONE (nunca por
   auth_user_id), então confirmar `orders.customer_id === customer.id` do fixture prova o vínculo
   real, não uma suposição da tela. Serial + cleanup: store_mode é GLOBAL (mesmo achado da
   REF-E2E-01 Onda 4); limparPedidosDoFixture nunca apaga a linha customers do fixture. */
import { test, expect } from '../../fixtures/index.js';
import { StorePage } from '../../pages/StorePage.js';
import { ProductModalPage } from '../../pages/ProductModal.page.js';
import { CartSidebarPage } from '../../pages/CartSidebar.page.js';
import { CheckoutPagePO } from '../../pages/CheckoutPage.page.js';
import { contextClienteFixture } from '../../support/authSession.js';
import { garantirClienteFixtureVinculado } from '../../support/fixture-customer.js';
import { forcarStoreMode } from '../../support/storeMode.js';
import { limparPedidosDoFixture } from '../../support/cleanup.js';
import { supabaseAdmin } from '../../support/supabaseAdmin.js';
import { CLIENTE_FIXTURE } from '../../support/fixture-accounts.js';
import { PROD_MARMITA_P as PRODUTO_FIXTURE_ID } from '../../support/fixture-catalog.js';

test.describe('checkout logado', { tag: '@writes' }, () => {
  test.describe.configure({ mode: 'serial' }); // store_mode é GLOBAL — evita corrida com outros describes que o forçam

  test.beforeAll(async () => { await garantirClienteFixtureVinculado(); });
  test.afterEach(async () => { await limparPedidosDoFixture(); });
  test.afterAll(async () => { await forcarStoreMode('OPEN'); }); // não deixa o ambiente travado em CLOSED

  test('nome pré-preenchido, telefone travado, pedido concluído e vinculado à conta', async ({ browser, baseURL }) => {
    await forcarStoreMode('OPEN');
    const context = await contextClienteFixture(browser, baseURL);
    test.skip(!context, 'ambiente de E2E não configurado (.env.e2e)');

    const page = await context.newPage();
    const storePage = new StorePage(page);
    const productModal = new ProductModalPage(page);
    const cartSidebar = new CartSidebarPage(page);
    const checkoutPage = new CheckoutPagePO(page);

    await storePage.goto();
    await storePage.selecionarRetirada();
    await storePage.openProduct(PRODUTO_FIXTURE_ID);
    await productModal.adicionar();
    await storePage.openCart();
    await cartSidebar.goToCheckout();

    // Identidade travada: telefone vem do customer logado e não pode ser editado.
    await expect(checkoutPage.nomeInput).toHaveValue(CLIENTE_FIXTURE.nome);
    await expect(checkoutPage.telefoneInput).toHaveValue(CLIENTE_FIXTURE.telefone);
    await expect(checkoutPage.telefoneInput).toBeDisabled();

    await expect(checkoutPage.submitButton).toBeEnabled({ timeout: 15_000 });
    await checkoutPage.finalizar();
    await expect(page.getByRole('heading', { name: /sucesso/i })).toBeVisible();

    // Prova real do vínculo — não a UI, a linha em orders/customers do backend.
    const admin = supabaseAdmin();
    const { data: cliente } = await admin.from('customers').select('id').eq('phone', CLIENTE_FIXTURE.telefone).single();
    const { data: pedidos } = await admin.from('orders').select('id,customer_id').order('created_at', { ascending: false }).limit(1);
    expect(pedidos?.[0]?.customer_id).toBe(cliente.id);

    await context.close();
  });
});
