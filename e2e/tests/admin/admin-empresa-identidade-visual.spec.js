/* e2e/tests/admin/admin-empresa-identidade-visual.spec.js — REF-SAAS-02 · Onda 2 (@writes)
   (+ Onda 3: favicon entra na mesma prova — deixou de ser so' logo/banner).
   Prova, pela UI real, o ciclo de identidade visual por tenant (Fases 3-9/13/18 da REF): um admin
   DISTINTO do Super Admin (nunca a mesma pessoa se auto-vinculando — mesmo cuidado da correção pós-
   Onda-8) configura nome/banner/logo/favicon/apresentação da PRÓPRIA loja nova, os valores persistem
   de verdade (sobrevivem a reload+relogin, não só "até recarregar"), e a Encanto continua com os
   MESMOS dados de sempre — capturados ANTES da mudança e comparados byte-a-byte DEPOIS.

   Autorização/isolamento de banco (RLS de storage.objects, is_admin_of em set_company_info) já é
   exaustiva em scripts/saas02-onda2-identidade-visual-test.mjs (Camada B) — aqui a prova é visual/UI:
   o que a Pessoa B literalmente consegue configurar e ENXERGAR persistido. Usa o input "cole uma URL"
   do ImageUploader (não upload de arquivo real) — evita dependência de rede externa/flakiness; a
   validação de formato é a mesma dos dois lados (cliente e servidor), só a URL final importa aqui. */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE, ADMIN_B_FIXTURE } from '../../support/fixture-accounts.js';
