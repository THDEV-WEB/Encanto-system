/* e2e/tests/admin/admin-fidelidade.spec.js — REF-E2E-03 · Onda 5 (@writes).
   AdminFidelidade.jsx: visão do OPERADOR (complementa, não duplica, a fidelidade do CLIENTE já testada
   na E2E-02 — aqui o ângulo é o admin consultando/ajustando a conta de outro cliente). 3 sub-painéis:
   (a) toggle Ativo/Desativado do programa; (b) busca + ajuste manual (±1 selo) + resgate administrativo
   de UM cliente (admin_find_loyalty/admin_adjust_loyalty/redeem_reward); (c) config POR LOJA
   (required/discount via set_loyalty_config, `store_settings` desde REF-LOYALTY-AUDIT-01 · Onda 1 —
   antes era `settings.loyalty_*`, global à plataforma) — o baseline observado no início (não um valor
   fixo assumido) é restaurado ao final, mesmo já sendo por loja (evita colisão entre execuções). Reaproveita
   CLIENTE_FIXTURE (E2E-02) — cria 1 pedido real via `criarPedidoFixture()` para garantir 1 selo
   determinístico (não depende de estado ambiente). */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE, CLIENTE_FIXTURE } from '../../support/fixture-accounts.js';
import { garantirClienteFixtureVinculado } from '../../support/fixture-customer.js';
import { criarPedidoFixture } from '../../support/fixture-order.js';
import { limparPedidosDoFixture } from '../../support/cleanup.js';
import { E2E_ENV_PRONTO, supabaseAdmin, idDoAdminFixture } from '../../support/supabaseAdmin.js';

