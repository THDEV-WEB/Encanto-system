/* e2e/tests/checkout/checkout-guest.spec.js — REF-E2E-01 · Onda 4 (@writes).
   PRIMEIRA onda que precisa do projeto Supabase DEDICADO a E2E (docs/adr/REF-E2E-01-auditoria-playwright.md).
   Catálogo fixo (e2e/support/seed-catalog.sql, aplicado via `node scripts/e2e-seed.mjs`) — produto sem
   tamanhos/variantes obrigatórias, mesmo motivo das Ondas 3. Modo "retirada" evita depender do fluxo
   de endereço/geocoding (fora do escopo desta Onda). Cada teste força o status oficial da loja
   (support/storeMode.js) em vez de depender do relógio real — anti-flaky. Teardown sempre limpa os
   dados criados (support/cleanup.js), mesmo quando o teste não chega a criar pedido nenhum. */
import { test, expect } from '../../fixtures/index.js';
import { forcarStoreMode } from '../../support/storeMode.js';
import { limparDadosDeTeste, PREFIXO_TESTE } from '../../support/cleanup.js';
import { PROD_MARMITA_P as PRODUTO_FIXTURE_ID } from '../../support/fixture-catalog.js';

function telefoneUnico() {
  return '479' + String(Date.now()).slice(-8); // DDD + 8 dígitos = 11 (>= mínimo exigido no checkout)
}

test.describe('checkout guest', { tag: '@writes' }, () => {
  // store_mode é um único registro GLOBAL no banco (settings), compartilhado por toda a suíte —
  // rodar "OPEN" e "CLOSED" em paralelo (workers diferentes) faz um teste pisar no outro. Serializa
  // só este describe (não afeta o paralelismo dos specs @read-only, que não tocam store_mode).
  test.describe.configure({ mode: 'serial' });

  test.afterEach(async () => {
    await limparDadosDeTeste();
  });

  test.afterAll(async () => {
    await forcarStoreMode('OPEN'); // não deixa o ambiente compartilhado travado em CLOSED
  });

  test('guest finaliza um pedido de retirada com sucesso', async ({ storePage, productModal, cartSidebar, checkoutPage, page }) => {
    await forcarStoreMode('OPEN');
    await storePage.goto();
    await storePage.selecionarRetirada();
    await storePage.openProduct(PRODUTO_FIXTURE_ID);
    await productModal.adicionar();
    await storePage.openCart();
    await cartSidebar.goToCheckout();

    // 1º frame de useBusinessHours pinta pela AGENDA real (sem cache local em contexto novo) e só
    // reconcilia com o modo OFICIAL (forçado OPEN acima) após o round-trip assíncrono ao Supabase —
    // se agora for fora do expediente real, o botão nasce desabilitado até essa reconciliação.
    await expect(checkoutPage.submitButton).toBeEnabled({ timeout: 15_000 });
    await checkoutPage.preencher({ nome: `${PREFIXO_TESTE}Guest`, telefone: telefoneUnico() });
    await checkoutPage.finalizar();

    await expect(page.getByRole('heading', { name: /sucesso/i })).toBeVisible();
  });

  test('loja fechada bloqueia o checkout (gate de horário)', async ({ storePage, productModal, cartSidebar, checkoutPage, page }) => {
    await forcarStoreMode('CLOSED');
    await storePage.goto(); // useBusinessHours lê o modo oficial no mount — nada de esperar o polling de 30s
    await storePage.selecionarRetirada();
    await storePage.openProduct(PRODUTO_FIXTURE_ID);
    await productModal.adicionar();
    await storePage.openCart();
    await cartSidebar.goToCheckout();

    // useBusinessHours pinta o 1º frame com o cache local (pode ser AUTO/agenda real, ainda "aberto")
    // e só reconcilia com o modo OFICIAL (CLOSED) após o round-trip assíncrono ao Supabase — dá mais
    // margem que o timeout padrão para essa reconciliação acontecer (não é sleep arbitrário: é
    // retry-até-verdadeiro do próprio Playwright, só com teto maior). 15s bastava localmente, mas
    // falhou 3x seguidas (incl. 2 retries) num run do CI (runner mais lento/latência maior até o
    // Supabase) — achado no REF-CI-01 (ver docs/ref/REF-CI-01-progress.md). 30s dá margem sem mascarar
    // uma reconciliação real que nunca acontece (o retry-até-verdadeiro do Playwright falha do mesmo
    // jeito se o modo nunca virar CLOSED, só que mais tarde).
    await expect(checkoutPage.submitButton).toBeDisabled({ timeout: 30_000 });
    await expect(page.getByText('Você pode montar seu pedido e finalizar quando reabrirmos.')).toBeVisible();
  });
});
