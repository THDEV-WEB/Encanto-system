/* e2e/tests/cliente/fidelidade.spec.js — REF-E2E-02 · Onda 4 (@writes).
   Fidelidade do cliente autenticado, DEPOIS de existir pelo menos 1 pedido real — o único jeito de o
   banner de progresso (e portanto o modal interativo real, `showLoyalty` em StoreApp.jsx) aparecer
   (ver auditoria REF-E2E-02 §Ajuste de escopo: o chip "Programa Fidelidade" sempre visível na home é
   só um alert() de placeholder, nunca abre o modal — nem mesmo no estado de recompensa disponível;
   quem abre o modal é o banner abaixo da barra de entrega, condicionado a `loyaltyCount>0`).
   Cobre 0→1 selo (loyalty_grant, dentro de create_order — ver migrations/REF-LOYALTY-01-loyalty.sql)
   e o resgate (redeem_reward). O 2º teste ARRANJA o ciclo cheio direto no banco (stamps=required) via
   service_role — a acumulação pedido-a-pedido já é provada no 1º teste; criar `required` pedidos reais
   só para chegar no limiar seria caro e não agregaria cobertura nova. O ALVO deste 2º teste é o
   RESGATE em si (RPC + UI), não a acumulação. */
import { test, expect } from '@playwright/test';
import { StorePage } from '../../pages/StorePage.js';
import { contextClienteFixture } from '../../support/authSession.js';
import { garantirClienteFixtureVinculado } from '../../support/fixture-customer.js';
import { criarPedidoFixture } from '../../support/fixture-order.js';
import { limparPedidosDoFixture } from '../../support/cleanup.js';
import { supabaseAdmin, supabaseAnon } from '../../support/supabaseAdmin.js';
import { CLIENTE_FIXTURE } from '../../support/fixture-accounts.js';

test.describe('Fidelidade (cliente autenticado)', { tag: '@writes' }, () => {
  test.describe.configure({ mode: 'serial' }); // muta o ciclo de selos do fixture entre os 2 testes

  test.beforeAll(async () => { await garantirClienteFixtureVinculado(); });
  test.afterEach(async () => { await limparPedidosDoFixture(); }); // devolve o fixture a 0 pedidos/0 selos

  test('depois de 1 pedido, o banner de progresso aparece com 1 selo', async ({ browser, baseURL }) => {
    await criarPedidoFixture();
    const context = await contextClienteFixture(browser, baseURL);
    test.skip(!context, 'ambiente de E2E não configurado (.env.e2e)');

    const page = await context.newPage();
    const storePage = new StorePage(page);
    await storePage.goto();

    const banner = page.getByText(/Fidelidade: 1 de \d+ pedidos/);
    await expect(banner).toBeVisible();
    await banner.click();

    await expect(page.getByText('Você já realizou:')).toBeVisible();

    await context.close();
  });

  test('resgatar a recompensa disponível reinicia o ciclo', async ({ browser, baseURL }) => {
    const context = await contextClienteFixture(browser, baseURL);
    test.skip(!context, 'ambiente de E2E não configurado (.env.e2e)');

    const admin = supabaseAdmin();
    const { data: cliente } = await admin.from('customers').select('id').eq('phone', CLIENTE_FIXTURE.telefone).single();
    const { data: config } = await supabaseAnon().rpc('get_my_loyalty'); // required/discount são públicos (anon)
    const required = config.required;
    await admin.from('loyalty_accounts').upsert({ customer_id: cliente.id, stamps: required }, { onConflict: 'customer_id' });

    const page = await context.newPage();
    const storePage = new StorePage(page);
    await storePage.goto();

    await page.getByText('Você ganhou 50% de desconto! Clique para resgatar.').click();
    await expect(page.getByRole('heading', { name: 'Parabéns!' })).toBeVisible();

    await page.getByRole('button', { name: /Usar desconto agora/ }).click();
    await expect(page.getByRole('heading', { name: 'Parabéns!' })).toBeHidden();

    const { data: contaAtualizada } = await admin.from('loyalty_accounts').select('stamps,rewards_redeemed').eq('customer_id', cliente.id).single();
    expect(contaAtualizada.stamps).toBe(0);
    expect(contaAtualizada.rewards_redeemed).toBeGreaterThan(0);

    await context.close();
  });
});
