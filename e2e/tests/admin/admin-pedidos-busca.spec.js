/* e2e/tests/admin/admin-pedidos-busca.spec.js — REF-ADMIN-02 · Onda 3 (@writes).
   Achado (auditoria REF-ADMIN-02): busca/filtro na aba Pedidos (AdminPedidos.jsx) nunca existiram —
   não é um bug de comportamento incorreto, é ausência de funcionalidade (confirmado por leitura do
   componente atual e do histórico via git log/show, inclusive antes da extração REF-APP-01 · Onda 7.2).
   Fix: filtro client-side sobre a lista já carregada por useOrders (zero consulta nova) — busca
   tolerante a acento/caixa/parcial (utils/searchText, mesmo motor da busca da loja) por nome/telefone
   do cliente, uuid completo, ref curta (8 chars) e número sequencial do pedido; filtro por status
   (dropdown); ambos combináveis (AND). */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { criarPedidoAvulso } from '../../support/fixture-order.js';
import { limparDadosDeTeste } from '../../support/cleanup.js';
import { supabaseAdmin, E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';

test.describe('busca e filtro de Pedidos (fix REF-ADMIN-02 · Onda 3)', { tag: '@writes' }, () => {
  test.afterEach(async () => { await limparDadosDeTeste(); });

  test('busca por telefone mostra só o pedido correspondente', async ({ adminLoginPage, adminPanel, adminPedidosPage }) => {
    const pedidoA = await criarPedidoAvulso();
    test.skip(pedidoA.skipped, 'ambiente de E2E não configurado (.env.e2e)');
    const pedidoB = await criarPedidoAvulso();

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('pedidos');
    await expect(adminPedidosPage.card(pedidoA.orderId)).toBeVisible();
    await expect(adminPedidosPage.card(pedidoB.orderId)).toBeVisible();

    // pedidoA e pedidoB compartilham o MESMO nome (E2E_TEST_Avulso) — só o telefone os diferencia,
    // provando que a busca de fato olha o telefone (não só o nome).
    await adminPedidosPage.buscar(pedidoA.telefone);
    await expect(adminPedidosPage.card(pedidoA.orderId)).toBeVisible();
    await expect(adminPedidosPage.card(pedidoB.orderId)).toHaveCount(0);
  });

  test('busca pela ref do pedido (8 chars do id) mostra só aquele pedido', async ({ adminLoginPage, adminPanel, adminPedidosPage }) => {
    const pedidoA = await criarPedidoAvulso();
    test.skip(pedidoA.skipped, 'ambiente de E2E não configurado (.env.e2e)');
    const pedidoB = await criarPedidoAvulso();

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('pedidos');

    const refA = pedidoA.orderId.replace(/-/g, '').slice(0, 8);
    await adminPedidosPage.buscar(refA);
    await expect(adminPedidosPage.card(pedidoA.orderId)).toBeVisible();
    await expect(adminPedidosPage.card(pedidoB.orderId)).toHaveCount(0);
  });

  test('busca por nome do cliente filtra a lista, e sem match mostra estado vazio', async ({ adminLoginPage, adminPanel, adminPedidosPage, page }) => {
    const pedido = await criarPedidoAvulso();
    test.skip(pedido.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('pedidos');

    await adminPedidosPage.buscar('avulso'); // minúsculo/parcial — tolerante a caixa (o nome real é "E2E_TEST_Avulso")
    await expect(adminPedidosPage.card(pedido.orderId)).toBeVisible();

    await adminPedidosPage.buscar('zzz_nao_existe_zzz');
    await expect(adminPedidosPage.card(pedido.orderId)).toHaveCount(0);
    await expect(page.getByText('Nenhum pedido encontrado com esses filtros')).toBeVisible();
  });

  test('filtro por status mostra só pedidos daquele status', async ({ adminLoginPage, adminPanel, adminPedidosPage }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    const pedidoA = await criarPedidoAvulso(); // fica 'recebido'
    const pedidoB = await criarPedidoAvulso();
    await supabaseAdmin().from('orders').update({ status: 'preparo' }).eq('id', pedidoB.orderId);

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('pedidos');

    await adminPedidosPage.filtrarPorStatus('preparo');
    await expect(adminPedidosPage.card(pedidoB.orderId)).toBeVisible();
    await expect(adminPedidosPage.card(pedidoA.orderId)).toHaveCount(0);
  });

  test('busca e filtro de status combinados (AND)', async ({ adminLoginPage, adminPanel, adminPedidosPage }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    const pedidoA = await criarPedidoAvulso();
    const pedidoB = await criarPedidoAvulso(); // fica 'recebido'
    await supabaseAdmin().from('orders').update({ status: 'preparo' }).eq('id', pedidoA.orderId);

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('pedidos');

    await adminPedidosPage.filtrarPorStatus('preparo');
    await adminPedidosPage.buscar(pedidoA.telefone);
    await expect(adminPedidosPage.card(pedidoA.orderId)).toBeVisible();
    await expect(adminPedidosPage.card(pedidoB.orderId)).toHaveCount(0);

    // troca a busca para o telefone do B: nome/telefone bateriam, mas o status ('recebido') não —
    // prova que os 2 filtros são combinados com AND, não OR.
    await adminPedidosPage.buscar(pedidoB.telefone);
    await expect(adminPedidosPage.card(pedidoB.orderId)).toHaveCount(0);
  });

  test('limpar a busca volta a mostrar todos os pedidos (sem regressão)', async ({ adminLoginPage, adminPanel, adminPedidosPage }) => {
    const pedido = await criarPedidoAvulso();
    test.skip(pedido.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('pedidos');
    await expect(adminPedidosPage.card(pedido.orderId)).toBeVisible();

    await adminPedidosPage.buscar('zzz_nao_existe_zzz');
    await expect(adminPedidosPage.card(pedido.orderId)).toHaveCount(0);

    await adminPedidosPage.buscar('');
    await expect(adminPedidosPage.card(pedido.orderId)).toBeVisible();
  });
});
