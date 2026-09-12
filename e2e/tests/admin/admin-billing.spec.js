/* e2e/tests/admin/admin-billing.spec.js — REF-BILLING-01 · Onda 4 (@writes).
   Prova pela UI REAL o lado do Admin da PRÓPRIA loja: banner discreto (vencimento próximo/carência),
   bloqueio total do painel quando a assinatura está 'bloqueada' (nunca pro super admin -- ver decisão
   de implementação #2 da Onda 1), e a aba "Faturamento" somente-leitura. A autorização em si
   (is_admin_of/RLS/gate) já está exaustiva em scripts/billing-01-onda{1,2}-test.mjs -- aqui só
   confirma que a UI real produz o resultado certo.

   Loja de teste DEDICADA (nunca 'encanto') -- mutar store_subscriptions da loja fixture pra 'bloqueada'
   derrubaria QUALQUER outro spec rodando contra ela (praticamente toda a suíte de Admin usa esse
   fixture). ADMIN_FIXTURE ganha um SEGUNDO vínculo (a loja de teste), sem tocar no vínculo original
   com 'encanto' -- troca de contexto via seletor de loja (mesmo padrão do Platform Console). */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { supabaseAdmin, idDoAdminFixture, E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';

const SLUG = 'billing-01-onda4-e2e';
const NOME = 'Loja Teste Billing Onda4';

async function limpar(admin, adminUserId) {
  const { data: loja } = await admin.from('stores').select('id').eq('slug', SLUG).maybeSingle();
  if (loja) {
    await admin.from('admins').delete().eq('store_id', loja.id).eq('user_id', adminUserId);
    await admin.from('store_billing_events').delete().eq('store_id', loja.id);
    await admin.from('store_subscriptions').delete().eq('store_id', loja.id);
    await admin.from('stores').delete().eq('id', loja.id);
  }
  if (adminUserId) await admin.from('super_admins').delete().eq('user_id', adminUserId);
}

test.describe('Billing no Admin da loja (banner/bloqueio/consulta)', { tag: '@writes' }, () => {
  let adminUserId = null;
  let storeId = null;

  test.beforeEach(async () => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    const admin = supabaseAdmin();
    adminUserId = await idDoAdminFixture();
    await limpar(admin, adminUserId); // sobra de uma run anterior interrompida, se houver
    const { data: loja } = await admin.from('stores').insert({ slug: SLUG, nome: NOME, status: 'ativo' }).select('id').single();
    storeId = loja.id;
    // ADMIN_FIXTURE ganha um 2o vinculo -- o vinculo com 'encanto' continua intacto (nunca removido).
    await admin.from('admins').insert({ store_id: storeId, user_id: adminUserId });
  });

  test.afterEach(async () => {
    if (!E2E_ENV_PRONTO) return;
    await limpar(supabaseAdmin(), adminUserId);
  });

  test('banner de vencimento próximo, banner de carência, e aba Faturamento refletindo cada estado', async ({ adminLoginPage, adminPanel, page }) => {
    const admin = supabaseAdmin();

    // Vencimento em 2 dias -- dentro da janela de aviso (3 dias) -- banner "vence em" aparece.
    await admin.from('store_subscriptions').insert({ store_id: storeId, status: 'em_dia', proximo_vencimento: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10) });

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.trocarLoja(storeId);

    await expect(page.getByTestId('admin-billing-banner-proximo')).toBeVisible();
    await expect(page.getByTestId('admin-billing-banner-carencia')).toHaveCount(0);
    await expect(page.getByTestId('admin-billing-bloqueado')).toHaveCount(0); // em_dia nunca bloqueia

    // Consulta so-leitura reflete "Em dia" -- nenhum controle de escrita (essa aba nunca tem input/botao de acao).
    await adminPanel.abrirAba('faturamento');
    await expect(page.getByText('Em dia')).toBeVisible();
    await expect(page.locator('input')).toHaveCount(0);

    // Vira carência (vencido ontem) -- banner muda, ainda NÃO bloqueia o painel.
    await admin.from('store_subscriptions').update({ status: 'carencia', proximo_vencimento: new Date(Date.now() - 86400000).toISOString().slice(0, 10) }).eq('store_id', storeId);
    await admin.from('store_billing_events').insert({ store_id: storeId, tipo: 'entrada_carencia', payload: {} });
    // AdminStoreProvider so refaz o fetch de billing ao trocar de loja/remontar -- reload+sessao forca.
    // REF-UX-SESSION-01: reload do bundle do admin SEMPRE reabre no login; "Entrar" reaproveita sem senha.
    await adminLoginPage.goto();
    await adminLoginPage.entrarReaproveitandoSessao();
    await adminPanel.trocarLoja(storeId);

    await expect(page.getByTestId('admin-billing-banner-carencia')).toBeVisible();
    await expect(page.getByTestId('admin-billing-banner-proximo')).toHaveCount(0);
    await adminPanel.abrirAba('dashboard');
    await expect(page.getByTestId('admin-billing-bloqueado')).toHaveCount(0); // carencia != bloqueada

    await adminPanel.abrirAba('faturamento');
    await expect(page.getByText('Em atraso (carência)')).toBeVisible();
    await expect(page.getByText('Entrou em carência')).toBeVisible(); // historico
  });

  test('loja bloqueada: painel normal vira mensagem clara pro admin comum, mas o super admin continua com acesso total', async ({ adminLoginPage, adminPanel, platformConsole, page }) => {
    const admin = supabaseAdmin();
    await admin.from('store_subscriptions').insert({ store_id: storeId, status: 'bloqueada', proximo_vencimento: new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10) });

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.trocarLoja(storeId);

    await expect(page.getByTestId('admin-billing-bloqueado')).toBeVisible();
    await expect(page.getByText('Mensalidade pendente')).toBeVisible();
    // Persiste ao trocar de aba -- TODA aba mostra a mesma mensagem, nao so o dashboard.
    await adminPanel.abrirAba('products');
    await expect(page.getByTestId('admin-billing-bloqueado')).toBeVisible();
    // Bloqueio nunca tranca o logout -- sidebar continua intacta.
    await expect(adminPanel.logoutButton).toBeVisible();

    // Promove a super_admins (temporario, so E2E) -- mesma loja bloqueada, agora acesso TOTAL e normal.
    // Super admin pousa no Platform Console apos o login (nunca direto no Admin de uma loja, ver
    // AdminApp.jsx/AdminAuthedShell) -- "Abrir Admin" na linha desta loja e o caminho real, mesmo
    // usado por platform-console.spec.js.
    await admin.from('super_admins').upsert({ user_id: adminUserId }, { onConflict: 'user_id' });
    await adminLoginPage.goto();
    await adminLoginPage.entrarReaproveitandoSessao();
    await expect(platformConsole.titulo).toContainText('VALION SISTEMAS');
    await platformConsole.abrirAba('lojas');
    await page.getByTestId(`plataforma-abrir-admin-lista-${SLUG}`).click();

    await expect(page.getByTestId('admin-billing-bloqueado')).toHaveCount(0);
    await expect(adminPanel.tab('dashboard')).toBeVisible();
  });
});
