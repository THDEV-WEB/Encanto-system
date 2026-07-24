/* e2e/tests/admin/admin-status.spec.js — REF-E2E-03 · Onda 5 (@writes).
   AdminStatus.jsx: 3 modos (Automático/Forçar Aberta/Forçar Fechada) gravados via `set_store_mode`
   (RPC is_admin()-gated) na MESMA `settings.store_mode` que a loja/checkout leem
   (REF-BUSINESS-HOURS-03) — efeito GLOBAL, mesmo cuidado de serialização já em vigor desde a
   E2E-01 Onda 4 (`forcarStoreMode`). Verifica tanto o texto exibido quanto o valor REAL persistido
   (leitura direta via supabaseAdmin(), não só a UI otimista). Botões já são texto real e estável —
   sem necessidade de data-testid nesta tela (única do Admin sem nenhum ajuste de produção). */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { supabaseAdmin, E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';
import { forcarStoreMode } from '../../support/storeMode.js';

test.describe('Status da Loja (Admin)', { tag: '@writes' }, () => {
  test.describe.configure({ mode: 'serial' }); // store_mode é GLOBAL — evita corrida com outros describes que o forçam

  test.afterAll(async () => { await forcarStoreMode('OPEN'); }); // nunca deixa o ambiente travado em CLOSED/AUTO

  test('Forçar Aberta / Forçar Fechada / Automático — grava de verdade e reflete na tela', async ({ adminLoginPage, adminPanel, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('status');

    const admin = supabaseAdmin();
    const lerModo = async () => (await admin.from('settings').select('valor').eq('chave', 'store_mode').single()).data.valor;

    await page.getByRole('button', { name: /Forçar Aberta/ }).click();
    await expect(page.getByText('🟢 Aberta')).toBeVisible();
    await expect(page.getByText('(Forçada pelo administrador)')).toBeVisible();
    await expect.poll(lerModo).toBe('OPEN');

    await page.getByRole('button', { name: /Forçar Fechada/ }).click();
    await expect(page.getByText('🔴 Fechada')).toBeVisible();
    await expect.poll(lerModo).toBe('CLOSED');

    await page.getByRole('button', { name: /Automático/ }).click();
    await expect(page.getByText('Modo automático ativo')).toBeVisible();
    await expect.poll(lerModo).toBe('AUTO');
  });
});
