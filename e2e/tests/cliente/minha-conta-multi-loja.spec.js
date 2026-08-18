/* e2e/tests/cliente/minha-conta-multi-loja.spec.js — REF-AUTH-TENANT-01-FIX-GET-MEUCUSTOMER.
   Prova em NAVEGADOR REAL (nao so leitura direta do banco) que getMeuCustomer() resolve o customer
   da loja CERTA quando a mesma pessoa tem customer legitimo em mais de uma loja (Encanto/Bar da Sogra
   E2E/Loja Inativa E2E, fixtures da Onda 4 de REF-AUTH-TENANT-01).

   Excecao justificada a "nunca mockar o Supabase de dados" (ver network-stubs.js): este ambiente de
   E2E so tem UM hostname real configurado (o de Encanto) -- nao ha como o Playwright navegar pra um
   dominio de verdade que resolva pra Bar da Sogra/Loja Inativa sem provisionar hosting adicional.
   get_store_by_domain() e resolucao de INFRAESTRUTURA (qual loja este dominio serve), nao dado de
   negocio (catalogo/pedidos) -- mockar so essa resposta, mantendo TUDO o resto real (login real, RPC
   real de getMeuCustomer, RLS real), e o unico jeito de exercitar o cenario multi-loja em navegador. */
import { test, expect } from '@playwright/test';
import { StorePage } from '../../pages/StorePage.js';
import { MinhaContaPage } from '../../pages/MinhaContaPage.page.js';
import { contextClienteFixture } from '../../support/authSession.js';
import { CLIENTE_FIXTURE } from '../../support/fixture-accounts.js';

const BAR_E2E_ID = '99999999-9999-4999-8999-999999999998';

async function mockGetStoreByDomain(page, storeRow) {
  await page.route('**/rest/v1/rpc/get_store_by_domain', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([storeRow]) })
  );
}

async function abrirMinhaContaComLojaMockada(browser, baseURL, storeRow) {
  const context = await contextClienteFixture(browser, baseURL);
  test.skip(!context, 'ambiente de E2E não configurado (.env.e2e)');
  const page = await context.newPage();
  await mockGetStoreByDomain(page, storeRow);
  const storePage = new StorePage(page);
  const minhaConta = new MinhaContaPage(page);
  await storePage.goto();
  await storePage.abrirMinhaConta();
  return { context, page, minhaConta };
}

test.describe('Minha Conta — múltiplos tenants (mesma pessoa, lojas diferentes)', { tag: '@writes' }, () => {
  test('loja resolvida = Bar da Sogra → mostra o customer da Bar, nunca o da Encanto/Inativa', async ({ browser, baseURL }) => {
    const { context, minhaConta } = await abrirMinhaContaComLojaMockada(browser, baseURL, {
      store_id: BAR_E2E_ID, slug: 'bar-da-sogra-e2e', nome: 'Bar da Sogra (fixture E2E)', status: 'ativo',
    });

    await expect(minhaConta.nomeInput).toHaveValue('Cliente E2E (Bar)');
    await expect(minhaConta.nomeInput).not.toHaveValue(CLIENTE_FIXTURE.nome);
    await expect(minhaConta.nomeInput).not.toHaveValue('Cliente E2E (Inativa)');

    await context.close();
  });

  test('loja resolvida = Encanto (mock explícito, mesmo valor do fallback) → continua mostrando o customer da Encanto', async ({ browser, baseURL }) => {
    const { context, minhaConta } = await abrirMinhaContaComLojaMockada(browser, baseURL, {
      store_id: 'be2efc10-c0c8-410f-bcd4-af3f8a371df3', slug: 'encanto', nome: 'Encanto — Açaí & Marmitas', status: 'ativo',
    });

    await expect(minhaConta.nomeInput).toHaveValue(CLIENTE_FIXTURE.nome);

    await context.close();
  });

  test('duas sessões reais simultâneas (mesma pessoa, ambas na Encanto) — cada aba resolve o próprio customer, sem contaminação cruzada', async ({ browser, baseURL }) => {
    const ctxA = await contextClienteFixture(browser, baseURL);
    const ctxB = await contextClienteFixture(browser, baseURL);
    test.skip(!ctxA || !ctxB, 'ambiente de E2E não configurado (.env.e2e)');

    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    const storeA = new StorePage(pageA);
    const storeB = new StorePage(pageB);
    const minhaContaA = new MinhaContaPage(pageA);
    const minhaContaB = new MinhaContaPage(pageB);

    await Promise.all([storeA.goto(), storeB.goto()]);
    await Promise.all([storeA.abrirMinhaConta(), storeB.abrirMinhaConta()]);

    await expect(minhaContaA.nomeInput).toHaveValue(CLIENTE_FIXTURE.nome);
    await expect(minhaContaB.nomeInput).toHaveValue(CLIENTE_FIXTURE.nome);

    await ctxA.close();
    await ctxB.close();
  });
});
