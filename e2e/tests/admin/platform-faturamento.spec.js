/* e2e/tests/admin/platform-faturamento.spec.js — REF-BILLING-01 · Onda 3 (@writes).
   Prova pela UI REAL a aba "Faturamento" do Platform Console: lista com status correto (incl.
   'sem_assinatura' via LEFT JOIN pra loja nova), configurar dia de vencimento, configurar contato
   financeiro, marcar mensalidade paga (some da lista como pendente, vira "Em dia"), e histórico
   refletindo os eventos gerados. A autorização em si (is_super_admin, RLS, gate aditivo em
   is_admin_of) já foi provada exaustivamente em scripts/billing-01-onda{1,2,3}-test.mjs -- aqui só
   confirma que a UI real produz o resultado certo (mesmo espírito de admin-pedidos-novo-mesa.spec.js).

   Loja de teste DEDICADA (nunca 'encanto', o fixture compartilhado por praticamente toda a suíte) --
   mexer no billing da loja fixture arriscaria bloquear login de OUTROS specs rodando em paralelo. */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { supabaseAdmin, idDoAdminFixture, E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';

const SLUG = 'billing-01-onda3-e2e';
const NOME = 'Loja Teste Faturamento Onda3';

async function limparLojaDeTeste(admin) {
  const { data: loja } = await admin.from('stores').select('id').eq('slug', SLUG).maybeSingle();
  if (loja) {
    await admin.from('store_billing_events').delete().eq('store_id', loja.id);
    await admin.from('store_subscriptions').delete().eq('store_id', loja.id);
    await admin.from('stores').delete().eq('id', loja.id);
  }
}

test.describe('Faturamento (Platform Console)', { tag: '@writes' }, () => {
  let adminUserId = null;

  test.beforeEach(async () => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    const admin = supabaseAdmin();
    adminUserId = await idDoAdminFixture();
    await limparLojaDeTeste(admin); // sobra de uma run anterior interrompida, se houver
    await admin.from('stores').insert({ slug: SLUG, nome: NOME, status: 'ativo' });
    // NAO promove a super_admins aqui -- o 2o teste desta suite precisa do fixture SEM esse papel.
    // O 1o teste (que precisa ser super admin) promove explicitamente no proprio corpo.
  });

  test.afterEach(async () => {
    if (!E2E_ENV_PRONTO) return;
    const admin = supabaseAdmin();
    await limparLojaDeTeste(admin);
    if (adminUserId) await admin.from('super_admins').delete().eq('user_id', adminUserId);
    // platform_billing_config e' singleton DE PLATAFORMA (nao por loja) -- devolve ao estado "nao
    // configurado" pra nao deixar dado de teste como se fosse a config real da VALION.
    await admin.from('platform_billing_config').delete().eq('id', 1);
  });

  test('lista mostra sem_assinatura, configura vencimento/contato, marca pago e reflete no histórico', async ({ adminLoginPage, platformConsole, page }) => {
    const admin = supabaseAdmin();
    await admin.from('super_admins').upsert({ user_id: adminUserId }, { onConflict: 'user_id' }); // super_admins TEMPORARIO -- so no projeto de E2E

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await platformConsole.abrirAba('faturamento');

    // Loja nova, sem nenhuma linha em store_subscriptions -- aparece na lista via LEFT JOIN, nunca some.
    await expect(platformConsole.linhaFaturamento(SLUG)).toBeVisible();
    await expect(platformConsole.statusFaturamento(SLUG)).toContainText('Sem assinatura');

    await platformConsole.abrirDetalheFaturamento(SLUG);

    // Configura o dia de vencimento -> primeira vez cria a linha em store_subscriptions (status em_dia default).
    await platformConsole.salvarDiaVencimento(SLUG, 15);
    await expect(page.getByText('Dia de vencimento salvo.')).toBeVisible();

    // Configura o contato financeiro dedicado.
    await platformConsole.salvarContatoFinanceiro(SLUG, { nome: 'Maria Dona', email: 'maria@teste.com', whatsapp: '38999990000' });
    await expect(page.getByText('Contato financeiro salvo.')).toBeVisible();

    // Marca a mensalidade como paga -- status passa a em_dia, próximo vencimento gravado.
    const dataFutura = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    await platformConsole.marcarPago(SLUG, dataFutura);
    await expect(page.getByText('Pagamento confirmado.')).toBeVisible();

    // Histórico reflete os 2 eventos financeiramente relevantes gerados (config de vencimento não
    // gera evento -- só alteração de vencimento com linha PRE-EXISTENTE, ver decisão de implementação
    // da Onda 1; a primeira configuração deste teste foi a CRIAÇÃO da linha).
    await expect(page.getByText('Pagamento confirmado', { exact: true })).toBeVisible();

    // Fecha e reabre o detalhe -- prova que o estado persistido (não só o otimista da tela) está certo.
    await page.getByRole('button', { name: 'Fechar detalhe' }).click();
    await expect(platformConsole.statusFaturamento(SLUG)).toContainText('Em dia');
    await platformConsole.abrirDetalheFaturamento(SLUG);
    await expect(page.getByTestId(`plataforma-faturamento-contato-nome-${SLUG}`)).toHaveValue('Maria Dona');
    await expect(page.getByTestId(`plataforma-faturamento-contato-email-${SLUG}`)).toHaveValue('maria@teste.com');
    await expect(page.getByTestId(`plataforma-faturamento-dia-input-${SLUG}`)).toHaveValue('15');
  });

  test('usuário sem is_super_admin nunca vê o Platform Console (nem a aba Faturamento)', async ({ adminLoginPage, adminPanel, page }) => {
    // ADMIN_FIXTURE aqui NÃO foi promovido a super_admins neste teste -- login normal cai no Admin da
    // loja de sempre, nunca no Platform Console. Prova de interface -- a proteção real (RLS/RPC) já
    // está exaustivamente coberta nos scripts .mjs.
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await expect(adminPanel.tab('dashboard')).toBeVisible();
    await expect(page.getByTestId('platform-console-titulo')).toHaveCount(0);
  });

  // REF-BILLING-01 · Onda 5: dados de pagamento/Pix da VALION -- singleton de PLATAFORMA (nao por
  // loja), configurado no Platform Console, exibido so-leitura no Admin de QUALQUER loja.
  test('super admin configura o Pix da VALION -- persiste, e aparece na aba Faturamento do Admin de uma loja', async ({ adminLoginPage, platformConsole, adminPanel, page }) => {
    const admin = supabaseAdmin();
    await admin.from('super_admins').upsert({ user_id: adminUserId }, { onConflict: 'user_id' });

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await platformConsole.abrirAba('faturamento');

    await page.getByTestId('plataforma-pix-chave').fill('financeiro@valion.com.br');
    await page.getByTestId('plataforma-pix-tipo').selectOption('email');
    await page.getByTestId('plataforma-pix-nome').fill('VALION Sistemas Ltda');
    await page.getByTestId('plataforma-pix-salvar').click();
    await expect(page.getByText('Dados de pagamento salvos.')).toBeVisible();

    // Reload prova persistencia real (nao so estado otimista da tela).
    await page.reload();
    await adminLoginPage.entrarReaproveitandoSessao();
    await platformConsole.abrirAba('faturamento');
    await expect(page.getByTestId('plataforma-pix-chave')).toHaveValue('financeiro@valion.com.br');

    // Muda de contexto pro Admin desta loja (super admin nao precisa de vinculo explicito em `admins`)
    // e confirma que a aba Faturamento do Admin da loja mostra os MESMOS dados, so-leitura.
    await platformConsole.abrirAba('lojas');
    await platformConsole.abrirAdminDaLoja(SLUG);
    await adminPanel.abrirAba('faturamento');
    await expect(page.getByText('financeiro@valion.com.br')).toBeVisible();
    await expect(page.getByText('VALION Sistemas Ltda')).toBeVisible();
  });
});
