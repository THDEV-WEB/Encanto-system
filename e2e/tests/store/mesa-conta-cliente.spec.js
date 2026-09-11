/* e2e/tests/store/mesa-conta-cliente.spec.js — REF-MESA-02 · Onda 18 (@writes).
   Cliente vê (só leitura) a conta da própria mesa quando chegou pelo QR real (?mesa_token=). A prova
   de segurança em si (token opaco vs mesa_identificador adivinhável, cross-tenant, anon sem sessão,
   nunca devolve 'alocacoes') já foi feita a nível de RPC em
   scripts/mesa-02-onda18-conta-cliente-leitura-test.mjs (10/10) -- aqui só confirma que a UI real
   (DeliveryBar + MinhaContaMesaModal) produz o resultado certo num navegador de verdade.

   REF-MESA-02 · Onda 18 (ajuste, 2026-09-11): o link "Ver conta da mesa" só aparece depois que a mesa
   TEM pelo menos um pedido na sessão aberta -- antes disso (cliente só chegou e ainda tá vendo o
   cardápio) fica escondido, pra não oferecer um link "morto" que só mostraria "nenhum pedido ainda". */
import { test, expect } from '../../fixtures/index.js';
import { supabaseAdmin } from '../../support/supabaseAdmin.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { desligarMesaConfig, definirMesaConfig } from '../../support/mesaMode.js';
import { limparDadosDeTeste } from '../../support/cleanup.js';

test.describe('Conta da mesa (cliente, só leitura)', { tag: '@writes' }, () => {
  test.afterEach(async () => {
    await limparDadosDeTeste();
    await desligarMesaConfig();
  });

  test('link só aparece depois do 1º pedido, e mostra os dados reais da conta', async ({ page, adminLoginPage, adminPanel, adminPedidosPage }) => {
    const config = await definirMesaConfig({ habilitada: true, canalQr: true, canalAdmin: true, sessaoHabilitada: true });
    test.skip(config.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    const admin = supabaseAdmin();
    const identificador = `E2E${Date.now() % 100000}`;

    // Cadastra a mesa física pelo Admin (mesmo fluxo de admin-mesas-divisao-conta.spec.js).
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('mesas');
    await page.locator('[data-testid="mesas-novo-identificador"]').fill(identificador);
    await page.locator('[data-testid="mesas-criar-btn"]').click();
    await expect(page.locator(`[data-testid="mesa-linha-${identificador}"]`)).toBeVisible();

    const { data: loja } = await admin.from('stores').select('id').eq('slug', 'encanto').single();
    const { data: mesa } = await admin.from('mesas').select('qr_token')
      .eq('store_id', loja.id).eq('identificador', identificador).single();

    // Ainda sem nenhum pedido na sessão: mesmo com o token real resolvido, o link fica escondido.
    await page.goto(`/encanto/?mesa_token=${mesa.qr_token}`);
    await expect(page.locator('[data-testid="ver-conta-mesa-link"]')).toHaveCount(0);

    // Garçom lança um pedido manual pra essa mesa (reaproveita a sessão de Admin já aberta).
    await adminLoginPage.goto();
    await adminLoginPage.entrarReaproveitandoSessao();
    await adminPanel.abrirAba('pedidos');
    await adminPedidosPage.abrirNovoPedidoMesa();
    await adminPedidosPage.mesaNumeroInput.fill(identificador);
    await adminPedidosPage.mesaNomeInput.fill('E2E_TEST_Conta Cliente');
    await adminPedidosPage.mesaTelefoneInput.fill('38999990099');
    await adminPedidosPage.buscaProdutoInput.fill('Agua de Coco');
    await adminPedidosPage.produtoAdicionarButton('Agua de Coco').click();
    await adminPedidosPage.novoPedidoDialog.getByRole('button', { name: 'Adicionar ao pedido' }).click();
    await adminPedidosPage.novoPedidoDialog.getByRole('button', { name: 'Criar pedido' }).click();
    await expect(adminPedidosPage.novoPedidoDialog).not.toBeVisible();

    // Agora sim: o link aparece pro cliente, e o modal mostra o pedido real (não o estado vazio).
    await page.goto(`/encanto/?mesa_token=${mesa.qr_token}`);
    await expect(page.locator('[data-testid="ver-conta-mesa-link"]')).toBeVisible();
    await page.locator('[data-testid="ver-conta-mesa-link"]').click();
    await expect(page.getByText(`Sua conta — Mesa ${identificador}`)).toBeVisible();
    await expect(page.getByText('Nenhum pedido em aberto nesta mesa ainda.')).not.toBeVisible();
    await expect(page.locator('[data-testid="minha-conta-mesa-total"]')).toBeVisible();

    await admin.from('mesas').delete().eq('store_id', loja.id).eq('identificador', identificador);
  });

  test('token inválido/inexistente nunca aplica o modo mesa nem mostra o link', async ({ page }) => {
    const config = await definirMesaConfig({ habilitada: true, canalQr: true });
    test.skip(config.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    await page.goto('/encanto/?mesa_token=00000000-0000-0000-0000-000000000000');
    await expect(page.locator('[data-testid="ver-conta-mesa-link"]')).toHaveCount(0);
  });
});
