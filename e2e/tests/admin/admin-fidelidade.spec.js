/* e2e/tests/admin/admin-fidelidade.spec.js — REF-E2E-03 · Onda 5 (@writes).
   AdminFidelidade.jsx: visão do OPERADOR (complementa, não duplica, a fidelidade do CLIENTE já testada
   na E2E-02 — aqui o ângulo é o admin consultando/ajustando a conta de outro cliente). 3 sub-painéis:
   (a) toggle Ativo/Desativado do programa; (b) busca + ajuste manual (±1 selo) + resgate administrativo
   de UM cliente (admin_find_loyalty/admin_adjust_loyalty/redeem_reward); (c) config global
   (required/discount via set_loyalty_config) — GLOBAL como store_mode/delivery_eta_min, então o
   baseline observado no início (não um valor fixo assumido) é restaurado ao final. Reaproveita
   CLIENTE_FIXTURE (E2E-02) — cria 1 pedido real via `criarPedidoFixture()` para garantir 1 selo
   determinístico (não depende de estado ambiente). */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE, CLIENTE_FIXTURE } from '../../support/fixture-accounts.js';
import { garantirClienteFixtureVinculado } from '../../support/fixture-customer.js';
import { criarPedidoFixture } from '../../support/fixture-order.js';
import { limparPedidosDoFixture } from '../../support/cleanup.js';
import { E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';

test.describe('Fidelidade — visão do Admin', { tag: '@writes' }, () => {
  test.describe.configure({ mode: 'serial' }); // config do programa (required/discount) é GLOBAL

  test.beforeAll(async () => { await garantirClienteFixtureVinculado(); });
  test.afterEach(async () => { await limparPedidosDoFixture(); });

  test('busca/ajusta/resgata um cliente e edita a config do programa (restaura o baseline)', async ({ adminLoginPage, adminPanel, adminFidelidadePage, page }) => {
    const pedido = await criarPedidoFixture(); // 1 pedido real -> 1 selo concedido pelo trigger
    test.skip(pedido.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('fidelidade');

    // Baseline OBSERVADO (não assumido) — restaurado ao final, pois required/discount são GLOBAIS.
    const regra = await page.getByText(/^Regra: \d+ pedidos = \d+% de desconto/).textContent();
    const [, requiredBaseline, discountBaseline] = regra.match(/Regra: (\d+) pedidos = (\d+)%/);

    // ── Busca + ajuste manual ──
    await adminFidelidadePage.buscar(CLIENTE_FIXTURE.telefone);
    await expect(page.getByText(CLIENTE_FIXTURE.nome)).toBeVisible();
    await expect(page.getByText(/^1\s*\/\s*\d+\s*pedidos/)).toBeVisible(); // 1 selo do pedido recém-criado

    await adminFidelidadePage.maisSeloButton.click();
    await expect(page.getByText(/^2\s*\/\s*\d+\s*pedidos/)).toBeVisible();

    await adminFidelidadePage.menosSeloButton.click();
    await expect(page.getByText(/^1\s*\/\s*\d+\s*pedidos/)).toBeVisible();

    // ── Config: abaixa "Pedidos p/ recompensa" para 1 (temporário) -> recompensa fica disponível.
    //    `cliente.required` fica congelado no momento da BUSCA (admin_find_loyalty) — mudar a config
    //    global não atualiza retroativamente o resultado já exibido; refazer a busca é o que reflete
    //    o novo threshold (achado real, não assunção). ──
    await adminFidelidadePage.salvarConfig({ required: 1 });
    await expect(page.getByText('✓ Salvo com sucesso!')).toBeVisible();
    await adminFidelidadePage.buscar(CLIENTE_FIXTURE.telefone);
    await expect(page.getByText('🎁 Recompensa disponível')).toBeVisible();

    // ── Resgate administrativo ──
    await adminFidelidadePage.resgatarButton.click();
    await expect(page.getByText(/Faltam 1 pedido/)).toBeVisible(); // ciclo reiniciado (stamps -= required)

    // ── Restaura o baseline observado no início ──
    await adminFidelidadePage.salvarConfig({ required: requiredBaseline, discount: discountBaseline });
    await expect(page.getByText('✓ Salvo com sucesso!')).toBeVisible();
    await expect(page.getByText(new RegExp(`Regra: ${requiredBaseline} pedidos = ${discountBaseline}% de desconto`))).toBeVisible();
  });

  test('toggle Ativo/Desativado grava e reflete no rótulo', async ({ adminLoginPage, adminPanel, adminFidelidadePage, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('fidelidade');

    const estavaAtivo = await adminFidelidadePage.enabledCheckbox.isChecked();
    await adminFidelidadePage.enabledToggleClicavel.click();
    await expect(page.getByText(estavaAtivo ? '○ Desativado' : '● Ativo')).toBeVisible();

    // restaura o estado original
    await adminFidelidadePage.enabledToggleClicavel.click();
    await expect(page.getByText(estavaAtivo ? '● Ativo' : '○ Desativado')).toBeVisible();
  });
});
