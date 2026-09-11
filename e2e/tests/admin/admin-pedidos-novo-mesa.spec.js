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
import { supabaseAdmin } from '../../support/supabaseAdmin.js';

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
    // REF-MESA-02 · Onda 7: abre o editor de adicionais do item antes de ir pro resumo -- mesmo passo
    // intermediário que o checkout do cliente já tem, agora reaproveitado aqui.
    await adminPedidosPage.novoPedidoDialog.getByRole('button', { name: 'Adicionar ao pedido' }).click();
    await expect(adminPedidosPage.novoPedidoDialog.getByText('Total estimado')).toBeVisible();

    await adminPedidosPage.mesaCriarButton.click();
    await expect(adminPedidosPage.novoPedidoDialog).toBeHidden();

    // Pedido real criado -> aparece na lista de Pedidos (mesmo carregamento que qualquer outro).
    await adminPedidosPage.buscar('38999990012');
    await expect(page.getByText('E2E_TEST_Mesa Admin')).toBeVisible();

    /* REF-MESA-01 · Onda 5: badge do card mostra "🍽️ Mesa 12" (nao mais "🛵 Entrega" por default de
       ternario de 2 vias — admin_orders_search agora devolve tipo_pedido/mesa_identificador de
       verdade, comandaModel.tipoDoPedido le esses campos em vez de inferir por regex). */
    await expect(page.getByText('🍽️ Mesa 12')).toBeVisible();

    // Comanda do pedido de mesa: "MESA 12" no cabecalho, sem bloco de endereco.
    const card = page.locator('[data-testid^="pedido-card-"]').filter({ hasText: 'E2E_TEST_Mesa Admin' });
    await card.getByRole('button', { name: /Comanda/ }).click();
    await expect(adminPedidosPage.comandaDialog).toBeVisible();
    await expect(adminPedidosPage.comandaFrame.getByText('MESA', { exact: true })).toBeVisible();
    await adminPedidosPage.fecharComanda();
  });

  // REF-MESA-02 · Onda 19: nome/telefone viraram opcionais SÓ neste canal (garçom) -- decisão do
  // dono, pedir telefone de quem só está sentado numa mesa física soa estranho. Sem os 2 campos, o
  // pedido ainda é criado (número da mesa continua sendo a identificação real), com nome "Mesa X" e
  // sem nenhum telefone falso aparecendo em lugar nenhum da UI (comanda mostra "—"). O nome resultante
  // ("Mesa <numero>") NUNCA começa com o prefixo E2E_TEST_ (limparDadosDeTeste só varre esse prefixo),
  // então esta limpeza é MANUAL/explícita, por customer_id -- nunca deixa lixo pra próxima execução.
  test('cria pedido de mesa mesmo sem nome/telefone do cliente -- vira "Mesa X", sem telefone falso na comanda', async ({ adminLoginPage, adminPanel, adminPedidosPage, page }) => {
    const config = await definirMesaConfig({ habilitada: true, canalAdmin: true });
    test.skip(config.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    const numeroMesa = `E2E${Date.now() % 100000}`;
    const nomeEsperado = `Mesa ${numeroMesa}`;

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('pedidos');

    await adminPedidosPage.abrirNovoPedidoMesa();
    await adminPedidosPage.mesaNumeroInput.fill(numeroMesa);
    // nome/telefone ficam em branco de propósito -- é isso que o teste prova.
    await adminPedidosPage.buscaProdutoInput.fill('Agua de Coco');
    await adminPedidosPage.produtoAdicionarButton('Agua de Coco').click();
    await adminPedidosPage.novoPedidoDialog.getByRole('button', { name: 'Adicionar ao pedido' }).click();
    await adminPedidosPage.mesaCriarButton.click();
    await expect(adminPedidosPage.novoPedidoDialog).toBeHidden();

    try {
      // "Mesa <numero>" aparece mais de uma vez no card (badge + nome do cliente, que virou o nome
      // da mesa já que nenhum nome foi informado) -- .first() basta pra confirmar presença.
      const card = page.locator('[data-testid^="pedido-card-"]').filter({ hasText: nomeEsperado });
      await expect(card.getByText(nomeEsperado).first()).toBeVisible();

      await card.getByRole('button', { name: /Comanda/ }).click();
      await expect(adminPedidosPage.comandaDialog).toBeVisible();
      await expect(adminPedidosPage.comandaFrame.getByText('sem-telefone-')).toHaveCount(0);
      await adminPedidosPage.fecharComanda();
    } finally {
      const admin = supabaseAdmin();
      if (admin) {
        const { data: clientes } = await admin.from('customers').select('id').eq('name', nomeEsperado);
        const customerIds = (clientes || []).map((c) => c.id);
        if (customerIds.length) {
          const { data: pedidos } = await admin.from('orders').select('id').in('customer_id', customerIds);
          const orderIds = (pedidos || []).map((o) => o.id);
          if (orderIds.length) await admin.from('order_items').delete().in('order_id', orderIds);
          if (orderIds.length) await admin.from('orders').delete().in('id', orderIds);
          await admin.from('customers').delete().in('id', customerIds);
        }
      }
    }
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
