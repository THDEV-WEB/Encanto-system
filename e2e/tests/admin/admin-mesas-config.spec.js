/* e2e/tests/admin/admin-mesas-config.spec.js — REF-MESA-01 · Onda 9 (@writes).
   Bloco "Configuração de Mesa" (AdminMesas.jsx): fecha o gap de UI registrado desde a Onda 2 (antes
   só dava pra habilitar Mesa via SQL direto). Prova a integração PONTA A PONTA num navegador real:
   estado inicial desligado, liga os 4 campos, salva, confirma persistência real após reload (prova
   que foi pro servidor, não só estado local). O contrato do RPC (gate de permissão, upsert idempotente,
   isolamento por loja) já foi provado exaustivamente em
   scripts/mesa-01-onda9-config-admin-test.mjs — aqui só confirma que a UI real produz o resultado certo.

   O <input type="checkbox"> do toggle-switch (index.css) é width:0/height:0/opacity:0 por design (o
   visual é o <span class="toggle-slider"> ao lado, dentro do mesmo <label>) -- clicar precisa mirar o
   <label> (que tem dimensão real e delega o clique nativamente pro input), nunca o input em si. */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { desligarMesaConfig, definirMesaConfig } from '../../support/mesaMode.js';
import { limparDadosDeTeste } from '../../support/cleanup.js';

function inputToggle(page, testId) { return page.locator(`[data-testid="${testId}"]`); }
function switchToggle(page, testId) { return page.locator(`label:has([data-testid="${testId}"])`); }

test.describe('Configuração de Mesa (Admin)', { tag: '@writes' }, () => {
  test.afterEach(async () => {
    await limparDadosDeTeste();
    await desligarMesaConfig(); // nunca deixa Mesa ligada pra specs seguintes na mesma loja fixture
  });

  test('liga habilitada+QR+garçom+sessão, salva, e persiste após reload', async ({ adminLoginPage, adminPanel, page }) => {
    await desligarMesaConfig(); // estado inicial conhecido (default seguro)

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('mesas');

    const habilitadaInput = inputToggle(page, 'mesa-config-toggle-habilitada');
    const canalQrInput = inputToggle(page, 'mesa-config-toggle-canal-qr');
    const canalAdminInput = inputToggle(page, 'mesa-config-toggle-canal-admin');
    const sessaoInput = inputToggle(page, 'mesa-config-toggle-sessao');
    const salvar = page.locator('[data-testid="mesa-config-salvar-btn"]');

    await expect(habilitadaInput).not.toBeChecked();
    // canais dependentes vêm desabilitados enquanto "habilitada" está desligado
    await expect(canalQrInput).toBeDisabled();
    await expect(salvar).toBeDisabled();

    await switchToggle(page, 'mesa-config-toggle-habilitada').click();
    await expect(canalQrInput).toBeEnabled();
    await switchToggle(page, 'mesa-config-toggle-canal-qr').click();
    await switchToggle(page, 'mesa-config-toggle-canal-admin').click();
    await switchToggle(page, 'mesa-config-toggle-sessao').click();

    await expect(habilitadaInput).toBeChecked();
    await expect(canalQrInput).toBeChecked();
    await expect(canalAdminInput).toBeChecked();
    await expect(sessaoInput).toBeChecked();

    await expect(salvar).toBeEnabled();
    await salvar.click();
    await expect(page.locator('[data-testid="mesa-config-msg"]')).toHaveText(/salva com sucesso/i);

    // Recarrega a página inteira -- prova que persistiu no servidor (get_mesa_config), não só no
    // estado local do form.
    await page.reload();
    await adminLoginPage.entrarReaproveitandoSessao();
    await adminPanel.abrirAba('mesas');
    await expect(inputToggle(page, 'mesa-config-toggle-habilitada')).toBeChecked();
    await expect(inputToggle(page, 'mesa-config-toggle-canal-qr')).toBeChecked();
    await expect(inputToggle(page, 'mesa-config-toggle-canal-admin')).toBeChecked();
    await expect(inputToggle(page, 'mesa-config-toggle-sessao')).toBeChecked();
  });

  test('desligar "habilitada" desliga os 3 canais junto no formulário', async ({ adminLoginPage, adminPanel, page }) => {
    await definirMesaConfig({ habilitada: true, canalQr: true, canalAdmin: true });

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('mesas');

    const habilitadaInput = inputToggle(page, 'mesa-config-toggle-habilitada');
    const canalQrInput = inputToggle(page, 'mesa-config-toggle-canal-qr');
    await expect(habilitadaInput).toBeChecked();
    await expect(canalQrInput).toBeChecked();

    await switchToggle(page, 'mesa-config-toggle-habilitada').click(); // desliga
    await expect(canalQrInput).not.toBeChecked();
    await expect(canalQrInput).toBeDisabled();

    await page.locator('[data-testid="mesa-config-salvar-btn"]').click();
    await expect(page.locator('[data-testid="mesa-config-msg"]')).toHaveText(/salva com sucesso/i);

    await page.reload();
    await adminLoginPage.entrarReaproveitandoSessao();
    await adminPanel.abrirAba('mesas');
    await expect(inputToggle(page, 'mesa-config-toggle-habilitada')).not.toBeChecked();
    await expect(inputToggle(page, 'mesa-config-toggle-canal-qr')).not.toBeChecked();
  });
});
