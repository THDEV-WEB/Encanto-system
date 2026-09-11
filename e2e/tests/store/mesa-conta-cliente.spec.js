/* e2e/tests/store/mesa-conta-cliente.spec.js — REF-MESA-02 · Onda 18 (@writes).
   Cliente vê (só leitura) a conta da própria mesa quando chegou pelo QR real (?mesa_token=). A prova
   de segurança em si (token opaco vs mesa_identificador adivinhável, cross-tenant, anon sem sessão,
   nunca devolve 'alocacoes') já foi feita a nível de RPC em
   scripts/mesa-02-onda18-conta-cliente-leitura-test.mjs (10/10) -- aqui só confirma que a UI real
   (DeliveryBar + MinhaContaMesaModal) produz o resultado certo num navegador de verdade: o link só
   aparece com o token resolvido, e o modal mostra o estado vazio corretamente (sem pedido nenhum
   ainda) quando a sessão nem abriu. */
import { test, expect } from '../../fixtures/index.js';
import { supabaseAdmin } from '../../support/supabaseAdmin.js';
import { desligarMesaConfig, definirMesaConfig } from '../../support/mesaMode.js';
import { limparDadosDeTeste } from '../../support/cleanup.js';

test.describe('Conta da mesa (cliente, só leitura)', { tag: '@writes' }, () => {
  test.afterEach(async () => {
    await limparDadosDeTeste();
    await desligarMesaConfig();
  });

  test('link "Ver conta da mesa" só aparece com token de QR resolvido, e mostra estado vazio', async ({ page }) => {
    const config = await definirMesaConfig({ habilitada: true, canalQr: true });
    test.skip(config.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    const admin = supabaseAdmin();
    const { data: loja } = await admin.from('stores').select('id').eq('slug', 'encanto').single();
    const identificador = `E2E${Date.now() % 100000}`;
    const { data: mesa } = await admin.from('mesas').insert({ store_id: loja.id, identificador }).select('qr_token').single();

    // Sem token na URL: nunca mostra o link (loja tradicional, sem QR nenhum escaneado).
    await page.goto('/encanto/');
    await expect(page.locator('[data-testid="ver-conta-mesa-link"]')).toHaveCount(0);

    // Com o token real resolvido: o link aparece.
    await page.goto(`/encanto/?mesa_token=${mesa.qr_token}`);
    await expect(page.locator('[data-testid="ver-conta-mesa-link"]')).toBeVisible();

    await page.locator('[data-testid="ver-conta-mesa-link"]').click();
    await expect(page.getByText(`Sua conta — Mesa ${identificador}`)).toBeVisible();
    await expect(page.getByText('Nenhum pedido em aberto nesta mesa ainda.')).toBeVisible();

    await admin.from('mesas').delete().eq('store_id', loja.id).eq('identificador', identificador);
  });

  test('token inválido/inexistente nunca aplica o modo mesa nem mostra o link', async ({ page }) => {
    const config = await definirMesaConfig({ habilitada: true, canalQr: true });
    test.skip(config.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    await page.goto('/encanto/?mesa_token=00000000-0000-0000-0000-000000000000');
    await expect(page.locator('[data-testid="ver-conta-mesa-link"]')).toHaveCount(0);
  });
});
