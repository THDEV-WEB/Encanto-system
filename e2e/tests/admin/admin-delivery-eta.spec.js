/* e2e/tests/admin/admin-delivery-eta.spec.js — REF-E2E-03 · Onda 5 (@writes).
   AdminDeliveryEta.jsx: presets/campo SÓ selecionam (nunca salvam sozinhos); "Salvar" é a ÚNICA ação
   que grava, via `set_delivery_eta` (RPC is_admin()-gated, valida 10..180 no servidor) na MESMA
   `settings.delivery_eta_min` que a loja lê (REF-DELIVERY-01) — efeito GLOBAL. Restaura o baseline
   (30) ao final usando a própria UI (já logada como admin) — diferente de store_mode, não precisa de
   um bypass de conexão Postgres direta (a RPC aqui é exercitada pela sessão real do admin, que já
   satisfaz is_admin()). Campo tem `aria-label` real — usável via getByLabel, sem data-testid. */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';

test.describe('Tempo de Entrega (Admin)', { tag: '@writes' }, () => {
  test.describe.configure({ mode: 'serial' }); // delivery_eta_min é GLOBAL

  test('preset + salvar grava o novo valor; valor fora da faixa bloqueia Salvar', async ({ adminLoginPage, adminPanel, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('status');

    const campo = page.getByLabel('Tempo estimado de entrega em minutos');
    const salvarButton = page.getByRole('button', { name: /Salvar/ });

    // useDeliveryEta pinta primeiro pelo CACHE em memória e só depois puxa o valor oficial do
    // servidor (achado real: clicar um preset antes desse 2º carregamento terminar é sobrescrito
    // pelo useEffect que resincroniza `valor` com `etaAtual` assim que ele chega) — espera o valor
    // OFICIAL conhecido (30, confirmado via consulta direta) assentar antes de qualquer interação.
    await expect(page.getByText('Valor atual salvo: 30 minutos')).toBeVisible();

    await page.getByRole('button', { name: '45 min' }).click();
    await expect(salvarButton).toBeEnabled();
    await salvarButton.click();
    await expect(page.getByText('Tempo de entrega salvo: 45 minutos.')).toBeVisible();
    await expect(page.getByText('Valor atual salvo: 45 minutos')).toBeVisible();

    await campo.fill('999'); // fora da faixa (ETA_MAX=180)
    await expect(page.getByText(/Valor inválido/)).toBeVisible();
    await expect(salvarButton).toBeDisabled();

    // restaura o baseline (30) pela própria UI — não deixa o ambiente travado em 45
    await page.getByRole('button', { name: '30 min' }).click();
    await salvarButton.click();
    await expect(page.getByText('Tempo de entrega salvo: 30 minutos.')).toBeVisible();
  });
});
