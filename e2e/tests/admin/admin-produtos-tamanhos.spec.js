/* e2e/tests/admin/admin-produtos-tamanhos.spec.js — REF-E2E-03 · Onda 4 (@writes).
   Editor de tamanhos (PRICE-DOMAIN-01) do formulário de Produtos: produto COM tamanhos oculta
   preço/preço-promo do topo (fonte única do preço vira `tamanhos[]`); ao salvar, `preco` é
   sincronizado com o MENOR tamanho e `preco_promo` é zerado (regra 10 do PRICE-DOMAIN-01) — o banco
   nunca guarda um preço divergente/oculto. Valida label vazio, preço inválido e nomes duplicados. */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { CAT_MONTE } from '../../support/fixture-catalog.js';
import { supabaseAdmin, E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';
import { limparCatalogoDeTeste } from '../../support/fixture-catalog-admin.js';

const NOME_PROD = 'E2E_TEST_ProdutoComTamanhos';

test.describe('Produtos com tamanhos (PRICE-DOMAIN-01)', { tag: '@writes' }, () => {
  test.afterEach(async () => { await limparCatalogoDeTeste(); });

  test('cria com 2 tamanhos: preço do produto sincroniza com o MENOR tamanho', async ({ adminLoginPage, adminPanel, adminProductsPage, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('products');

    await adminProductsPage.abrirNovo();
    await adminProductsPage.preencher({ nome: NOME_PROD, categoriaId: CAT_MONTE });
    await expect(adminProductsPage.precoInput).toBeVisible(); // ainda produto simples

    await adminProductsPage.adicionarTamanho();
    await adminProductsPage.preencherTamanho(0, { label: '300 ml', preco: 18 });
    await expect(adminProductsPage.precoInput).toHaveCount(0); // campo Preço some ao ganhar tamanhos

    await adminProductsPage.adicionarTamanho();
    await adminProductsPage.preencherTamanho(1, { label: '500 ml', preco: 24 });
    await adminProductsPage.salvar();
    await expect(page.getByText(NOME_PROD)).toBeVisible();

    const admin = supabaseAdmin();
    const { data: criado } = await admin.from('products').select('preco,preco_promo,tamanhos').eq('nome', NOME_PROD).single();
    expect(Number(criado.preco)).toBe(18); // menor tamanho
    expect(criado.preco_promo).toBeNull();
    expect(criado.tamanhos).toHaveLength(2);
  });

  test('validação: label vazio, preço inválido e tamanhos duplicados bloqueiam o salvamento', async ({ adminLoginPage, adminPanel, adminProductsPage }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('products');

    await adminProductsPage.abrirNovo();
    await adminProductsPage.preencher({ nome: 'E2E_TEST_ValidacaoTamanhos', categoriaId: CAT_MONTE });

    await adminProductsPage.adicionarTamanho();
    await adminProductsPage.salvar(); // label vazio
    await expect(adminProductsPage.erroMensagem).toContainText('precisa de um nome/volume');

    await adminProductsPage.preencherTamanho(0, { label: '300 ml', preco: 0 });
    await adminProductsPage.salvar(); // preço inválido (0)
    await expect(adminProductsPage.erroMensagem).toContainText('Preço inválido');

    await adminProductsPage.preencherTamanho(0, { preco: 18 });
    await adminProductsPage.adicionarTamanho();
    await adminProductsPage.preencherTamanho(1, { label: '300 ml', preco: 20 }); // mesmo nome do tamanho 0
    await adminProductsPage.salvar();
    await expect(adminProductsPage.erroMensagem).toContainText('mesmo nome/volume');

    await adminProductsPage.cancelarButton.click();
  });

  test('remover o único tamanho volta ao modo produto simples (campo Preço reaparece)', async ({ adminLoginPage, adminPanel, adminProductsPage }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('products');

    await adminProductsPage.abrirNovo();
    await adminProductsPage.adicionarTamanho();
    await expect(adminProductsPage.precoInput).toHaveCount(0);

    await adminProductsPage.tamanhoRemoverButton(0).click();
    await expect(adminProductsPage.precoInput).toBeVisible();

    await adminProductsPage.cancelarButton.click();
  });
});
