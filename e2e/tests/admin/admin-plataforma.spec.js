/* e2e/tests/admin/admin-plataforma.spec.js — REF-SAAS-01 · Onda 8 (@writes).
   Prova, de ponta a ponta pela UI real (nao so pelo backend), a simulacao "Bar da Sogra": o admin
   fixture ganha super_admins TEMPORARIO (service_role, desfeito no afterEach — nunca no admin real de
   producao), abre a aba "Plataforma" (so aparece pra super admin, com 1 loja so, prova o fix do gate
   stores.length>1), cria uma loja nova pela UI, vincula o proprio e-mail como admin dela, e confirma
   que o seletor de loja PASSA A APARECER (2 vinculos reais) e que trocar de loja atualiza o contexto —
   exatamente os itens de frontend da Fase 5 que o teste de backend (Camada B, scripts/saas01-onda8-
   provisionamento-test.mjs) nao cobre por rodar direto no Postgres, sem passar pela UI. */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE, ADMIN_B_FIXTURE } from '../../support/fixture-accounts.js';
import { supabaseAdmin, idDoAdminFixture, garantirUsuarioAuth, E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';
import { AdminLoginPage } from '../../pages/AdminLoginPage.js';
import { AdminPanelPage } from '../../pages/AdminPanel.page.js';

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

test.describe('Plataforma / provisionamento (Admin)', { tag: '@writes' }, () => {
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

  test('super admin cria loja pela UI, vincula o proprio e-mail, e o seletor de loja passa a aparecer', async ({ adminLoginPage, adminPanel, page }) => {
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);

    // Com 1 loja so (estado inicial), a aba "Plataforma" ja aparece -- prova do fix do gate
    // (nao gateado por stores.length>1, so por isSuperAdmin).
    await expect(adminPanel.tab('plataforma')).toBeVisible();
    await adminPanel.abrirAba('plataforma');

    await page.getByTestId('plataforma-nova-nome').fill(NOME);
    // slugify automatico ja preenche um valor a partir do nome -- sobrescreve com o slug EXATO usado
    // na limpeza (afterEach depende deste valor bater, independente do algoritmo de slugify).
    await page.getByTestId('plataforma-nova-slug').fill(SLUG);
    await page.getByTestId('plataforma-nova-criar').click();

    await expect(page.getByText(`Loja "${NOME}" criada.`)).toBeVisible();
    await expect(page.getByText(NOME, { exact: false }).first()).toBeVisible(); // aparece na lista de lojas

    // Vincula o proprio e-mail do fixture como admin da loja nova.
    await page.getByTestId(`plataforma-vincular-email-${SLUG}`).fill(ADMIN_FIXTURE.email);
    await page.getByTestId(`plataforma-vincular-btn-${SLUG}`).click();
    await expect(page.getByText(`${ADMIN_FIXTURE.email} agora e admin desta loja.`)).toBeVisible();

    // list_my_stores() so reflete o novo vinculo num mount novo do AdminStoreProvider. REF-STABILITY-02:
    // um reload SEMPRE volta pro login (mode nunca se auto-restaura) -- reaproveita a sessao real via
    // "Entrar" + tela de confirmacao (REF-UX-SESSION-01), nunca uma credencial nova.
    await page.reload();
    await adminLoginPage.entrarReaproveitandoSessao();
    await expect(adminPanel.tab('dashboard')).toBeVisible(); // painel recarregou logado

    // Frontend deixa de "parecer single-tenant": com 2 vinculos reais, o seletor de loja aparece.
    const seletor = page.getByTestId('admin-store-selector');
    await expect(seletor).toBeVisible();
    const opcoes = await seletor.locator('option').allTextContents();
    expect(opcoes.some((t) => t.includes(NOME))).toBe(true);

    // Trocar de loja no seletor atualiza o contexto (remonta o corpo do Admin, key=activeStoreId) sem erro.
    await seletor.selectOption({ label: opcoes.find((t) => t.includes(NOME)) });
    await expect(page.locator('.admin-body')).toBeVisible();
  });

  /* Correcao pos-Onda-8: o teste acima vincula o PROPRIO Super Admin como admin da loja nova -- prova a
     mecanica de UI, mas nao prova isolamento entre 2 PESSOAS DIFERENTES. Este teste usa ADMIN_B_FIXTURE,
     uma conta DISTINTA (nunca reaproveitada de outro teste), pra provar o cenario real: Pessoa A (Super
     Admin) cria a loja e vincula Pessoa B; so Pessoa B loga como admin da loja nova, numa sessao/contexto
     de navegador SEPARADO (nunca reaproveita a sessao de Pessoa A). A prova de autorizacao no BANCO
     (RLS/RPC, is_admin_of) ja e' exaustiva em scripts/saas01-onda8-provisionamento-test.mjs (Camada B) --
     aqui a prova e' visual/UI: o que Pessoa B literalmente consegue ENXERGAR e clicar. */
  test('super admin vincula um ADMIN DISTINTO (pessoa B) — pessoa B ve só a loja dela, nunca a Plataforma nem a Encanto', async ({ adminLoginPage, adminPanel, page, browser }) => {
    await garantirUsuarioAuth(ADMIN_B_FIXTURE);

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('plataforma');

    await page.getByTestId('plataforma-nova-nome').fill(NOME);
    await page.getByTestId('plataforma-nova-slug').fill(SLUG);
    await page.getByTestId('plataforma-nova-criar').click();
    await expect(page.getByText(`Loja "${NOME}" criada.`)).toBeVisible();

    // Vincula PESSOA B (distinta de Pessoa A/Super Admin) -- nunca o proprio e-mail desta vez.
    await page.getByTestId(`plataforma-vincular-email-${SLUG}`).fill(ADMIN_B_FIXTURE.email);
    await page.getByTestId(`plataforma-vincular-btn-${SLUG}`).click();
    await expect(page.getByText(`${ADMIN_B_FIXTURE.email} agora e admin desta loja.`)).toBeVisible();
    // O badge "aguardando administrador" some da lista assim que o vinculo e feito (REF-SAAS-01 · Onda
    // 8.2). Emoji no texto de busca de proposito: getByText e case-insensitive por padrao no Playwright,
    // e a mensagem de sucesso da criacao ("Aguardando administrador — vincule...") colidiria com uma
    // busca so pela frase, sem o emoji do badge.
    await expect(page.getByText('⚠️ aguardando administrador')).toHaveCount(0);

    // Pessoa A (Super Admin) continua vendo TODAS as lojas permitidas -- Encanto (vinculo pessoal em
    // `admins`) E Bar da Sogra (so por ser super admin, sem NENHUM vinculo pessoal na loja de Pessoa B).
    await page.reload();
    await adminLoginPage.entrarReaproveitandoSessao();
    const seletorA = page.getByTestId('admin-store-selector');
    await expect(seletorA).toBeVisible();
    const opcoesA = await seletorA.locator('option').allTextContents();
    expect(opcoesA.some((t) => t.includes('Encanto'))).toBe(true);
    expect(opcoesA.some((t) => t.includes(NOME))).toBe(true);

    // Sessao NOVA e ISOLADA para Pessoa B -- nunca reaproveita cookies/localStorage de Pessoa A.
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    const loginB = new AdminLoginPage(pageB);
    const panelB = new AdminPanelPage(pageB);
    try {
      await loginB.goto();
      await loginB.login(ADMIN_B_FIXTURE.email, ADMIN_B_FIXTURE.senha);

      // Pessoa B tem 1 vinculo so (Bar da Sogra) -- rotulo fixo, seletor nem aparece (stores.length===1).
      await expect(pageB.getByTestId('admin-store-ativa')).toContainText(NOME);
      await expect(pageB.getByTestId('admin-store-selector')).toHaveCount(0);
      await expect(pageB.getByText('Encanto', { exact: false })).toHaveCount(0);

      // Pessoa B NUNCA ve a aba/rotulo de Plataforma -- nao e super admin, o gate e is_super_admin() real.
      await expect(panelB.tab('plataforma')).toHaveCount(0);
      await expect(pageB.getByText('VALION SISTEMAS', { exact: false })).toHaveCount(0);

      // O Dashboard da PROPRIA loja carrega normalmente (is_admin_of resolve certo pra loja dela).
      await panelB.abrirAba('dashboard');
      await expect(pageB.getByTestId('admin-tab-dashboard')).toBeVisible();
    } finally {
      await contextB.close();
    }
  });
});
