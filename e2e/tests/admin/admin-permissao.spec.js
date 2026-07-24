/* e2e/tests/admin/admin-permissao.spec.js — REF-E2E-03 · Onda 1, parte 1 (@writes).
   Achado real da auditoria (ADR §1.2): NÃO existe verificação de is_admin() no cliente — qualquer
   usuário autenticado do Supabase chega à UI inteira do Admin; só os DADOS são protegidos por RLS.
   Reaproveita CLIENTE_FIXTURE (E2E-02, decisão ADR §7.2) como a conta "autenticada, sem admin" — ele
   nunca está em public.admins, zero conta nova. Para provar o bloqueio de verdade (não uma tela vazia
   por acaso, sem nada a esconder), cria-se 1 pedido "avulso" de OUTRO cliente antes do teste: se este
   login herdasse acesso de admin, o Dashboard mostraria esse pedido; o teste prova que ele continua
   invisível.

   Parte 2 (abaixo): escrita bloqueada por RLS para um usuário ANÔNIMO — a matriz completa do §1.9 já
   é exaustivamente provada pelos guards de domínio (`test:auth-rls`/`test:orders-rls`/`test:rls`,
   via SET LOCAL ROLE + BEGIN/ROLLBACK direto no Postgres), mas contra o banco de PRODUÇÃO, nunca o
   projeto `encanto-e2e`. Esta parte não duplica essa exaustão — é uma confirmação REPRESENTATIVA
   (poucas tabelas/RPCs, não a matriz inteira) de que o clone de schema preservou as MESMAS proteções
   no projeto de E2E, usando o client `anon` real (supabase-js), a mesma técnica de qualquer visitante
   anônimo do site — não simulação de role via SQL cru. */
import { test, expect } from '../../fixtures/index.js';
import { CLIENTE_FIXTURE } from '../../support/fixture-accounts.js';
import { criarPedidoAvulso } from '../../support/fixture-order.js';
import { limparDadosDeTeste } from '../../support/cleanup.js';
import { supabaseAnon, E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';

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

test.describe('permissão — usuário anônimo (parte 2: escrita bloqueada por RLS)', { tag: '@writes' }, () => {
  test('anon não escreve catálogo, não lê a fila de notificações e não chama RPC de admin — no projeto de E2E', async () => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    const anon = supabaseAnon();

    const { error: errProd } = await anon.from('products').insert({ nome: 'E2E_TEST_RLS_Anon', preco: 1 });
    expect(errProd, 'anon deveria ser bloqueado ao inserir em products').toBeTruthy();

    const { error: errCat } = await anon.from('categories').insert({ id: `e2e-test-rls-anon-${Date.now()}`, nome: 'X', slug: `e2e-test-rls-anon-${Date.now()}`, tipo: 'business' });
    expect(errCat, 'anon deveria ser bloqueado ao inserir em categories').toBeTruthy();

    // notification_outbox tem RLS habilitada com UMA política (`notification_outbox_admin_read`,
    // USING is_admin()) mas o GRANT de SELECT da tabela em si nunca foi revogado do anon (diferente
    // das 3 RPCs de notificação, endurecidas à parte em REF-ORDER-01c) — então a chamada NÃO retorna
    // erro, a RLS filtra silenciosamente para ZERO linhas visíveis (achado real, não assumido).
    const { data: outbox, error: errOutbox } = await anon.from('notification_outbox').select('id').limit(1);
    expect(errOutbox).toBeNull();
    expect(outbox, 'RLS deveria filtrar notification_outbox para 0 linhas visíveis ao anon').toEqual([]);

    const { data: rpcData, error: errRpc } = await anon.rpc('set_store_mode', { p_mode: 'CLOSED' });
    expect(errRpc || rpcData === null, 'anon não deveria conseguir chamar set_store_mode (EXECUTE revogado)').toBeTruthy();
  });
});
