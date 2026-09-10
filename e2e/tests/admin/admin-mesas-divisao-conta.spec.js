/* e2e/tests/admin/admin-mesas-divisao-conta.spec.js — REF-MESA-02 · Onda 17 (@writes).
   Divisão de conta (admin_dividir_conta_mesa/admin_registrar_pagamento_alocacao já existiam desde
   REF-PAGAMENTO-01 · Onda 1, testados a nível de RPC em scripts/mesa-02-onda17-divisao-conta-ui-test.mjs
   -- aqui só confirma que a UI real (AdminMesas.jsx) produz o resultado certo, ponta a ponta: cadastra
   mesa, lança pedido manual (mesmo fluxo já provado em admin-pedidos-novo-mesa.spec.js), divide a
   conta em 2 partes iguais, paga uma, confirma que "Fechar conta" fica bloqueado, paga a outra,
   fecha com sucesso. */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { desligarMesaConfig, definirMesaConfig } from '../../support/mesaMode.js';
import { limparDadosDeTeste } from '../../support/cleanup.js';

test.describe('Divisão de conta de Mesa (Admin)', { tag: '@writes' }, () => {
  test.afterEach(async () => {
    await limparDadosDeTeste();
    await desligarMesaConfig();
  });

  test('divide em 2, paga as 2 fatias, fecha a conta', async ({ adminLoginPage, adminPanel, adminPedidosPage, page }) => {
    const config = await definirMesaConfig({ habilitada: true, canalAdmin: true, sessaoHabilitada: true });
    test.skip(config.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    const numeroMesa = `E2E${Date.now() % 100000}`;

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);

    // Cadastra a mesa física (precisa existir no catálogo pra aparecer na lista/"Ver conta").
    await adminPanel.abrirAba('mesas');
    await page.locator('[data-testid="mesas-novo-identificador"]').fill(numeroMesa);
    await page.locator('[data-testid="mesas-criar-btn"]').click();
    await expect(page.locator(`[data-testid="mesa-linha-${numeroMesa}"]`)).toBeVisible();

    // Lança um pedido manual pra essa mesa (mesmo fluxo já provado em admin-pedidos-novo-mesa.spec.js).
    await adminPanel.abrirAba('pedidos');
    await adminPedidosPage.abrirNovoPedidoMesa();
    await adminPedidosPage.mesaNumeroInput.fill(numeroMesa);
    await adminPedidosPage.mesaNomeInput.fill('E2E_TEST_Divisao Conta');
    await adminPedidosPage.mesaTelefoneInput.fill('38999990099');
    await adminPedidosPage.buscaProdutoInput.fill('Agua de Coco');
    await adminPedidosPage.produtoAdicionarButton('Agua de Coco').click();
    await adminPedidosPage.novoPedidoDialog.getByRole('button', { name: 'Adicionar ao pedido' }).click();
    await adminPedidosPage.novoPedidoDialog.getByRole('button', { name: 'Criar pedido' }).click();
    await expect(adminPedidosPage.novoPedidoDialog).not.toBeVisible();

    // Abre "Ver conta" da mesma mesa.
    await adminPanel.abrirAba('mesas');
    await page.locator(`[data-testid="mesa-ver-conta-${numeroMesa}"]`).click();
    await expect(page.locator('[data-testid="conta-mesa-dialog"]')).toBeVisible();
    await expect(page.locator('[data-testid="conta-mesa-total"]')).toBeVisible();

    // Divide a conta em 2 partes iguais -- geração automática já soma exato (mesmo total, distribuído
    // em centavos), então "Confirmar divisão" precisa estar habilitado sem eu tocar em nenhum valor.
    await page.locator('[data-testid="conta-mesa-dividir-btn"]').click();
    await expect(page.locator('[data-testid="conta-mesa-dividir-soma"]')).toContainText(/Soma:.*Total:/);
    await expect(page.locator('[data-testid="conta-mesa-dividir-confirmar-btn"]')).toBeEnabled();
    await page.locator('[data-testid="conta-mesa-dividir-confirmar-btn"]').click();

    // Depois de dividida: aparecem as 2 fatias pendentes, "Fechar conta" avisa que falta pagar.
    await expect(page.locator('text=Conta dividida em 2 partes')).toBeVisible();
    await expect(page.locator('[data-testid="conta-mesa-dividir-pendentes"]')).toContainText('2 partes');
    await expect(page.locator('[data-testid="conta-mesa-fechar-btn"]')).toBeDisabled();

    // Paga a 1a fatia.
    const pagarBtns = page.locator('[data-testid^="conta-mesa-alocacao-pagar-"]');
    await pagarBtns.first().click();
    await expect(page.locator('[data-testid="conta-mesa-dividir-pendentes"]')).toContainText('1 parte');
    await expect(page.locator('[data-testid="conta-mesa-fechar-btn"]')).toBeDisabled();

    // Paga a 2a fatia -- some o aviso de pendência, "Fechar conta" libera.
    await pagarBtns.first().click();
    await expect(page.locator('[data-testid="conta-mesa-dividir-pendentes"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="conta-mesa-fechar-btn"]')).toBeEnabled();

    await page.locator('[data-testid="conta-mesa-fechar-btn"]').click();
    await expect(page.locator('[data-testid="conta-mesa-dialog"]')).not.toBeVisible();

    // Mesa liberou (sessão fechada) -- não tem mais "Ver conta" nem badge de ocupada.
    await expect(page.locator(`[data-testid="mesa-ver-conta-${numeroMesa}"]`)).toHaveCount(0);
  });
});
