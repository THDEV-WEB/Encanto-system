/* e2e/fixtures/index.js — REF-E2E-01. Estende o `test` do Playwright injetando os Page Objects
   prontos em todo spec (import { test, expect } from '../fixtures/index.js' em vez de
   '@playwright/test' diretamente) — evita `new StorePage(page)` repetido em cada arquivo.

   Helpers que precisam do projeto Supabase de E2E (forcarStoreMode, sessaoClienteFixture,
   limparDadosDeTeste — ver e2e/support/) NÃO viram fixture aqui de propósito: enquanto esse ambiente
   não existir, nenhuma spec deveria depender deles no `beforeEach`/`beforeAll` de todo teste (isso
   faria specs read-only pularem sem necessidade). Specs `@writes` os importam diretamente de
   e2e/support/*.js quando essa Onda começar. */
import { test as base, expect } from '@playwright/test';
import { StorePage } from '../pages/StorePage.js';
import { ProductModalPage } from '../pages/ProductModal.page.js';
import { CartSidebarPage } from '../pages/CartSidebar.page.js';
import { CheckoutPagePO } from '../pages/CheckoutPage.page.js';
import { LoginModalPage } from '../pages/LoginModal.page.js';
import { AdminLoginPage } from '../pages/AdminLoginPage.js';
import { AdminPanelPage } from '../pages/AdminPanel.page.js';
import { AdminPedidosPage } from '../pages/AdminPedidosPage.page.js';
import { AdminCategoriasPage } from '../pages/AdminCategoriasPage.page.js';
import { AdminAdicionaisPage } from '../pages/AdminAdicionaisPage.page.js';
import { AdminProductsPage } from '../pages/AdminProductsPage.page.js';
import { AdminFidelidadePage } from '../pages/AdminFidelidadePage.page.js';
import { mockViaCep, mockNominatim } from '../support/network-stubs.js';

export const test = base.extend({
  storePage:      async ({ page }, use) => { await use(new StorePage(page)); },
  productModal:   async ({ page }, use) => { await use(new ProductModalPage(page)); },
  cartSidebar:    async ({ page }, use) => { await use(new CartSidebarPage(page)); },
  checkoutPage:   async ({ page }, use) => { await use(new CheckoutPagePO(page)); },
  loginModal:     async ({ page }, use) => { await use(new LoginModalPage(page)); },
  adminLoginPage: async ({ page }, use) => { await use(new AdminLoginPage(page)); },
  adminPanel:     async ({ page }, use) => { await use(new AdminPanelPage(page)); },
  adminPedidosPage: async ({ page }, use) => { await use(new AdminPedidosPage(page)); },
  adminCategoriasPage: async ({ page }, use) => { await use(new AdminCategoriasPage(page)); },
  adminAdicionaisPage: async ({ page }, use) => { await use(new AdminAdicionaisPage(page)); },
  adminProductsPage: async ({ page }, use) => { await use(new AdminProductsPage(page)); },
  adminFidelidadePage: async ({ page }, use) => { await use(new AdminFidelidadePage(page)); },

  /** Injete em specs que abrem a busca de endereço — intercepta ViaCEP/Nominatim com respostas
      fixas (e2e/support/network-stubs.js), sem depender de rede externa real. Disponível hoje. */
  enderecoMockado: async ({ page }, use) => {
    await mockViaCep(page);
    await mockNominatim(page);
    await use(true);
  },
});

export { expect };
