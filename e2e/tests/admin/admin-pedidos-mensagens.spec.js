/* e2e/tests/admin/admin-pedidos-mensagens.spec.js — REF-E2E-03 · Onda 2 (@writes).
   PedidoNotificacoes.jsx é só leitura: mostra, por status da trilha, a MENSAGEM renderizada (fonte
   única messageTemplates.js) + o ESTADO real da fila (notification_outbox). A migration REF-ORDER-01-
   order-ops.sql (trigger trg_enc_order_notify) faz parte do schema public, clonado no projeto de E2E —
   então o ENFILEIRAMENTO acontece de verdade aqui; só o DISPARO real (pg_net + pg_cron + Vault, fora
   do schema public) está ausente (ver ADR §1.4/§1.10) — nunca sai uma mensagem de verdade. O teste
   prova a prévia da copy + o estado real "na fila", nunca um envio. */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { criarPedidoAvulso } from '../../support/fixture-order.js';
import { limparDadosDeTeste } from '../../support/cleanup.js';

test.describe('mensagens automáticas do Pedido (prévia, sem envio real)', { tag: '@writes' }, () => {
  test.afterEach(async () => { await limparDadosDeTeste(); });

  test('mostra a mensagem renderizada e o estado real da fila para o status atual', async ({ adminLoginPage, adminPanel, adminPedidosPage, page }) => {
    const pedido = await criarPedidoAvulso();
    test.skip(pedido.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('pedidos');
    await adminPedidosPage.abrirMensagens(pedido.orderId);

    const mensagens = page.locator('[data-testid="pedido-mensagens"]');
    await expect(mensagens.getByText('Mensagens automáticas (WhatsApp)')).toBeVisible();
    await expect(mensagens.getByText(/Recebemos seu pedido/)).toBeVisible();
    await expect(mensagens.getByText('⏳ na fila')).toBeVisible(); // enfileirado de verdade pelo trigger; nunca "✅ enviado" neste ambiente
  });
});
