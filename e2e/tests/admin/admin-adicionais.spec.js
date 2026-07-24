/* e2e/tests/admin/admin-adicionais.spec.js — REF-E2E-03 · Onda 3 (@writes).
   CRUD de Adicionais (AdminAdicionais.jsx). Ao contrário de Categorias, não há um vínculo "em uso"
   análogo a testar: produtos referenciam adicionais pelo GRUPO (string compartilhada, ver
   utils/addons.js `resolverAdicionais`/`gruposDoProduto`), nunca por `adicionais.id` específico — não
   existe coluna/array em `products` guardando ids de adicionais, então excluir um adicional não deixa
   nenhuma referência órfã em nenhum produto (diferente do achado real de admin-categorias.spec.js). */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { supabaseAdmin, E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';
import { limparCatalogoDeTeste } from '../../support/fixture-catalog-admin.js';

const NOME_AD = 'E2E_TEST_AdicionalNovo';
const NOME_AD_EDITADO = 'E2E_TEST_AdicionalEditado';

test.describe('CRUD de Adicionais', { tag: '@writes' }, () => {
  test.afterEach(async () => { await limparCatalogoDeTeste(); });

  test('cria um adicional grátis, edita para pago com preço, depois exclui', async ({ adminLoginPage, adminPanel, adminAdicionaisPage, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('adicionais');

    await adminAdicionaisPage.abrirNovo();
    await adminAdicionaisPage.preencher({ nome: NOME_AD, tipo: 'gratis', grupo: 'acai' });
    await adminAdicionaisPage.salvar();
    await expect(page.getByText(NOME_AD)).toBeVisible();

    const admin = supabaseAdmin();
    const { data: criado } = await admin.from('adicionais').select('id').eq('nome', NOME_AD).single();

    await adminAdicionaisPage.editar(criado.id);
    await adminAdicionaisPage.preencher({ nome: NOME_AD_EDITADO, tipo: 'pago' });
    await expect(adminAdicionaisPage.precoInput).toBeVisible(); // campo Preço só existe no DOM quando tipo=pago
    await adminAdicionaisPage.preencher({ preco: '3.50' });
    await adminAdicionaisPage.salvar();

    const linha = adminAdicionaisPage.row(criado.id);
    await expect(linha.getByText(NOME_AD_EDITADO)).toBeVisible();
    await expect(linha).toContainText(/R\$\s*3,50/);
    await expect(linha.getByText('Pago', { exact: true })).toBeVisible();

    await adminAdicionaisPage.excluir(criado.id);
    await expect(page.getByText(NOME_AD_EDITADO)).toHaveCount(0);
  });

  test('nome vazio não salva e mantém o modal aberto', async ({ adminLoginPage, adminPanel, adminAdicionaisPage, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('adicionais');

    const contador = page.getByRole('heading', { name: /^Adicionais \(\d+\)$/ });
    await expect(page.getByText('Carregando...')).toHaveCount(0); // aguarda o load real (1º paint sempre mostra "Adicionais (0)")
    const antes = await contador.textContent();

    await adminAdicionaisPage.abrirNovo();
    await adminAdicionaisPage.salvar(); // nome vazio -> save() é um no-op (mesmo achado de Categorias)
    await expect(adminAdicionaisPage.nomeInput).toBeVisible();
    await expect(contador).toHaveText(antes);
  });
});
