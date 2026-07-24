/* e2e/tests/admin/admin-dashboard.spec.js — REF-E2E-03 · Onda 2 (@writes).
   Dashboard (AdminDashboard.jsx): 5 stat-cards + breakdown por status + tabela "Últimos pedidos".
   Auto-refresh é a cada 60s (setInterval) — tempo demais para um teste; a prova de atualização usa o
   botão manual "🔄 Atualizar". A tabela usa `o.cliente_nome`/`o.cliente_telefone` — achado real da
   auditoria (ADR §1.3): esses campos NUNCA existem no retorno de DS.getPedidos (o select traz
   `customers:{name,phone}` aninhado, não campos soltos com esse nome), então a coluna "Cliente"
   sempre renderiza em branco, e a prova de "o pedido novo apareceu" não pode depender de nome/telefone
   — usa-se o valor numérico do card "Total geral" antes/depois do refresh. */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { criarPedidoAvulso } from '../../support/fixture-order.js';
import { limparDadosDeTeste } from '../../support/cleanup.js';
import { E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';

test.describe('Dashboard do Admin', { tag: '@writes' }, () => {
  test.afterEach(async () => { await limparDadosDeTeste(); });

  test('mostra os 5 cards principais e o breakdown por status', async ({ adminLoginPage, adminPanel, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await expect(adminPanel.tab('dashboard')).toBeVisible();

    for (const label of ['Pedidos hoje', 'Faturamento hoje', 'Em preparo', 'Ticket médio', 'Total geral']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    for (const label of ['Recebido', 'Em Preparo', 'Saiu p/ Entrega', 'Entregue', 'Cancelado']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test('estado vazio mostra "Nenhum pedido" quando não há pedidos', async ({ adminLoginPage, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await limparDadosDeTeste(); // garante baseline limpo antes desta verificação especifica

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await expect(page.getByText('Nenhum pedido')).toBeVisible();
  });

  test('atualizar manual reflete um pedido criado depois do 1º carregamento', async ({ adminLoginPage, adminPanel, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await expect(adminPanel.tab('dashboard')).toBeVisible();

    const totalCard = page.locator('.stat-card').filter({ hasText: 'Total geral' }).locator('.stat-val');
    const antes = Number(await totalCard.textContent());

    const pedido = await criarPedidoAvulso();
    test.skip(pedido.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    await page.getByRole('button', { name: /Atualizar/ }).click();
    await expect(totalCard).toHaveText(String(antes + 1));
  });
});
