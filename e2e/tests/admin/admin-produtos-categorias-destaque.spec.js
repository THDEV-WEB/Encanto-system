/* e2e/tests/admin/admin-produtos-categorias-destaque.spec.js — REF-E2E-03 · Onda 4 (@writes).
   Multi-categoria (REF-ADMIN-CATALOG-01): "aparece também em" + o toggle "⭐ Destaque" compõem
   `categoria_ids` (fonte única) — Destaque é SEMPRE vitrine, nunca categoria principal (o próprio
   guard admin-catalog.guard.mjs já tranca essa regra em isolamento; aqui prova-se a composição real
   feita pela UI, ponta a ponta contra o backend). Cobre também `ordem` de exibição. */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { CAT_MARMITAS, CAT_BEBIDAS, CAT_DESTAQUES } from '../../support/fixture-catalog.js';
import { supabaseAdmin, E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';
import { limparCatalogoDeTeste } from '../../support/fixture-catalog-admin.js';

const NOME_PROD = 'E2E_TEST_ProdutoMultiCategoria';

test.describe('Produtos — multi-categoria, destaque e ordem', { tag: '@writes' }, () => {
  test.afterEach(async () => { await limparCatalogoDeTeste(); });

  test('marcar "aparece também em" + Destaque compõe categoria_ids corretamente', async ({ adminLoginPage, adminPanel, adminProductsPage, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('products');

    await adminProductsPage.abrirNovo();
    await adminProductsPage.preencher({ nome: NOME_PROD, preco: 30, categoriaId: CAT_MARMITAS, ordem: 5 });
    await adminProductsPage.alternarCategoriaExtra('Bebidas');
    await adminProductsPage.destaqueToggleClicavel.click();
    await adminProductsPage.salvar();
    await expect(page.getByText(NOME_PROD)).toBeVisible();

    const admin = supabaseAdmin();
    const { data: criado } = await admin.from('products').select('id,categoria_id,categoria_ids,destaque,ordem').eq('nome', NOME_PROD).single();
    expect(criado.categoria_id).toBe(CAT_MARMITAS); // principal preservada (Destaques nunca é principal)
    expect(criado.destaque).toBe(true);
    expect(criado.ordem).toBe(5);
    expect(new Set(criado.categoria_ids)).toEqual(new Set([CAT_MARMITAS, CAT_BEBIDAS, CAT_DESTAQUES]));

    const row = adminProductsPage.row(criado.id);
    await expect(row.getByText('⭐', { exact: true })).toBeVisible(); // indicador de destaque na lista
    await expect(row.getByText('+2')).toBeVisible(); // indicador de multi-categoria (+N, N=total-1=2)
  });
});
