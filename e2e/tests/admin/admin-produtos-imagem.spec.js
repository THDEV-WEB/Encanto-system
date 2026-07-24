/* e2e/tests/admin/admin-produtos-imagem.spec.js — REF-E2E-03 · Onda 4 (@writes).
   ImageUploader.jsx: validação client-side (tamanho/tipo) roda ANTES de qualquer chamada de rede —
   100% testável sem depender de Storage real. Upload de verdade fica mockado via page.route (decisão
   ADR §7.1, mesmo padrão de ViaCEP/Nominatim/e-mail): cobre a MECÂNICA da UI (preview atualiza,
   onUpload dispara, o produto salva a URL pública), nunca um bucket real (que não existe no projeto
   de E2E — ver ADR §1.8). */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { CAT_MARMITAS } from '../../support/fixture-catalog.js';
import { supabaseAdmin, E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';
import { limparCatalogoDeTeste } from '../../support/fixture-catalog-admin.js';
import { mockImageUpload } from '../../support/network-stubs.js';

const NOME_PROD = 'E2E_TEST_ProdutoComImagem';

test.describe('Upload de imagem do Produto', { tag: '@writes' }, () => {
  test.afterEach(async () => { await limparCatalogoDeTeste(); });

  test('rejeita arquivo grande demais e tipo inválido (validação client-side, sem rede)', async ({ adminLoginPage, adminPanel, adminProductsPage }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('products');
    await adminProductsPage.abrirNovo();

    await adminProductsPage.imagemArquivoInput.setInputFiles({
      name: 'grande.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
    });
    await expect(adminProductsPage.imagemErro).toContainText('Máx. 5 MB');

    await adminProductsPage.imagemArquivoInput.setInputFiles({
      name: 'documento.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4'),
    });
    await expect(adminProductsPage.imagemErro).toContainText('Formato inválido');

    await adminProductsPage.cancelarButton.click();
  });

  test('upload mockado: preview atualiza e a URL é persistida no produto', async ({ adminLoginPage, adminPanel, adminProductsPage, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await mockImageUpload(page);
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('products');
    await adminProductsPage.abrirNovo();
    await adminProductsPage.preencher({ nome: NOME_PROD, preco: 12, categoriaId: CAT_MARMITAS });

    await adminProductsPage.imagemArquivoInput.setInputFiles({
      name: 'produto.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xdb]),
    });
    await expect(page.locator('[data-testid="prod-form-imagem"] img')).toHaveAttribute('src', /storage\/v1\/object\/public\/products\//);

    await adminProductsPage.salvar();
    await expect(page.getByText(NOME_PROD)).toBeVisible();

    const admin = supabaseAdmin();
    const { data: criado } = await admin.from('products').select('imagem_url').eq('nome', NOME_PROD).single();
    expect(criado.imagem_url).toMatch(/storage\/v1\/object\/public\/products\//);
  });

  test('URL manual: colar um link válido atualiza o preview; remover volta ao placeholder', async ({ adminLoginPage, adminPanel, adminProductsPage, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('products');
    await adminProductsPage.abrirNovo();

    await adminProductsPage.imagemUrlInput.fill('https://exemplo.encanto.local/foto.jpg');
    await expect(page.locator('[data-testid="prod-form-imagem"] img')).toHaveAttribute('src', 'https://exemplo.encanto.local/foto.jpg');

    await adminProductsPage.imagemRemoverButton.click();
    await expect(page.locator('[data-testid="prod-form-imagem"] img')).toHaveCount(0);

    await adminProductsPage.cancelarButton.click();
  });
});
