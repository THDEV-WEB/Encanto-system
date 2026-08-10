/* e2e/tests/admin/admin-plataforma.spec.js — REF-SAAS-01 · Onda 8 (@writes).
   Prova, de ponta a ponta pela UI real (nao so pelo backend), a simulacao "Bar da Sogra": o admin
   fixture ganha super_admins TEMPORARIO (service_role, desfeito no afterEach — nunca no admin real de
   producao), abre a aba "Plataforma" (so aparece pra super admin, com 1 loja so, prova o fix do gate
   stores.length>1), cria uma loja nova pela UI, vincula o proprio e-mail como admin dela, e confirma
   que o seletor de loja PASSA A APARECER (2 vinculos reais) e que trocar de loja atualiza o contexto —
   exatamente os itens de frontend da Fase 5 que o teste de backend (Camada B, scripts/saas01-onda8-
   provisionamento-test.mjs) nao cobre por rodar direto no Postgres, sem passar pela UI. */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { supabaseAdmin, idDoAdminFixture, E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';

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
});
