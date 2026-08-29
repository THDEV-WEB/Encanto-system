/* e2e/tests/admin/admin-relatorios.spec.js — REF-DASHBOARD-01 (@writes).
   AdminRelatorios.jsx: BI de negócio por período (admin_reports_summary) — preset 7d/30d/90d + período
   personalizado, faturamento/dia, top produtos, forma de pagamento, entrega vs. retirada. Prova o
   caminho real: pedido criado agora aparece no relatório (preset padrão 30d cobre hoje); período sem
   nenhum pedido mostra o estado vazio; trocar de preset dispara novo carregamento sem erro. */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { criarPedidoAvulso } from '../../support/fixture-order.js';
import { limparDadosDeTeste } from '../../support/cleanup.js';
import { E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';

test.describe('Relatórios (Admin)', { tag: '@writes' }, () => {
  test.afterEach(async () => { await limparDadosDeTeste(); });

  test('pedido real aparece no relatório do período padrão; trocar preset recarrega sem erro', async ({ adminLoginPage, adminPanel, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    const pedido = await criarPedidoAvulso();
    test.skip(pedido.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('relatorios');

    await expect(page.getByText('Pedidos no período')).toBeVisible();
    const cardReceita = page.locator('.stat-card').filter({ hasText: 'Receita no período' });
    await expect(cardReceita.locator('.stat-val')).toHaveText('R$ 15,99'); // total do pedido avulso (fixture-order.js) — REF-PRICE-SOURCE-01: preço real de PROD_MARMITA_P, autoritativo no servidor
    await expect(page.getByText('Marmita P')).toBeVisible(); // top produtos

    await page.getByRole('button', { name: '7 dias' }).click();
    await expect(page.getByText('Pedidos no período')).toBeVisible(); // recarrega sem erro, ainda no range (pedido é de hoje)
  });

  test('período sem nenhum pedido mostra o estado vazio', async ({ adminLoginPage, adminPanel, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('relatorios');

    const inicio = page.locator('input[type="date"]').first();
    const fim = page.locator('input[type="date"]').last();
    await inicio.fill('2019-01-01');
    await fim.fill('2019-01-31');

    await expect(page.getByText('Nenhum pedido no período selecionado.')).toBeVisible();
  });
});