test.describe('Fidelidade — visão do Admin', { tag: '@writes' }, () => {
  test.describe.configure({ mode: 'serial' }); // config do programa (required/discount) e' por loja, mas as 2 specs aqui miram a MESMA loja (encanto)

  test.beforeAll(async () => { await garantirClienteFixtureVinculado(); });
  test.afterEach(async () => { await limparPedidosDoFixture(); });

  test('busca/ajusta/resgata um cliente e edita a config do programa (restaura o baseline)', async ({ adminLoginPage, adminPanel, adminFidelidadePage, page }) => {
    const pedido = await criarPedidoFixture(); // 1 pedido real -> 1 selo concedido pelo trigger
    test.skip(pedido.skipped, 'ambiente de E2E não configurado (.env.e2e)');

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('fidelidade');

    // Baseline OBSERVADO (não assumido) — restaurado ao final, pois required/discount são GLOBAIS.
    const regra = await page.getByText(/^Regra: \d+ pedidos = \d+% de desconto/).textContent();
    const [, requiredBaseline, discountBaseline] = regra.match(/Regra: (\d+) pedidos = (\d+)%/);

    // ── Busca + ajuste manual ──
    await adminFidelidadePage.buscar(CLIENTE_FIXTURE.telefone);
    await expect(page.getByText(CLIENTE_FIXTURE.nome)).toBeVisible();
    await expect(page.getByText(/^1\s*\/\s*\d+\s*pedidos/)).toBeVisible(); // 1 selo do pedido recém-criado

    await adminFidelidadePage.maisSeloButton.click();
    await expect(page.getByText(/^2\s*\/\s*\d+\s*pedidos/)).toBeVisible();

    await adminFidelidadePage.menosSeloButton.click();
    await expect(page.getByText(/^1\s*\/\s*\d+\s*pedidos/)).toBeVisible();

    // ── Config: abaixa "Pedidos p/ recompensa" para 1 (temporário) -> recompensa fica disponível.
    //    `cliente.required` fica congelado no momento da BUSCA (admin_find_loyalty) — mudar a config
    //    não atualiza retroativamente o resultado já exibido; refazer a busca é o que reflete
    //    o novo threshold (achado real, não assunção). ──
    await adminFidelidadePage.salvarConfig({ required: 1 });
    await expect(page.getByText('✓ Salvo com sucesso!')).toBeVisible();
    await adminFidelidadePage.buscar(CLIENTE_FIXTURE.telefone);
    await expect(page.getByText('🎁 Recompensa disponível')).toBeVisible();

    // ── Resgate administrativo ──
    await adminFidelidadePage.resgatarButton.click();
    await expect(page.getByText(/Faltam 1 pedido/)).toBeVisible(); // ciclo reiniciado (stamps -= required)

    // ── Restaura o baseline observado no início ──
    await adminFidelidadePage.salvarConfig({ required: requiredBaseline, discount: discountBaseline });
    await expect(page.getByText('✓ Salvo com sucesso!')).toBeVisible();
    await expect(page.getByText(new RegExp(`Regra: ${requiredBaseline} pedidos = ${discountBaseline}% de desconto`))).toBeVisible();
  });

  test('toggle Ativo/Desativado grava e reflete no rótulo', async ({ adminLoginPage, adminPanel, adminFidelidadePage, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('fidelidade');

    // Lê o valor REAL persistido (store_settings.loyalty_enabled DA LOJA ENCANTO, desde
    // REF-LOYALTY-AUDIT-01 · Onda 1 — antes era settings.loyalty_enabled, global), não só o rótulo da
    // UI — achado real (REF-CI-01, ver docs/ref/REF-CI-01-progress.md): a UI atualizava o rótulo de
    // forma otimista mesmo quando o `set_loyalty_config` falhava, deixando o programa preso em "false"
    // no banco enquanto a suíte inteira reportava verde. Cada asserção abaixo confirma o banco, não a tela.
    const admin = supabaseAdmin();
    const { data: loja } = await admin.from('stores').select('id').eq('slug', 'encanto').single();
    const lerValorReal = async () => {
      const { data } = await admin.from('store_settings').select('valor').eq('store_id', loja.id).eq('chave', 'loyalty_enabled').single();
      return data.valor !== 'false';
    };

    const estavaAtivo = await adminFidelidadePage.enabledCheckbox.isChecked();
    await expect.poll(lerValorReal).toBe(estavaAtivo);

    // O rótulo muda de forma OTIMISTA, na hora do clique — mas o RPC de save é assíncrono. Esperar
    // "✓ Salvo com sucesso!" reduz a corrida, mas não a elimina (o cliente já viu a resposta antes de
    // ela ficar visível para OUTRA conexão/cliente lendo o mesmo banco — achado real em CI: 1ª tentativa
    // flakou aqui). expect.poll (já usado em admin-status.spec.js para o mesmo tipo de checagem)
    // absorve essa folga sem reintroduzir a corrida com um timeout fixo arbitrário.
    await adminFidelidadePage.enabledToggleClicavel.click();
    await expect(page.getByText('✓ Salvo com sucesso!')).toBeVisible();
    await expect(page.getByText(estavaAtivo ? '○ Desativado' : '● Ativo')).toBeVisible();
    await expect.poll(lerValorReal).toBe(!estavaAtivo);

    // REF-LOYALTY-AUDIT-01 · Onda 3 (Fase 3-E): recarregar a pagina -- a UI busca o estado do BACKEND
    // de novo (adminLerConfig no mount), nunca confia em cache local/estado React perdido no reload.
    // Reload sempre volta pro login (REF-STABILITY-02) -- reaproveita a sessao real ja aberta.
    await page.reload();
    await adminLoginPage.entrarReaproveitandoSessao();
    await adminPanel.abrirAba('fidelidade');
    await expect(page.getByText(estavaAtivo ? '○ Desativado' : '● Ativo')).toBeVisible();

    // restaura o estado original
    await adminFidelidadePage.enabledToggleClicavel.click();
    await expect(page.getByText('✓ Salvo com sucesso!')).toBeVisible();
    await expect(page.getByText(estavaAtivo ? '● Ativo' : '○ Desativado')).toBeVisible();
    await expect.poll(lerValorReal).toBe(estavaAtivo);
  });
});

/* REF-LOYALTY-AUDIT-01 · Onda 2 — prova E2E, pela UI REAL (nao so RPC direto como a Onda 1 ja fez em
   scripts/loyalty-audit-01-onda1-test.mjs), de que trocar de loja no seletor do Admin (Onda 5 da
   REF-SAAS-01) reflete a config de fidelidade DA LOJA CERTA, e que configurar uma loja nunca vaza pra
   outra. Mesmo mecanismo de provisionamento/troca de e2e/tests/admin/platform-console.spec.js (super
   admin cria loja descartavel via Platform Console, "Abrir Admin" troca de contexto, seletor
   `admin-store-selector` alterna entre as lojas que o admin de fato administra). */
test.describe('Fidelidade — isolamento por loja via troca real de contexto no Admin', { tag: '@writes' }, () => {
  const SLUG = 'loja-fidelidade-onda2-e2e';
  const NOME = 'Loja Fidelidade Onda 2 (E2E)';
  let adminUserId = null;

  async function limparLojaDeTeste(admin) {
    const { data: loja } = await admin.from('stores').select('id').eq('slug', SLUG).maybeSingle();
    if (loja) {
      await admin.from('admins').delete().eq('store_id', loja.id);
      await admin.from('store_settings').delete().eq('store_id', loja.id);
      await admin.from('stores').delete().eq('id', loja.id);
    }
  }

  test.beforeEach(async () => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    const admin = supabaseAdmin();
    adminUserId = await idDoAdminFixture();
    await limparLojaDeTeste(admin); // sobra de uma run anterior interrompida, se houver
    // super_admins TEMPORARIO -- so no projeto de E2E, nunca em producao (mesmo padrao de platform-console.spec.js).
    await admin.from('super_admins').upsert({ user_id: adminUserId }, { onConflict: 'user_id' });
  });

  test.afterEach(async () => {
    if (!E2E_ENV_PRONTO) return;
    const admin = supabaseAdmin();
    await limparLojaDeTeste(admin);
    if (adminUserId) await admin.from('super_admins').delete().eq('user_id', adminUserId);
  });

  test('loja nova nasce com fidelidade desativada (default seguro); configurar ela nao afeta a Encanto; trocar de loja pela UI mostra sempre o valor certo', async ({ adminLoginPage, platformConsole, adminPanel, adminFidelidadePage, page }) => {
    const admin = supabaseAdmin();

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await platformConsole.abrirAba('lojas');
    await platformConsole.preencherNovaLoja({ nome: NOME, slug: SLUG });
    await platformConsole.criarLoja();
    await expect(page.getByText(`Loja "${NOME}" criada.`)).toBeVisible();
    await platformConsole.abrirDetalhe(SLUG);
    await platformConsole.vincularAdmin(SLUG, ADMIN_FIXTURE.email);
    await expect(page.getByText(`${ADMIN_FIXTURE.email} agora é admin desta loja.`)).toBeVisible();

    const { data: lojaNova } = await admin.from('stores').select('id').eq('slug', SLUG).single();
    const { data: encanto } = await admin.from('stores').select('id').eq('slug', 'encanto').single();

    // "Abrir Admin da loja" entra direto no Admin da loja NOVA (contexto ja trocado).
    await page.getByTestId(`plataforma-abrir-admin-${SLUG}`).click();
    await expect(adminPanel.tab('dashboard')).toBeVisible();

    const lerStatus = async () => (await page.getByText('● Ativo').isVisible()) ? '● Ativo' : '○ Desativado';
    const lerRegra = async () => (await page.getByText(/^Regra: \d+ pedidos = \d+% de desconto/).textContent()).trim();
    // adminLerConfig() e assincrono (fetch da config POR LOJA no mount) -- cada troca de loja remonta
    // AdminFidelidade (key={activeStoreId}) e reinicia com os defaults 10/50/enabled ate a resposta
    // chegar. Ler/editar ANTES disso resolver corre risco real de sobrescrever com o default (leitura)
    // ou de o fetch tardio pisar por cima do que acabou de ser digitado (escrita) -- esperar o botao
    // "Salvar configuracoes" ficar habilitado (disabled={cfgLoad}) fecha essa corrida nos dois sentidos.
    const aguardarConfigCarregada = () => expect(adminFidelidadePage.salvarConfigButton).toBeEnabled();

    // Loja nunca configurada -- default seguro (REF-LOYALTY-AUDIT-01 · Onda 1): DESATIVADA, 10/50%.
    await adminPanel.abrirAba('fidelidade');
    await aguardarConfigCarregada();
    await expect(page.getByText('○ Desativado')).toBeVisible();
    await expect(page.getByText(/^Regra: 10 pedidos = 50% de desconto/)).toBeVisible();

    // Seletor aparece (2 vinculos reais agora: encanto + loja nova) -- captura o baseline REAL da
    // Encanto, sem assumir valor (outras specs deste arquivo mexem nele).
    const seletor = page.getByTestId('admin-store-selector');
    await expect(seletor).toBeVisible();
    await seletor.selectOption({ value: encanto.id });
    await adminPanel.abrirAba('fidelidade');
    await aguardarConfigCarregada();
    const statusEncantoAntes = await lerStatus();
    const regraEncantoAntes = await lerRegra();

    // Volta pra loja nova, liga o programa com valores BEM diferentes de qualquer coisa plausivel na Encanto.
    await seletor.selectOption({ value: lojaNova.id });
    await adminPanel.abrirAba('fidelidade');
    await aguardarConfigCarregada();
    // 2 saves em sequencia (required/discount, depois o toggle) -- espera o 1o RPC assentar antes do
    // 2o clique, senao as 2 chamadas a set_loyalty_config podem resolver fora de ordem e o 2o (que so
    // muda `enabled`) chegar ANTES do 1o, que o sobrescreveria de volta pra `enabled:false`.
    await adminFidelidadePage.salvarConfig({ required: 3, discount: 77 });
    await expect(page.getByText('✓ Salvo com sucesso!')).toBeVisible();
    await adminFidelidadePage.enabledToggleClicavel.click();
    await expect(page.getByText('✓ Salvo com sucesso!')).toBeVisible();
    await expect(page.getByText('● Ativo')).toBeVisible();
    await expect(page.getByText(/^Regra: 3 pedidos = 77% de desconto/)).toBeVisible();

    // Confirma no BANCO (nao so na tela) que gravou store_settings da loja CERTA. O rotulo muda
    // OTIMISTA no clique, mas o RPC de save e assincrono (mesmo achado documentado no teste de toggle
    // acima) -- expect.poll fecha essa corrida sem depender de timeout fixo.
    const lerConfigReal = async () => {
      const { data } = await admin.from('store_settings').select('chave, valor')
        .eq('store_id', lojaNova.id).in('chave', ['loyalty_enabled', 'loyalty_required', 'loyalty_discount']);
      return Object.fromEntries(data.map((r) => [r.chave, r.valor]));
    };
    await expect.poll(async () => (await lerConfigReal()).loyalty_enabled).toBe('true');
    const mapa = await lerConfigReal();
    expect(mapa.loyalty_required).toBe('3');
    expect(mapa.loyalty_discount).toBe('77');

    // Troca pra Encanto pela UI -- tem que mostrar o baseline ORIGINAL, NUNCA o 3/77%/Ativo da loja nova.
    await seletor.selectOption({ value: encanto.id });
    await adminPanel.abrirAba('fidelidade');
    await aguardarConfigCarregada();
    await expect(page.getByText(/^Regra: 3 pedidos = 77% de desconto/)).toHaveCount(0);
    expect(await lerStatus()).toBe(statusEncantoAntes);
    expect(await lerRegra()).toBe(regraEncantoAntes);

    // Volta pra loja nova -- o valor configurado la CONTINUA intacto (a troca de contexto nunca reseta).
    await seletor.selectOption({ value: lojaNova.id });
    await adminPanel.abrirAba('fidelidade');
    await aguardarConfigCarregada();
    await expect(page.getByText(/^Regra: 3 pedidos = 77% de desconto/)).toBeVisible();
    await expect(page.getByText('● Ativo')).toBeVisible();
  });

  /* REF-LOYALTY-AUDIT-01 · Onda 3 — reproducao controlada do achado incidental da Onda 2: "Salvar
     configurações" (botão) e o toggle Ativo/Desativado disparavam 2 chamadas INDEPENDENTES a
     set_loyalty_config; disparadas em sequência rápida, as respostas podiam chegar fora de ordem e a
     mais lenta sobrescrevia a mais rápida (banco divergia do que a tela mostrava). Corrigido em
     AdminFidelidade.jsx com uma guarda de reentrância (`cfgSaving`): nenhum dos 2 controles dispara um
     novo save enquanto o anterior está em voo. Este teste atrasa DE PROPÓSITO a resposta do 1º save
     (page.route) pra abrir a mesma janela real que causava a corrupção, e prova que a guarda torna um
     2º save concorrente fisicamente impossível pela UI. */
  test('corrida de saves: 2 ações rápidas (Salvar configurações + toggle) nunca produzem estado incorreto -- a 2ª fica bloqueada até a 1ª assentar', async ({ adminLoginPage, platformConsole, adminPanel, adminFidelidadePage, page }) => {
    const admin = supabaseAdmin();

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await platformConsole.abrirAba('lojas');
    await platformConsole.preencherNovaLoja({ nome: NOME, slug: SLUG });
    await platformConsole.criarLoja();
    await expect(page.getByText(`Loja "${NOME}" criada.`)).toBeVisible();
    await platformConsole.abrirDetalhe(SLUG);
    await platformConsole.vincularAdmin(SLUG, ADMIN_FIXTURE.email);
    await expect(page.getByText(`${ADMIN_FIXTURE.email} agora é admin desta loja.`)).toBeVisible();

    const { data: lojaNova } = await admin.from('stores').select('id').eq('slug', SLUG).single();

    await page.getByTestId(`plataforma-abrir-admin-${SLUG}`).click();
    await expect(adminPanel.tab('dashboard')).toBeVisible();
    await adminPanel.abrirAba('fidelidade');
    await expect(adminFidelidadePage.salvarConfigButton).toBeEnabled(); // config inicial (default) ja carregada

    // Atrasa DE PROPOSITO a resposta do 1o (e so o 1o) POST a set_loyalty_config -- abre uma janela
    // real onde um 2o clique dispararia um request concorrente se a guarda nao existisse.
    let interceptado = false;
    await page.route('**/rest/v1/rpc/set_loyalty_config**', async (route) => {
      if (!interceptado) { interceptado = true; await new Promise((r) => setTimeout(r, 1500)); }
      await route.continue();
    });

    await adminFidelidadePage.requiredInput.fill('5');
    await adminFidelidadePage.discountInput.fill('60');
    await adminFidelidadePage.salvarConfigButton.click(); // dispara o 1o save (atrasado 1.5s pelo intercept)

    // Enquanto o 1o save esta em voo, os 2 controles ficam bloqueados -- prova central desta onda:
    // fisicamente impossivel disparar um 2o save concorrente pela UI.
    await expect(adminFidelidadePage.salvarConfigButton).toBeDisabled();
    await expect(adminFidelidadePage.enabledCheckbox).toBeDisabled();
    await expect(page.getByText('Salvando…')).toBeVisible();

    // Assenta (apos o atraso) -- controles liberam, config gravou com os valores certos.
    await expect(page.getByText('✓ Salvo com sucesso!')).toBeVisible();
    await expect(adminFidelidadePage.salvarConfigButton).toBeEnabled();
    await expect(adminFidelidadePage.enabledCheckbox).toBeEnabled();
    await expect(page.getByText(/^Regra: 5 pedidos = 60% de desconto/)).toBeVisible();

    // SO AGORA a 2a acao (toggle) e possivel -- exatamente a sequencia que corrompia o estado antes da
    // guarda (Onda 2). As 2 acoes feitas em sequencia real terminam AMBAS corretas, sem se pisarem.
    await adminFidelidadePage.enabledToggleClicavel.click();
    await expect(page.getByText('✓ Salvo com sucesso!')).toBeVisible();
    await expect(page.getByText('● Ativo')).toBeVisible();

    // Confirma no BANCO -- o rotulo muda otimista no clique, mas o RPC e assincrono (mesmo achado do
    // teste de toggle simples, acima); expect.poll fecha essa corrida sem depender de timeout fixo.
    const lerConfigReal = async () => {
      const { data } = await admin.from('store_settings').select('chave, valor')
        .eq('store_id', lojaNova.id).in('chave', ['loyalty_enabled', 'loyalty_required', 'loyalty_discount']);
      return Object.fromEntries(data.map((r) => [r.chave, r.valor]));
    };
    await expect.poll(async () => (await lerConfigReal()).loyalty_enabled).toBe('true');
    const mapa = await lerConfigReal();
    expect(mapa.loyalty_required).toBe('5');
    expect(mapa.loyalty_discount).toBe('60');
  });
});
