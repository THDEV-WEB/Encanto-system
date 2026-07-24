/* e2e/tests/admin/admin-produtos-crud.spec.js — REF-E2E-03 · Onda 4 (@writes).
   CRUD básico de Produtos (produto SIMPLES, sem tamanhos): criar, editar, alternar disponibilidade na
   lista, excluir, validação (nome vazio, preço vazio). `DS.upsertProd` usa `throwOnError:true` (ao
   contrário de `upsertCat`/`upsertAd`, Onda 3) — erros reais chegam a `saveErr` de verdade, não são
   descartados. */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { CAT_MARMITAS } from '../../support/fixture-catalog.js';
import { supabaseAdmin, E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';
import { limparCatalogoDeTeste } from '../../support/fixture-catalog-admin.js';

const NOME_PROD = 'E2E_TEST_ProdutoSimples';
const NOME_PROD_EDITADO = 'E2E_TEST_ProdutoEditado';

test.describe('CRUD de Produtos (produto simples)', { tag: '@writes' }, () => {
  test.afterEach(async () => { await limparCatalogoDeTeste(); });

  test('cria, edita, alterna disponibilidade e exclui', async ({ adminLoginPage, adminPanel, adminProductsPage, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('products');

    await adminProductsPage.abrirNovo();
    await adminProductsPage.preencher({ nome: NOME_PROD, preco: 21.5, categoriaId: CAT_MARMITAS });
    await adminProductsPage.salvar();
    await expect(page.getByText(NOME_PROD)).toBeVisible();

    const admin = supabaseAdmin();
    const { data: criado } = await admin.from('products').select('id').eq('nome', NOME_PROD).single();
    const row = adminProductsPage.row(criado.id);

    await expect(row).toContainText(/R\$\s*21,50/);
    await expect(row.locator('input[type="checkbox"]')).toBeChecked(); // disponivel=true por padrão

    await adminProductsPage.editar(criado.id);
    await adminProductsPage.preencher({ nome: NOME_PROD_EDITADO, preco: 25 });
    await adminProductsPage.salvar();
    await expect(row).toContainText(NOME_PROD_EDITADO);
    await expect(row).toContainText(/R\$\s*25,00/);

    await adminProductsPage.alternarDisponivelNaLista(criado.id);
    await expect(row.locator('input[type="checkbox"]')).not.toBeChecked();
    const { data: apos } = await admin.from('products').select('disponivel').eq('id', criado.id).single();
    expect(apos.disponivel).toBe(false);

    await adminProductsPage.excluir(criado.id);
    await expect(page.getByText(NOME_PROD_EDITADO)).toHaveCount(0);
  });

  test('validação: nome vazio e preço vazio bloqueiam o salvamento com mensagem específica', async ({ adminLoginPage, adminPanel, adminProductsPage }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('products');

    await adminProductsPage.abrirNovo();
    await adminProductsPage.salvar();
    await expect(adminProductsPage.erroMensagem).toContainText('Nome é obrigatório.');

    await adminProductsPage.preencher({ nome: 'E2E_TEST_SemPreco' });
    await adminProductsPage.salvar();
    await expect(adminProductsPage.erroMensagem).toContainText('Preço é obrigatório.');
    await expect(adminProductsPage.nomeInput).toBeVisible(); // modal continua aberto

    await adminProductsPage.cancelarButton.click();
  });
});
