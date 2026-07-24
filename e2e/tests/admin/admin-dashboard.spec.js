/* e2e/tests/admin/admin-dashboard.spec.js — REF-E2E-03 · Onda 2 (@writes) · Onda 3 (Dashboard
   operacional) reescrita na REF-ADMIN-01.
   Dashboard (AdminDashboard.jsx): 5 stat-cards + breakdown por status + tabela "Últimos pedidos".
   Auto-refresh é a cada 60s (setInterval) — tempo demais para um teste; a prova de atualização usa o
   botão manual "🔄 Atualizar".

   Achado original (REF-E2E-03, ADR §1.3): a tabela usava `o.cliente_nome`/`o.cliente_telefone`, que
   NUNCA existiram no retorno de DS.getPedidos (o select traz `customers:{name,phone}` aninhado) — a
   coluna "Cliente" sempre renderizava em branco. REF-ADMIN-01 · Onda 3 corrigiu para
   `o.customers?.name`/`o.customers?.phone` (mesmo acesso já usado, e já funcionando, em
   AdminPedidos.jsx), com fallback '—' para pedidos sem cliente vinculado (compatibilidade com
   pedidos antigos/avulsos sem customer_id). O teste de "atualizar manual" continua usando o valor do
   card "Total geral" p/ prova de atualização (não depende de nome/telefone). */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { criarPedidoAvulso } from '../../support/fixture-order.js';
import { limparDadosDeTeste } from '../../support/cleanup.js';
import { supabaseAdmin, E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';

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

  test('linha do pedido mostra nome e telefone do cliente (fix REF-ADMIN-01 · Onda 3)', async ({ adminLoginPage, adminPanel, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    const pedido = await criarPedidoAvulso();
    test.skip(pedido.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await expect(adminPanel.tab('dashboard')).toBeVisible();

    const linha = page.locator('.data-table tbody tr').filter({ hasText: pedido.telefone });
    await expect(linha).toBeVisible();
    await expect(linha).toContainText('E2E_TEST_Avulso');
    await expect(linha).toContainText(pedido.telefone);
  });

  test('pedido sem cliente vinculado não quebra a tabela (compatibilidade, mostra "—")', async ({ adminLoginPage, adminPanel, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    const pedido = await criarPedidoAvulso();
    test.skip(pedido.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    const admin = supabaseAdmin();
    await admin.from('orders').update({ customer_id: null }).eq('id', pedido.orderId);

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await expect(adminPanel.tab('dashboard')).toBeVisible();

    const linha = page.locator('.data-table tbody tr').first();
    await expect(linha).toBeVisible();
    await expect(linha).toContainText('—'); // sem customer_id -> order.customers é null, fallback sem quebrar

    // customer_id nulo tira este pedido do alcance de limparDadosDeTeste() (que apaga orders via
    // customer_id IN customersDoPrefixo) — remove à mão para não vazar entre execuções.
    await admin.from('order_items').delete().eq('order_id', pedido.orderId);
    await admin.from('orders').delete().eq('id', pedido.orderId);
  });
});
