/* e2e/tests/admin/admin-pedidos-novo-mesa.spec.js — REF-MESA-01 · Onda 4 (@writes).
   NovoPedidoMesaModal.jsx: canal admin_garcom, só aparece quando a loja liga mesa_canal_admin
   (get_mesa_config). Prova a integração PONTA A PONTA que nenhum teste de domínio cobre: o botão só
   aparece com a capacidade ligada, o formulário carrega o catálogo real (DS.getAllProds), e o submit
   usa DS.savePedidoAdmin (buildStoreRpcParam — loja ATIVA do Admin, não buildStorefrontRpcParam, que
   nunca resolveria dentro do bundle Admin) criando um pedido real via create_order com
   tipo_pedido='mesa'/origem_pedido='admin_garcom'. A validação de segurança em si (capacidade,
   is_admin_of, cross-tenant, bypass anon) já foi provada exaustivamente em
   scripts/mesa-01-onda4-canal-admin-test.mjs — aqui só confirma que a UI real produz o resultado certo. */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { definirMesaConfig, desligarMesaConfig } from '../../support/mesaMode.js';
import { limparDadosDeTeste } from '../../support/cleanup.js';

test.describe('Novo pedido de mesa (Admin/garçom)', { tag: '@writes' }, () => {
  test.afterEach(async () => {
    await limparDadosDeTeste();
    await desligarMesaConfig(); // nunca deixa Mesa ligada pra specs seguintes na mesma loja fixture
  });

  test('botão só aparece com mesa_canal_admin=true, e cria um pedido real de mesa', async ({ adminLoginPage, adminPanel, adminPedidosPage, page }) => {
    const config = await definirMesaConfig({ habilitada: true, canalAdmin: true });
    test.skip(config.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('pedidos');

    await expect(adminPedidosPage.novoPedidoMesaButton).toBeVisible();
    await adminPedidosPage.abrirNovoPedidoMesa();
    await expect(adminPedidosPage.novoPedidoDialog).toBeVisible();

    await adminPedidosPage.mesaNumeroInput.fill('12');
    await adminPedidosPage.mesaNomeInput.fill('E2E_TEST_Mesa Admin');
    await adminPedidosPage.mesaTelefoneInput.fill('38999990012');
    await adminPedidosPage.buscaProdutoInput.fill('Agua de Coco');
    await adminPedidosPage.produtoAdicionarButton('Agua de Coco').click();
    await expect(adminPedidosPage.novoPedidoDialog.getByText('Total estimado')).toBeVisible();

    await adminPedidosPage.mesaCriarButton.click();
    await expect(adminPedidosPage.novoPedidoDialog).toBeHidden();

    // Pedido real criado -> aparece na lista de Pedidos (mesmo carregamento que qualquer outro).
    await adminPedidosPage.buscar('38999990012');
    await expect(page.getByText('E2E_TEST_Mesa Admin')).toBeVisible();
  });

  test('botão NÃO aparece quando mesa_canal_admin=false (default seguro)', async ({ adminLoginPage, adminPanel, adminPedidosPage }) => {
    const config = await desligarMesaConfig();
    test.skip(config.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('pedidos');

    await expect(adminPedidosPage.novoPedidoMesaButton).toBeHidden();
  });
});
