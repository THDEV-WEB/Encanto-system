/* e2e/tests/admin/admin-saude.spec.js — REF-E2E-03 · Onda 6 (@writes).
   AdminHealth.jsx: painel só leitura (`orders_health()` RPC, agregados sem PII). Confirma que os
   cards renderizam com dados reais do projeto de E2E (não a tela vazia "Sem dados de saúde") e que o
   botão "Atualizar" reexecuta a consulta sem erro. Sem nenhum data-testid nesta tela — labels e botão
   já são texto real e estável. */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';

test.describe('Saúde do Sistema (Admin)', { tag: '@writes' }, () => {
  test('mostra os agregados reais e "Atualizar" reexecuta sem erro', async ({ adminLoginPage, adminPanel, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('saude');

    for (const label of ['Pedidos hoje', 'Faturamento hoje', 'Ticket médio', 'Total geral', 'Erros 24h', 'Divergências']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('Sem dados de saúde')).toHaveCount(0);

    await page.getByRole('button', { name: /Atualizar/ }).click();
    await expect(page.getByText('Pedidos hoje', { exact: true })).toBeVisible(); // ainda renderiza após o refresh
  });
});
