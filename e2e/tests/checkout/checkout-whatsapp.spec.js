/* e2e/tests/checkout/checkout-whatsapp.spec.js — REF-CHECKOUT-02/03 (@writes).
   Cobre o fluxo obrigatório de confirmação via WhatsApp: abertura automática (sem escolha do
   cliente), mensagem completa em layout comercial (reaproveitada de buildComanda/comandaTexto,
   REF-CHECKOUT-03), e a tela de contingência quando window.open() é bloqueado. Mesmo fixture/infra
   dos demais specs de checkout (retirada evita o fluxo de endereço/geocoding, fora do escopo aqui —
   ver StorePage.js). */
import { test, expect } from '../../fixtures/index.js';
import { forcarStoreMode } from '../../support/storeMode.js';
import { limparDadosDeTeste, PREFIXO_TESTE } from '../../support/cleanup.js';
import { PROD_MARMITA_P as PRODUTO_FIXTURE_ID } from '../../support/fixture-catalog.js';
import { StorePage } from '../../pages/StorePage.js';
import { ProductModalPage } from '../../pages/ProductModal.page.js';
import { CartSidebarPage } from '../../pages/CartSidebar.page.js';
import { CheckoutPagePO } from '../../pages/CheckoutPage.page.js';

function telefoneUnico() {
  return '479' + String(Date.now()).slice(-8);
}

async function montarPedido({ storePage, productModal, cartSidebar, checkoutPage }) {
  await storePage.goto();
  await storePage.selecionarRetirada();
  await storePage.openProduct(PRODUTO_FIXTURE_ID);
  await productModal.adicionar();
  await storePage.openCart();
  await cartSidebar.goToCheckout();
  await expect(checkoutPage.submitButton).toBeEnabled({ timeout: 15_000 });
}

test.describe('checkout — confirmação automática via WhatsApp (REF-CHECKOUT-02)', { tag: '@writes' }, () => {
  test.describe.configure({ mode: 'serial' }); // store_mode é GLOBAL, mesmo motivo dos demais specs de checkout

  test.afterEach(async () => {
    await limparDadosDeTeste();
  });

  test.afterAll(async () => {
    await forcarStoreMode('OPEN');
  });

  test('WhatsApp abre automaticamente, sem clique do cliente, com a mensagem completa do pedido', async ({ storePage, productModal, cartSidebar, checkoutPage, page }) => {
    await forcarStoreMode('OPEN');
    await montarPedido({ storePage, productModal, cartSidebar, checkoutPage });

    const nome = `${PREFIXO_TESTE}WppAuto`;
    const telefone = telefoneUnico();
    await checkoutPage.preencher({ nome, telefone, obs: 'Sem cebola por favor' });

    // A abertura acontece dentro de um efeito, sem nenhum clique adicional do cliente além de
    // "Finalizar Pedido" — captura o popup em paralelo com o clique que persiste o pedido.
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      checkoutPage.finalizar(),
    ]);

    await expect(page.getByRole('heading', { name: /sucesso/i })).toBeVisible();

    // wa.me redireciona de fato para api.whatsapp.com (comportamento real, não mockado) — o Chromium
    // segue o redirect antes de expor popup.url(); aceitar ambos prova que o link funciona ponta a ponta.
    const url = popup.url();
    expect(url).toMatch(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//);
    const texto = decodeURIComponent(new URL(url).searchParams.get('text') || '');

    // Conteúdo obrigatório (REF-CHECKOUT-03): cabeçalho comercial, nº do pedido (5 dígitos, sem
    // hash/UUID), cliente/telefone, itens, total, "Cobrar do cliente" (quem lê é a loja) — mesma
    // estrutura da comanda do Admin (buildComanda/comandaTexto contexto:'cliente').
    // REF-LGPD-01 R09 (minimização de PII, comandaTexto.js): a mensagem automática do WhatsApp NUNCA
    // inclui a observação geral livre do pedido nem o endereço completo — só ficam disponíveis para a
    // loja via Admin (comandaTextoInterna/comandaHtml.js). A observação abaixo é preenchida de propósito
    // ('Sem cebola por favor') para provar, por comportamento, que ela é capturada no checkout mas NUNCA
    // vaza para a mensagem que trafega em texto claro na URL do wa.me.
    expect(texto.startsWith('*RETIRADA*')).toBe(true);
    expect(texto).toMatch(/\*Pedido \d{5}\*/);
    expect(texto).toContain(nome);
    expect(texto).toContain(telefone);
    expect(texto).not.toContain('Sem cebola por favor');
    expect(texto).not.toContain('OBSERVAÇÕES');
    expect(texto).toContain('Subtotal');
    expect(texto).toContain('TOTAL');
    expect(texto).toContain('*Cobrar do cliente*');
    expect(texto).toContain('Troco: Não precisa');
    expect(texto).not.toContain('Ref. cliente'); // código técnico sem utilidade pro próprio cliente

    await popup.close();
  });

  test('popup bloqueado → tela de contingência → botão manual reabre o WhatsApp com sucesso', async ({ browser, baseURL }) => {
    await forcarStoreMode('OPEN');
    const context = await browser.newContext({ baseURL });
    // Simula popup-blocker: a 1ª chamada (automática, fora de um gesto direto) falha; a 2ª (clique
    // manual no botão da tela de contingência, gesto direto) sempre funciona — exatamente o
    // contrato real dos navegadores que motivou a tela de contingência.
    await context.addInitScript(() => {
      let chamadas = 0;
      window.open = () => { chamadas += 1; return chamadas === 1 ? null : { closed: false }; };
    });

    const page = await context.newPage();
    const storePage = new StorePage(page);
    const productModal = new ProductModalPage(page);
    const cartSidebar = new CartSidebarPage(page);
    const checkoutPage = new CheckoutPagePO(page);

    await montarPedido({ storePage, productModal, cartSidebar, checkoutPage });
    await checkoutPage.preencher({ nome: `${PREFIXO_TESTE}WppFalha`, telefone: telefoneUnico() });
    await checkoutPage.finalizar();

    // Pedido já foi salvo (não é isso que falhou) — só a abertura automática foi bloqueada.
    await expect(page.getByText('Não foi possível abrir automaticamente o WhatsApp.')).toBeVisible();
    const botaoReabrir = page.getByRole('button', { name: /abrir whatsapp novamente/i });
    await expect(botaoReabrir).toBeVisible();

    await botaoReabrir.click(); // gesto direto → 2ª chamada do mock → sucesso
    await expect(page.getByRole('heading', { name: /sucesso/i })).toBeVisible();
    await expect(page.getByText('Não foi possível abrir automaticamente o WhatsApp.')).not.toBeVisible();

    await context.close();
  });
});
