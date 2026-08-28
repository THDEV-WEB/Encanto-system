/* e2e/tests/cliente/fidelidade.spec.js — REF-E2E-02 · Onda 4 (@writes).
   Fidelidade do cliente autenticado, DEPOIS de existir pelo menos 1 pedido real — o único jeito de o
   banner de progresso (e portanto o modal interativo real, `showLoyalty` em StoreApp.jsx) aparecer.
   Cobre 0→1 selo (loyalty_grant, dentro de create_order — ver migrations/REF-LOYALTY-01-loyalty.sql)
   e o resgate (redeem_reward). O 2º teste ARRANJA o ciclo cheio direto no banco (stamps=required) via
   service_role — a acumulação pedido-a-pedido já é provada no 1º teste; criar `required` pedidos reais
   só para chegar no limiar seria caro e não agregaria cobertura nova. O ALVO deste 2º teste é o
   RESGATE em si (RPC + UI), não a acumulação.

   REF-LOYALTY-AUDIT-01 · Onda 4 (achado + correção): até aqui, o chip "Programa Fidelidade" (sempre
   visível na home, `StoreHighlights.jsx`) SEMPRE abria um teaser estático "Em breve...", mesmo com
   cadastro/progresso/recompensa reais — nunca consultava `useLoyalty()`. Corrigido em `StoreApp.jsx`
   (`onLoyalty` do `StoreHighlights`): com cadastro E programa ativo, abre o modal REAL (mesmo que o
   banner de progresso já abre); sem cadastro ou com o programa desativado, mantém o teaser (nada real
   pra mostrar). O 2º describe abaixo prova os 4 cenários dessa correção. */
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

/* REF-LOYALTY-AUDIT-01 · Onda 4 — chip "Programa Fidelidade" (StoreHighlights, sempre visível na
   home) agora consulta o estado real em vez de sempre abrir o teaser "Em breve...". `workers:1` neste
   projeto (playwright.config.js) garante que nenhum outro spec roda ao mesmo tempo que o teste D
   desativa a loja inteira -- por isso não precisa de loja E2E descartável própria (mesmo padrão já
   aceito por admin-status.spec.js pra `store_mode`, que também é por-loja mas mexe na Encanto do
   projeto E2E diretamente). */
test.describe('Fidelidade — chip "Programa Fidelidade" reflete o estado real', { tag: '@writes' }, () => {
  test.describe.configure({ mode: 'serial' }); // teste D desativa a loja inteira -- nunca em paralelo com os outros

  test.beforeAll(async () => { await garantirClienteFixtureVinculado(); });
  test.afterEach(async () => { await limparPedidosDoFixture(); });

  test('A) cliente logado, programa ativo, SEM selo ainda -> clique no chip abre o modal REAL (nao o teaser)', async ({ browser, baseURL }) => {
    const context = await contextClienteFixture(browser, baseURL);
    test.skip(!context, 'ambiente de E2E não configurado (.env.e2e)');

    const page = await context.newPage();
    const storePage = new StorePage(page);
    await storePage.goto();

    // 0 selos -> o banner de progresso NAO aparece (exige loyaltyCount>0); o chip do StoreHighlights
    // e' a UNICA porta de entrada visivel neste estado -- exatamente o cenario que expunha o bug. O
    // rotulo do chip ("Programa Fidelidade") e' IGUAL antes/depois de temCadastro resolver (ao
    // contrario do teste B, onde o proprio rotulo so vira "Recompensa disponível!" apos a config real
    // chegar) -- por isso o clique precisa de retry ate a 1a chamada de useLoyalty() assentar.
    await expect(page.getByText(/Fidelidade: \d+ de \d+ pedidos/)).toHaveCount(0);
    await expect(async () => {
      const okTeaser = page.getByRole('button', { name: 'OK' });
      if (await okTeaser.isVisible().catch(() => false)) await okTeaser.click();
      await page.getByRole('button', { name: 'Programa Fidelidade' }).click();
      await expect(page.getByText('Você já realizou:')).toBeVisible({ timeout: 1000 }); // modal REAL de progresso
    }).toPass({ timeout: 10000 });
    await expect(page.getByText('Em breve teremos novidades', { exact: false })).toHaveCount(0);

    await context.close();
  });

  test('B) cliente logado, recompensa disponivel -> chip mostra "Recompensa disponível!" e abre o modal REAL com resgate', async ({ browser, baseURL }) => {
    const context = await contextClienteFixture(browser, baseURL);
    test.skip(!context, 'ambiente de E2E não configurado (.env.e2e)');

    const admin = supabaseAdmin();
    const { data: cliente } = await admin.from('customers').select('id').eq('phone', CLIENTE_FIXTURE.telefone).single();
    const { data: config } = await supabaseAnon().rpc('get_my_loyalty');
    await admin.from('loyalty_accounts').upsert({ customer_id: cliente.id, stamps: config.required }, { onConflict: 'customer_id' });

    const page = await context.newPage();
    const storePage = new StorePage(page);
    await storePage.goto();

    const chip = page.getByRole('button', { name: 'Recompensa disponível!' });
    await expect(chip).toBeVisible();
    await chip.click();

    await expect(page.getByRole('heading', { name: 'Parabéns!' })).toBeVisible(); // modal REAL, resgate disponivel
    await expect(page.getByText('Em breve teremos novidades', { exact: false })).toHaveCount(0);

    await context.close();
  });

  test('C) visitante NAO logado -> chip continua abrindo o teaser (nada real pra mostrar)', async ({ page, baseURL }) => {
    const storePage = new StorePage(page);
    await storePage.goto();

    await page.getByRole('button', { name: 'Programa Fidelidade' }).click();
    await expect(page.getByText('Em breve teremos novidades', { exact: false })).toBeVisible();
  });

  test('D) programa DESATIVADO -> chip continua abrindo o teaser mesmo com cliente logado', async ({ browser, baseURL }) => {
    const context = await contextClienteFixture(browser, baseURL);
    test.skip(!context, 'ambiente de E2E não configurado (.env.e2e)');

    const admin = supabaseAdmin();
    const { data: loja } = await admin.from('stores').select('id').eq('slug', 'encanto').single();
    await admin.from('store_settings').update({ valor: 'false' }).eq('store_id', loja.id).eq('chave', 'loyalty_enabled');
    try {
      const page = await context.newPage();
      const storePage = new StorePage(page);
      await storePage.goto();

      await page.getByRole('button', { name: 'Programa Fidelidade' }).click();
      await expect(page.getByText('Em breve teremos novidades', { exact: false })).toBeVisible();
    } finally {
      // restaura ANTES de fechar o context, nunca deixa a loja E2E presa em desativada por um teste falho
      await admin.from('store_settings').update({ valor: 'true' }).eq('store_id', loja.id).eq('chave', 'loyalty_enabled');
      await context.close();
    }
  });
});
