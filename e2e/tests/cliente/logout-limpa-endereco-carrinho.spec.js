/* e2e/tests/cliente/logout-limpa-endereco-carrinho.spec.js — REF-SEC-DATA-01 R12 (smoke test do fix).
   Achado da auditoria: sair() (AuthProvider.jsx) limpava customer/guest-identity mas nunca
   endereço/carrinho — dispositivo compartilhado herdava o endereço e carrinho completos do cliente
   anterior. Fix em StoreApp.jsx: efeito reage à TRANSIÇÃO real de sessão 'logged'->'anon' e só então
   chama limparEndereco()/cart.clear(). Este spec prova isso fim a fim, contra login/sessão REAIS
   (mesmo padrão de e2e/support/authSession.js usado pelos demais specs de cliente autenticado).

   Endereço: seedado DIRETO no localStorage (mesmo schema real de address/utils/addressModel.js
   montarEndereco — label/rua/numero/bairro/cidade/estado/cep/complemento/lat/lng/full/referencia), não
   via UI — não existe hoje em E2E um fluxo de busca de endereço automatizável (exigiria mockar
   geocoding completo, já coberto por outros testes: test:address-autocomplete-scenarios/
   test:address-search-guard). O que este spec verifica é a LIMPEZA no logout, não a busca em si.
   Carrinho: adicionado pela UI real (mesmo padrão de e2e/tests/cart/cart.spec.js). */
import { test, expect } from '@playwright/test';
import { StorePage } from '../../pages/StorePage.js';
import { ProductModalPage } from '../../pages/ProductModal.page.js';
import { contextClienteFixture } from '../../support/authSession.js';
import { garantirClienteFixtureVinculado } from '../../support/fixture-customer.js';
import { PROD_MARMITA_P } from '../../support/fixture-catalog.js';

const STORAGE_KEY_DELIVERY = 'encanto_delivery'; // literal de src/constants/storage.js (STORAGE_KEYS.DELIVERY)
const STORAGE_KEY_CART = 'encanto_cart';         // literal de src/constants/storage.js (STORAGE_KEYS.CART)

const ENDERECO_SEED = {
  label: 'Rua E2E Smoke, 123 - Bairro Teste',
  rua: 'Rua E2E Smoke', numero: '123', bairro: 'Bairro Teste', cidade: 'Cidade Teste', estado: 'TS',
  cep: '00000-000', complemento: '', lat: -23.5, lng: -46.6, full: '', referencia: '',
};

test.describe('logout limpa endereço e carrinho (REF-SEC-DATA-01 R12)', { tag: '@writes' }, () => {
  test.beforeAll(async () => { await garantirClienteFixtureVinculado(); });

  test('logout de cliente autenticado limpa endereço e carrinho salvos', async ({ browser, baseURL }) => {
    const context = await contextClienteFixture(browser, baseURL);
    test.skip(!context, 'ambiente de E2E não configurado (.env.e2e)');
    const page = await context.newPage();
    const storePage = new StorePage(page);
    const productModal = new ProductModalPage(page);

    await storePage.goto();

    // Seed do endereço + reload para AddressProvider ler no mount (lerPersistido só roda no useState inicial).
    await page.evaluate(({ key, endereco }) => localStorage.setItem(key, JSON.stringify(endereco)),
      { key: STORAGE_KEY_DELIVERY, endereco: ENDERECO_SEED });
    await page.reload();

    // confirma que o endereço seedado está realmente ativo ANTES do logout (senão o teste provaria nada)
    await expect(page.locator('.delivery-addr-current')).toHaveText(ENDERECO_SEED.label);

    // adiciona um item real ao carrinho (fluxo real da UI, mesmo padrão de cart.spec.js)
    await storePage.openProduct(PROD_MARMITA_P);
    await productModal.adicionar();
    await expect(storePage.cartBadge).toHaveText('1');

    // logout
    await storePage.openMenu();
    await page.getByRole('button', { name: /Sair/ }).click();

    // endereço some da UI (volta ao link "Selecionar endereço") e o carrinho zera
    await expect(page.getByText('Selecionar endereço')).toBeVisible();
    await expect(storePage.cartBadge).toHaveCount(0);

    // confirma tambem na fonte (localStorage), não só na tela
    const deliveryRaw = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY_DELIVERY);
    const cartRaw = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY_CART);
    expect(deliveryRaw).toBeNull();
    expect(JSON.parse(cartRaw ?? '{"items":[]}').items).toEqual([]);

    await context.close();
  });

  test('carrinho de visitante (nunca logado) não é afetado pela limpeza do logout', async ({ browser, baseURL }) => {
    // Sessão 100% anônima — nunca passa por status 'logged', então o efeito de limpeza (StoreApp.jsx)
    // nunca deveria disparar. Prova o lado oposto do fix: a correção do R12 não pode quebrar o
    // carrinho de quem nunca logou (dispositivo compartilhado só entre visitantes, ou 1ª visita real).
    const context = await browser.newContext();
    const page = await context.newPage();
    const storePage = new StorePage(page);
    const productModal = new ProductModalPage(page);

    await storePage.goto();
    await storePage.openProduct(PROD_MARMITA_P);
    await productModal.adicionar();
    await expect(storePage.cartBadge).toHaveText('1');

    await page.reload(); // simula nova navegação/aba — carrinho de convidado deve sobreviver
    await expect(storePage.cartBadge).toHaveText('1');

    await context.close();
  });
});
