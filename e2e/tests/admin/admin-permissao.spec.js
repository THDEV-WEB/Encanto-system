/* e2e/tests/admin/admin-permissao.spec.js — REF-E2E-03 · Onda 1, parte 1 (@writes).
   Achado real da auditoria (ADR §1.2): NÃO existe verificação de is_admin() no cliente — qualquer
   usuário autenticado do Supabase chega à UI inteira do Admin; só os DADOS são protegidos por RLS.
   Reaproveita CLIENTE_FIXTURE (E2E-02, decisão ADR §7.2) como a conta "autenticada, sem admin" — ele
   nunca está em public.admins, zero conta nova. Para provar o bloqueio de verdade (não uma tela vazia
   por acaso, sem nada a esconder), cria-se 1 pedido "avulso" de OUTRO cliente antes do teste: se este
   login herdasse acesso de admin, o Dashboard mostraria esse pedido; o teste prova que ele continua
   invisível. Parte 2 (escrita bloqueada por RLS, usuário anônimo, matriz completa do §1.9) fica para
   a Onda 6 — ver ADR §6. */
import { test, expect } from '../../fixtures/index.js';
import { CLIENTE_FIXTURE } from '../../support/fixture-accounts.js';
import { criarPedidoAvulso } from '../../support/fixture-order.js';
import { limparDadosDeTeste } from '../../support/cleanup.js';

test.describe('permissão — autenticado sem is_admin() (parte 1: leitura)', { tag: '@writes' }, () => {
  test.afterEach(async () => { await limparDadosDeTeste(); });

  test('CLIENTE_FIXTURE chega na UI do Admin, mas não vê pedidos de outros clientes', async ({ adminLoginPage, adminPanel, page }) => {
    const pedido = await criarPedidoAvulso();
    test.skip(pedido.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    await adminLoginPage.goto();
    await adminLoginPage.login(CLIENTE_FIXTURE.email, CLIENTE_FIXTURE.senha);

    // Sem gate de is_admin() no cliente — a UI inteira renderiza (achado real, não um bloqueio inexistente).
    await expect(adminPanel.tab('dashboard')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // A garantia real está nos dados: o pedido avulso existe de verdade no backend, mas a RLS o esconde.
    await expect(page.getByText('Nenhum pedido')).toBeVisible();
  });
});
