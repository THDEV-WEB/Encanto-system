/* e2e/tests/store/search.spec.js — REF-E2E-01 · Onda 2 (@read-only).
   Busca inteligente (REF-UI-SEARCH-01): dropdown de sugestões agrupadas (Categorias/Produtos),
   tolerante a acento/caixa/parcial (utils/searchText.js: deburr). Vive só na barra sticky — "surge
   ao rolar" (useStickyReveal), por isso cada teste rola a página antes de usar a busca (fluxo real,
   não atalho). Roda contra o catálogo fixture semeado no projeto de E2E (e2e/support/seed-catalog.sql). */
import { test, expect } from '../../fixtures/index.js';
import { PROD_ENCANTO_MINEIRO } from '../../support/fixture-catalog.js';

test.describe('busca inteligente', { tag: '@read-only' }, () => {
  test.beforeEach(async ({ storePage }) => {
    await storePage.goto();
    await storePage.revelarBuscaSticky();
  });

  test('tolerante a acento: "acai" encontra produtos com "Açaí" no nome', async ({ storePage }) => {
    await storePage.search('acai');
    await expect(storePage.suggestionsListbox).toBeVisible();
    await expect(storePage.suggestionsListbox.getByRole('option', { name: /Açaí/ }).first()).toBeVisible();
  });

  test('agrupa sugestões em "Categorias" e "Produtos"', async ({ storePage, page }) => {
    await storePage.search('bebidas');
    const listbox = storePage.suggestionsListbox;
    await expect(listbox.getByText('Categorias', { exact: true })).toBeVisible();
    // exact:true — vários PRODUTOS da categoria "Bebidas" também casam a busca (subtítulo mostra o
    // nome da categoria), então só a opção da categoria em si tem nome acessível == "Bebidas".
    await expect(listbox.getByRole('option', { name: 'Bebidas', exact: true })).toBeVisible();
  });

  test('selecionar uma sugestão de produto rola até o card correspondente', async ({ storePage }) => {
    await storePage.search('Encanto Mineiro');
    await storePage.suggestionsListbox.getByRole('option', { name: /Encanto Mineiro/ }).click();
    await expect(storePage.productCard(PROD_ENCANTO_MINEIRO)).toBeInViewport();
  });

  test('selecionar uma sugestão de categoria rola até a seção correspondente', async ({ storePage, page }) => {
    await storePage.search('fitness');
    // exact:true — "fitness" também casa por PRODUTO (nome ou categoria do produto), então o grupo
    // Produtos traz opções cujo subtítulo é "Pedido Fitness" (nome acessível mais longo); só a opção
    // da CATEGORIA em si tem nome acessível igual a "Pedido Fitness" exatamente.
    await storePage.suggestionsListbox.getByRole('option', { name: 'Pedido Fitness', exact: true }).click();
    await expect(page.locator('#sec-fitness')).toBeInViewport();
  });

  test('sem resultado mostra estado vazio com ação de limpar', async ({ storePage }) => {
    await storePage.search('zzz-produto-que-nao-existe');
    const listbox = storePage.suggestionsListbox;
    await expect(listbox.getByText('Nenhum produto encontrado.')).toBeVisible();
    await listbox.getByRole('button', { name: 'Limpar busca' }).click();
    await expect(storePage.searchInput).toHaveValue('');
  });
});
