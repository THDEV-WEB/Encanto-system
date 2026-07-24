/* e2e/tests/admin/admin-produtos-adicionais.spec.js — REF-E2E-03 · Onda 4 (@writes).
   "Grupos de adicionais disponíveis" (AdminProducts.jsx `gruposDisponiveis`) é 100% dinâmico: deriva
   dos grupos distintos entre os ADICIONAIS aplicáveis à categoria escolhida (`aplica_categoria_id`
   nulo OU igual à categoria) — a lista cresce sozinha ao cadastrar um adicional num grupo novo, sem
   alteração de código (achado da auditoria; `admin-addons.guard.mjs` já tranca a MESMA regra em
   isolamento puro — aqui prova-se a UI real, ponta a ponta). Cria um adicional com um grupo fora dos
   3 fixos do <select> de Adicionais (só alcançável via insert direto, ex.: "chocolates"), restrito a
   UMA categoria via `aplica_categoria_id`, e prova que ele só aparece no form de Produto quando essa
   categoria está selecionada. IMPORTANTE: `.salvar()` dispara DS.upsertProd + await load() de forma
   assíncrona — o clique resolve assim que o evento é despachado, não quando save/refresh terminam;
   consultar o backend direto sem antes esperar uma confirmação visível na UI é uma corrida real (só
   aparece sob timing mais rápido, ex.: suíte inteira aquecida) — sempre aguardar `page.getByText`
   antes de qualquer verificação via supabaseAdmin(). */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { CAT_MARMITAS, CAT_BEBIDAS } from '../../support/fixture-catalog.js';
import { supabaseAdmin, E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';
import { limparCatalogoDeTeste } from '../../support/fixture-catalog-admin.js';

const NOME_AD = 'E2E_TEST_AdicionalGrupoNovo';
const NOME_PROD = 'E2E_TEST_ProdutoComGrupoAd';
const ROTULO_GRUPO = '🍫 Chocolates';

test.describe('Grupos de adicionais no formulário de Produtos (dinâmico)', { tag: '@writes' }, () => {
  test.afterEach(async () => { await limparCatalogoDeTeste(); });

  test('grupo novo só aparece disponível para a categoria a que se aplica', async ({ adminLoginPage, adminPanel, adminProductsPage, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    const admin = supabaseAdmin();
    await admin.from('adicionais').insert({
      nome: NOME_AD, grupo: 'chocolates', tipo: 'pago', preco: 2, ativo: true, aplica_categoria_id: CAT_MARMITAS,
    });

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('products');
    await adminProductsPage.abrirNovo();

    await adminProductsPage.preencher({ nome: NOME_PROD, preco: 10, categoriaId: CAT_MARMITAS });
    await expect(adminProductsPage.grupoAdButton(ROTULO_GRUPO)).toBeVisible();

    await adminProductsPage.preencher({ categoriaId: CAT_BEBIDAS });
    await expect(adminProductsPage.grupoAdButton(ROTULO_GRUPO)).toHaveCount(0); // não se aplica a Bebidas

    await adminProductsPage.preencher({ categoriaId: CAT_MARMITAS });
    await adminProductsPage.alternarGrupoAd(ROTULO_GRUPO);
    await adminProductsPage.salvar();
    await expect(page.getByText(NOME_PROD)).toBeVisible();

    const { data: criado } = await admin.from('products').select('grupos_ad').eq('nome', NOME_PROD).single();
    expect(criado.grupos_ad).toContain('chocolates');
  });
});