import { supabaseAdmin, idDoAdminFixture, garantirUsuarioAuth, E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';
import { AdminLoginPage } from '../../pages/AdminLoginPage.js';
import { AdminPanelPage } from '../../pages/AdminPanel.page.js';
import { PlatformConsolePage } from '../../pages/PlatformConsole.page.js';

const SLUG = 'bar-da-sogra-e2e-onda2-visual';
const NOME = 'Bar da Sogra Visual E2E';
const BANNER_URL = 'https://cdn.exemplo-e2e-onda2.invalid/banner-barsogra.jpg';
const LOGO_URL = 'https://cdn.exemplo-e2e-onda2.invalid/logo-barsogra.png';
// REF-SAAS-02 · Onda 3: favicon passa a seguir o MESMO principio (tenant-scoped, sem herdar da Encanto).
const FAVICON_URL = 'https://cdn.exemplo-e2e-onda2.invalid/favicon-barsogra.png';

/* useCompanyInfo() pinta pelo cache em memória na hora (DEFAULT_COMPANY_INFO) e só busca o oficial
   (sincronizarCompanyInfo/get_company_info) depois, assíncrono — AdminEmpresa ressincroniza `form`
   sempre que esse fetch resolve. Como o cache default TAMBÉM começa com campos vazios (igual ao valor
   real de uma loja nova), um assert de "valor vazio" pode passar ANTES do fetch real terminar — digitar
   nesse intervalo seria sobrescrito quando a resposta chegasse. Espera pela resposta de rede EM SI
   (não um tempo fixo — mais robusto contra variação real de latência) antes de ler/editar o form. */
async function abrirEmpresaEsperandoSync(page, adminPanelPage) {
  const resposta = page.waitForResponse((r) => r.url().includes('/rpc/get_company_info'), { timeout: 15000 });
  await adminPanelPage.abrirAba('empresa');
  await resposta;
}

async function limparLojaDeTeste(admin) {
  const { data: loja } = await admin.from('stores').select('id').eq('slug', SLUG).maybeSingle();
  if (loja) {
    await admin.from('admins').delete().eq('store_id', loja.id);
    await admin.from('store_settings').delete().eq('store_id', loja.id);
    await admin.from('stores').delete().eq('id', loja.id);
  }
}

test.describe('Empresa / identidade visual por tenant (Admin)', { tag: '@writes' }, () => {
  let adminUserId = null;

  test.beforeEach(async () => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    const admin = supabaseAdmin();
    adminUserId = await idDoAdminFixture();
    await limparLojaDeTeste(admin);
    await admin.from('super_admins').upsert({ user_id: adminUserId }, { onConflict: 'user_id' });
  });

  test.afterEach(async () => {
    if (!E2E_ENV_PRONTO) return;
    const admin = supabaseAdmin();
    await limparLojaDeTeste(admin);
    if (adminUserId) await admin.from('super_admins').delete().eq('user_id', adminUserId);
  });

  test('admin DISTINTO configura banner/logo/apresentação da própria loja nova; persiste; Encanto continua intacta', async ({ adminLoginPage, platformConsole, adminPanel, page, browser }) => {
    await garantirUsuarioAuth(ADMIN_B_FIXTURE);

    // Pessoa A (Super Admin): captura o nomeCurto ATUAL da Encanto ANTES de qualquer mudança —
    // referência para provar "zero alteração" no final, não uma suposição.
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await platformConsole.abrirAba('lojas');
    await page.getByTestId('plataforma-abrir-admin-lista-encanto').click();
    await abrirEmpresaEsperandoSync(page, adminPanel);
    const nomeEncantoAntes = await page.getByTestId('empresa-form-nome-curto').inputValue();
    const bannerEncantoAntes = await page.getByTestId('img-uploader-url-banner').inputValue();
    const faviconEncantoAntes = await page.getByTestId('img-uploader-url-favicon').inputValue();
    await adminPanel.voltarPlataforma();

    // Cria a loja nova e vincula PESSOA B (distinta do Super Admin).
    await platformConsole.abrirAba('lojas');
    await platformConsole.preencherNovaLoja({ nome: NOME, slug: SLUG });
    await platformConsole.criarLoja();
    await expect(page.getByText(`Loja "${NOME}" criada.`)).toBeVisible();
    await platformConsole.abrirDetalhe(SLUG);
    await platformConsole.vincularAdmin(SLUG, ADMIN_B_FIXTURE.email);
    await expect(page.getByText(`${ADMIN_B_FIXTURE.email} agora é admin desta loja.`)).toBeVisible();

    // Sessão NOVA e ISOLADA para Pessoa B.
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    const loginB = new AdminLoginPage(pageB);
    const panelB = new AdminPanelPage(pageB);
    try {
      await loginB.goto();
      await loginB.login(ADMIN_B_FIXTURE.email, ADMIN_B_FIXTURE.senha);
      await abrirEmpresaEsperandoSync(pageB, panelB);

      // Antes de configurar: a loja nova NUNCA herda a marca da Encanto (Onda 8) — confirma aqui
      // tambem pela UI (nomeCurto == split(NOME)[0], nunca "Encanto"; banner/favicon vazios, nunca o
      // asset real da Encanto — REF-SAAS-02 Onda 3 fechou exatamente esse gap pro favicon).
      await expect(pageB.getByTestId('empresa-form-nome-curto')).not.toHaveValue('Encanto');
      await expect(pageB.getByTestId('img-uploader-url-banner')).toHaveValue('');
      await expect(pageB.getByTestId('img-uploader-url-favicon')).toHaveValue('');

      await pageB.getByTestId('empresa-form-nome-curto').fill('Bar da Sogra');
      await pageB.getByTestId('img-uploader-url-banner').fill(BANNER_URL);
      await pageB.getByTestId('img-uploader-url-logo').fill(LOGO_URL);
      await pageB.getByTestId('img-uploader-url-favicon').fill(FAVICON_URL);
      await pageB.getByTestId('empresa-form-logo-preset-retangular').check();
      await expect(pageB.getByTestId('empresa-form-nome-curto')).toHaveValue('Bar da Sogra');
      await expect(pageB.getByTestId('img-uploader-url-banner')).toHaveValue(BANNER_URL);
      await expect(pageB.getByTestId('img-uploader-url-favicon')).toHaveValue(FAVICON_URL);
      await pageB.locator('button:has-text("Salvar Alterações")').click();
      await expect(pageB.getByText('Dados da empresa salvos com sucesso.')).toBeVisible();

      // Persistência real: reload SEMPRE volta ao login (REF-STABILITY-02) — reaproveita a sessão via
      // "Entrar" + confirmação (REF-UX-SESSION-01), nunca um login novo. Não aceitar "só até recarregar".
      await pageB.reload();
      await loginB.entrarReaproveitandoSessao();
      await abrirEmpresaEsperandoSync(pageB, panelB);
      await expect(pageB.getByTestId('empresa-form-nome-curto')).toHaveValue('Bar da Sogra');
      await expect(pageB.getByTestId('img-uploader-url-banner')).toHaveValue(BANNER_URL);
      await expect(pageB.getByTestId('img-uploader-url-logo')).toHaveValue(LOGO_URL);
      await expect(pageB.getByTestId('img-uploader-url-favicon')).toHaveValue(FAVICON_URL);
      await expect(pageB.getByTestId('empresa-form-logo-preset-retangular')).toBeChecked();

      // Isolamento: Pessoa B nunca vê nenhum dado da Encanto nesta tela.
      await expect(pageB.getByText('Encanto', { exact: false })).toHaveCount(0);
    } finally {
      await contextB.close();
    }

    // Pessoa A (Super Admin): reabre o Admin da ENCANTO e confirma byte-a-byte que nada mudou —
    // a configuração de Pessoa B ficou 100% isolada na própria loja dela.
    await page.reload();
    await adminLoginPage.entrarReaproveitandoSessao();
    await platformConsole.abrirAba('lojas');
    await page.getByTestId('plataforma-abrir-admin-lista-encanto').click();
    await abrirEmpresaEsperandoSync(page, adminPanel);
    await expect(page.getByTestId('empresa-form-nome-curto')).toHaveValue(nomeEncantoAntes);
    await expect(page.getByTestId('img-uploader-url-banner')).toHaveValue(bannerEncantoAntes);
    await expect(page.getByTestId('img-uploader-url-favicon')).toHaveValue(faviconEncantoAntes);
    await expect(page.getByTestId('empresa-form-nome-curto')).not.toHaveValue('Bar da Sogra');
  });
});
