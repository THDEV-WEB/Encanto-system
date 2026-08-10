/* e2e/tests/admin/platform-console.spec.js — REF-SAAS-02 · Onda 1 (@writes).
   Sucessor de admin-plataforma.spec.js (REF-SAAS-01 · Onda 8): a aba "Plataforma" embutida no Admin da
   Encanto virou um Platform Console SEPARADO (própria tela/navegação/identidade — Fase 5/6 da REF), onde
   o super admin pousa direto apos o login. Prova, pela UI real: provisionamento de loja nova, vínculo de
   administrador, "Abrir Admin da loja" (troca de contexto sem duplicar telas), e o isolamento entre 2
   PESSOAS DISTINTAS (nunca o super admin se auto-vinculando) -- exatamente o que motivou a correção
   pós-Onda-8 (bug real do gate de login, is_admin_anywhere()). Autorização em si (RLS/RPC) já é
   exaustiva em scripts/saas02-onda1-platform-console-test.mjs (Camada B) -- aqui a prova é visual/UI. */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE, ADMIN_B_FIXTURE } from '../../support/fixture-accounts.js';
import { supabaseAdmin, idDoAdminFixture, garantirUsuarioAuth, E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';
import { AdminLoginPage } from '../../pages/AdminLoginPage.js';
import { AdminPanelPage } from '../../pages/AdminPanel.page.js';
import { PlatformConsolePage } from '../../pages/PlatformConsole.page.js';

const SLUG = 'bar-da-sogra-e2e-onda8';
const NOME = 'Bar da Sogra E2E';

async function limparLojaDeTeste(admin) {
  const { data: loja } = await admin.from('stores').select('id').eq('slug', SLUG).maybeSingle();
  if (loja) {
    await admin.from('admins').delete().eq('store_id', loja.id);
    await admin.from('store_settings').delete().eq('store_id', loja.id);
    await admin.from('stores').delete().eq('id', loja.id);
  }
}

test.describe('Platform Console / provisionamento (Admin)', { tag: '@writes' }, () => {
  let adminUserId = null;

  test.beforeEach(async () => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    const admin = supabaseAdmin();
    adminUserId = await idDoAdminFixture();
    await limparLojaDeTeste(admin); // sobra de uma run anterior interrompida, se houver
    // super_admins TEMPORARIO -- so no projeto de E2E, nunca em producao (service_role local ao teste).
    await admin.from('super_admins').upsert({ user_id: adminUserId }, { onConflict: 'user_id' });
  });

  test.afterEach(async () => {
    if (!E2E_ENV_PRONTO) return;
    const admin = supabaseAdmin();
    await limparLojaDeTeste(admin);
    if (adminUserId) await admin.from('super_admins').delete().eq('user_id', adminUserId);
  });

  test('super admin pousa no Platform Console, cria loja pela UI, vincula o proprio e-mail, e "Abrir Admin" troca de contexto', async ({ adminLoginPage, platformConsole, adminPanel, page }) => {
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);

    // Super admin pousa DIRETO no Platform Console apos o login -- nunca precisa achar uma aba dentro
    // do Admin da Encanto (Fase 5/6 da REF: identidade/contexto proprios, separados de qualquer loja).
    await expect(platformConsole.titulo).toContainText('VALION SISTEMAS');
    await platformConsole.abrirAba('lojas');

    await platformConsole.preencherNovaLoja({ nome: NOME, slug: SLUG });
    await platformConsole.criarLoja();
    await expect(page.getByText(`Loja "${NOME}" criada.`)).toBeVisible();
    await expect(platformConsole.linhaLoja(SLUG)).toBeVisible();
    await expect(platformConsole.statusLoja(SLUG)).toContainText('Em configuração');

    // Vincula o proprio e-mail do fixture como admin da loja nova (abre o detalhe primeiro -- o
    // mini-form de vinculo vive la, nao mais direto na linha da lista).
    await platformConsole.abrirDetalhe(SLUG);
    await platformConsole.vincularAdmin(SLUG, ADMIN_FIXTURE.email);
    await expect(page.getByText(`${ADMIN_FIXTURE.email} agora é admin desta loja.`)).toBeVisible();

    // "Abrir Admin da loja" troca a loja ativa e entra no Admin normal daquela loja -- sem duplicar tela.
    await page.getByTestId(`plataforma-abrir-admin-${SLUG}`).click();
    await expect(adminPanel.tab('dashboard')).toBeVisible();
    // Super admin agora tem 2 vinculos reais (Encanto + a loja nova) -- o seletor aparece.
    const seletor = page.getByTestId('admin-store-selector');
    await expect(seletor).toBeVisible();
    const opcoes = await seletor.locator('option').allTextContents();
    expect(opcoes.some((t) => t.includes(NOME))).toBe(true);
    expect(opcoes.some((t) => t.includes('Encanto'))).toBe(true);

    // "← Platform Console" (so existe pra super admin) volta sem deslogar.
    await adminPanel.voltarPlataforma();
    await expect(platformConsole.titulo).toContainText('VALION SISTEMAS');
  });

  /* Correcao pos-Onda-8 (preservada): vincular o PROPRIO Super Admin prova a mecanica de UI, mas nao
     prova isolamento entre 2 PESSOAS DIFERENTES. Este teste usa ADMIN_B_FIXTURE (conta DISTINTA, nunca
     reaproveitada de outro teste) pra provar o cenario real: Pessoa A (Super Admin) cria a loja e
     vincula Pessoa B; so Pessoa B loga como admin da loja nova, num browser context SEPARADO. */
  test('super admin vincula um ADMIN DISTINTO (pessoa B) — pessoa B ve só a loja dela, nunca o Platform Console nem a Encanto', async ({ adminLoginPage, platformConsole, page, browser }) => {
    await garantirUsuarioAuth(ADMIN_B_FIXTURE);

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await platformConsole.abrirAba('lojas');

    await platformConsole.preencherNovaLoja({ nome: NOME, slug: SLUG });
    await platformConsole.criarLoja();
    await expect(page.getByText(`Loja "${NOME}" criada.`)).toBeVisible();

    // Vincula PESSOA B (distinta de Pessoa A/Super Admin) -- nunca o proprio e-mail desta vez.
    await platformConsole.abrirDetalhe(SLUG);
    await platformConsole.vincularAdmin(SLUG, ADMIN_B_FIXTURE.email);
    await expect(page.getByText(`${ADMIN_B_FIXTURE.email} agora é admin desta loja.`)).toBeVisible();
    // O badge "aguardando administrador" some da lista assim que o vinculo e feito. Emoji no texto de
    // busca de proposito: getByText e case-insensitive por padrao, e a mensagem de sucesso da criacao
    // ("Aguardando administrador — vincule...") colidiria com uma busca so pela frase, sem o emoji.
    await expect(page.getByText('⚠️ aguardando administrador')).toHaveCount(0);
    await expect(platformConsole.statusLoja(SLUG)).toContainText('Operacional');

    // Pessoa A (Super Admin) continua vendo TODAS as lojas permitidas na lista do Platform Console --
    // Encanto (vinculo pessoal em `admins`) E Bar da Sogra (so por ser super admin, sem NENHUM vinculo
    // pessoal na loja de Pessoa B). Reload sempre volta ao login (REF-STABILITY-02) -- reaproveita a
    // sessao real via "Entrar" + confirmacao (REF-UX-SESSION-01).
    await page.reload();
    await adminLoginPage.entrarReaproveitandoSessao();
    await expect(platformConsole.titulo).toContainText('VALION SISTEMAS'); // volta pro Platform Console, nao pro Admin
    await platformConsole.abrirAba('lojas');
    await expect(platformConsole.linhaLoja('encanto')).toBeVisible();
    await expect(platformConsole.linhaLoja(SLUG)).toBeVisible();

    // Sessao NOVA e ISOLADA para Pessoa B -- nunca reaproveita cookies/localStorage de Pessoa A.
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    const loginB = new AdminLoginPage(pageB);
    const panelB = new AdminPanelPage(pageB);
    try {
      await loginB.goto();
      await loginB.login(ADMIN_B_FIXTURE.email, ADMIN_B_FIXTURE.senha);

      // Pessoa B NAO e super admin -- pousa DIRETO no Admin da propria loja, nunca no Platform Console.
      await expect(pageB.getByTestId('admin-store-ativa')).toContainText(NOME);
      await expect(pageB.getByTestId('admin-store-selector')).toHaveCount(0);
      await expect(pageB.getByText('Encanto', { exact: false })).toHaveCount(0);

      // Pessoa B nunca ve NENHUM artefato do Platform Console -- nem aba, nem identidade, nem o link de
      // volta (onVoltarPlataforma so existe pra super admin). Estrutural (nao so um tab escondido).
      await expect(pageB.locator('[data-testid^="platform-"]')).toHaveCount(0);
      await expect(pageB.getByTestId('admin-voltar-plataforma')).toHaveCount(0);
      await expect(pageB.getByText('VALION SISTEMAS', { exact: false })).toHaveCount(0);

      // O Dashboard da PROPRIA loja carrega normalmente (is_admin_of resolve certo pra loja dela).
      await panelB.abrirAba('dashboard');
      await expect(pageB.getByTestId('admin-tab-dashboard')).toBeVisible();
    } finally {
      await contextB.close();
    }
  });
});
