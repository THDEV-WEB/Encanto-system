/* e2e/tests/admin/admin-sessao.spec.js — REF-E2E-03 · Onda 1 (@writes) · reescrito na REF-ADMIN-01 ·
   Onda 2, depois na REF-STABILITY-01, e agora na REF-STABILITY-02 (mudança de comportamento — decisão
   do dono, substitui as duas anteriores nesta parte específica).

   NOVO COMPORTAMENTO (REF-STABILITY-02): a sessão do Admin no Supabase continua persistindo
   normalmente, mas NUNCA MAIS decide sozinha qual tela aparece — nem no boot, nem num F5, nem ao entrar
   no fluxo admin (engrenagem/hash). Todo bootstrap SEMPRE abre a Loja; engrenagem/hash SEMPRE abrem a
   tela de LOGIN (com o formulário, nunca mais uma tela "verificando sessão" escondendo-o); só o clique
   explícito em "Entrar" consulta/reaproveita uma sessão válida (sem pedir credencial de novo) — sem
   sessão válida, cai no login normal por e-mail/senha.

   Isso INVERTE várias asserções das duas gerações anteriores desta suíte:
   - Antes (REF-AUTH-02/ADMIN-01): engrenagem/hash com sessão válida iam DIRETO pro painel.
     Agora: mostram o formulário; só "Entrar" promove.
   - Antes (REF-ADMIN-02): F5 dentro do painel ('checking') mantinha o Admin sem novo clique.
     Agora: F5 sempre volta pra Loja — "Entrar" depois reaproveita a sessão sem pedir senha.
   - Antes (REF-STABILITY-01): formulário "nunca entra no DOM, nem por 1 frame" com sessão válida
     (escondido atrás de 'verificando sessão'). Agora: o formulário É PRA aparecer sempre — o que se
     prova agora é o INVERSO: ele nunca é pulado sem o clique.
   - O teste "reload nunca busca o catálogo da Loja" (REF-ADMIN-02) foi RETIRADO: seu objetivo era
     provar que a Loja não chegava a montar num F5 com sessão salva — hoje isso é o comportamento
     ESPERADO (a Loja sempre monta num F5), então a premissa do teste deixou de existir.

   REF-ADMIN-03 · Onda 2: `db` tem storageKey EXPLÍCITO (constants/authStorage.js) — este spec importa
   a MESMA constante em vez de reconstruir a chave default do supabase-js a partir da URL. */
import { test, expect } from '../../fixtures/index.js';
import { AdminLoginPage } from '../../pages/AdminLoginPage.js';
import { AdminPanelPage } from '../../pages/AdminPanel.page.js';
import { StorePage } from '../../pages/StorePage.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { E2E_ENV, E2E_ENV_PRONTO, supabaseAnon } from '../../support/supabaseAdmin.js';
import { ADMIN_AUTH_STORAGE_KEY } from '../../../src/constants/authStorage.js';

/* Formato DEFAULT do supabase-js (sb-<ref>-auth-token) — só é reconstruído AQUI, de propósito: este
   teste simula um navegador de ANTES da Onda 2 (quando essa era a única chave que existia), para
   provar que `migrarChaveSessaoAdminLegada()` (lib/supabase.js) resgata essa sessão sem forçar relogin. */
function chaveStorageAdminLegada() {
  const ref = new URL(E2E_ENV.url).hostname.split('.')[0];
  return `sb-${ref}-auth-token`;
}

function sessaoAdminForjada() {
  const expiradoHaUmaHora = Math.floor(Date.now() / 1000) - 3600;
  return {
    access_token: 'invalido.invalido.invalido',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiradoHaUmaHora,
    refresh_token: 'refresh-token-forjado-nao-existe',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      aud: 'authenticated',
      email: 'sessao-admin-invalida@teste.encanto.local',
      app_metadata: {}, user_metadata: {},
    },
  };
}

/* Injeta uma sessão de Admin REAL (fixture) em localStorage, sob a chave oficial, numa aba nova. */
async function contextComSessaoAdmin(browser, baseURL) {
  const anon = supabaseAnon();
  const { data, error } = await anon.auth.signInWithPassword({ email: ADMIN_FIXTURE.email, password: ADMIN_FIXTURE.senha });
  if (error || !data?.session) throw new Error(`[e2e] login do admin fixture falhou: ${error?.message || 'sem sessão'}`);
  return browser.newContext({
    storageState: {
      cookies: [],
      origins: [{
        origin: new URL(baseURL).origin,
        localStorage: [{ name: ADMIN_AUTH_STORAGE_KEY, value: JSON.stringify(data.session) }],
      }],
    },
  });
}

test.describe('sessão do Admin', { tag: '@writes' }, () => {
  test('domínio principal SEMPRE abre a Loja; engrenagem SEMPRE mostra o login; "Entrar" reaproveita sessão válida', async ({ browser, baseURL }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');

    const context = await contextComSessaoAdmin(browser, baseURL);
    const page = await context.newPage();
    const storePage = new StorePage(page);
    await storePage.goto(); // domínio principal, sem hash, aba nova

    // A Loja abre direto — a sessão salva não decide a tela inicial sozinha.
    await expect(page.locator('[data-prod]').first()).toBeVisible();
    await expect(page.locator('[data-testid="admin-tab-dashboard"]')).toHaveCount(0);

    // Engrenagem: SEMPRE mostra o formulário de login primeiro — nunca pula pro painel sozinha,
    // mesmo com sessão válida salva (regressão-alvo desta ref: promoção sem clique explícito).
    await page.locator('[data-testid="header-admin-btn"]').click();
    const adminPanel = new AdminPanelPage(page);
    await expect(page.locator('[data-testid="admin-login-senha"]')).toBeVisible();
    await expect(adminPanel.tab('dashboard')).toHaveCount(0);

    // Só o clique em "Entrar" consulta a sessão — reaproveita sem pedir credencial de novo.
    const adminLoginPage = new AdminLoginPage(page);
    await adminLoginPage.submitButton.click();
    await expect(adminPanel.tab('dashboard')).toBeVisible();

    await context.close();
  });

  test('reload no meio do painel SEMPRE volta para a Loja; "Entrar" reaproveita a sessão sem pedir senha de novo', async ({ adminLoginPage, adminPanel, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await expect(adminPanel.tab('dashboard')).toBeVisible();

    await page.reload();

    // REF-STABILITY-02: nenhuma exceção mais para "F5 dentro do painel" — todo bootstrap abre a Loja.
    await expect(page.locator('[data-prod]').first()).toBeVisible();
    await expect(adminPanel.tab('dashboard')).toHaveCount(0);

    // A sessão continua válida (persistência normal): engrenagem + Entrar restaura sem digitar senha.
    await page.locator('[data-testid="header-admin-btn"]').click();
    await expect(page.locator('[data-testid="admin-login-senha"]')).toBeVisible();
    await adminLoginPage.submitButton.click();
    await expect(adminPanel.tab('dashboard')).toBeVisible();
  });

  test('acessar #admin-encanto já autenticado MOSTRA o login (não pula mais pro painel); "Entrar" reaproveita a sessão', async ({ adminLoginPage, adminPanel, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await expect(adminPanel.tab('dashboard')).toBeVisible();

    // Simula reabrir pelo link com hash (ex.: favorito) enquanto a sessão do 1º login ainda é válida.
    // Navega para about:blank primeiro: uma 2ª ida direto para a MESMA origem só mudando o hash é
    // navegação same-document no navegador (não recarrega, só dispara hashchange) — o app nunca
    // remontaria, e o teste passaria "de graça" sem provar nada sobre o mount novo.
    await page.goto('about:blank');
    await adminLoginPage.goto();

    // REF-STABILITY-02: o hash é só um atalho para a TELA de login — nunca pula a etapa de "Entrar",
    // mesmo com sessão válida. Formulário aparece; painel só depois do clique.
    await expect(page.locator('[data-testid="admin-login-senha"]')).toBeVisible();
    await expect(adminPanel.tab('dashboard')).toHaveCount(0);

    await adminLoginPage.submitButton.click();
    await expect(adminPanel.tab('dashboard')).toBeVisible();
  });

  test('gear/hash com sessão válida: nunca promove sem o clique em "Entrar" (regressão-alvo desta ref)', async ({ browser, baseURL }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');

    const context = await contextComSessaoAdmin(browser, baseURL);
    const page = await context.newPage();
    const adminPanel = new AdminPanelPage(page);
    const adminLoginPage = new AdminLoginPage(page);

    await adminLoginPage.goto(); // navega direto para a URL com #admin-encanto

    // Espera um tempo real (não só a asserção seguinte) para dar chance a qualquer promoção em
    // background acontecer, caso a regressão volte — é exatamente o comportamento antigo que este
    // teste barra: sessão válida presente NUNCA deve, sozinha, levar ao painel.
    await page.waitForTimeout(500);
    await expect(adminPanel.tab('dashboard')).toHaveCount(0);
    await expect(page.locator('[data-testid="admin-login-senha"]')).toBeVisible();

    await adminLoginPage.submitButton.click();
    await expect(adminPanel.tab('dashboard')).toBeVisible();

    await context.close();
  });

  test('sessão forjada: "Entrar" sem digitar senha falha graciosamente (pede senha), sem travar nem gerar erro JS', async ({ browser, baseURL }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');

    const context = await browser.newContext({
      storageState: {
        cookies: [],
        origins: [{
          origin: new URL(baseURL).origin,
          localStorage: [{ name: ADMIN_AUTH_STORAGE_KEY, value: JSON.stringify(sessaoAdminForjada()) }],
        }],
      },
    });
    const page = await context.newPage();
    const erros = [];
    page.on('pageerror', (err) => erros.push(err));

    const adminLoginPage = new AdminLoginPage(page);
    await adminLoginPage.goto();

    // Formulário aparece imediato (REF-STABILITY-02 não consulta sessão nenhuma so por abrir a tela).
    await expect(page.locator('#enc-loader')).toHaveCount(0, { timeout: 15_000 });
    await expect(adminLoginPage.emailInput).toBeVisible();

    // Clicar "Entrar" sem senha: tenta reaproveitar a sessão forjada, getSession()/is_admin() falham
    // ao tentar renovar o refresh_token inválido (sem lançar) — cai no "Digite a senha", nunca trava.
    await adminLoginPage.submitButton.click();
    await expect(adminLoginPage.erroMensagem).toHaveText('Digite a senha');

    expect(erros, `erros JS não capturados: ${erros.map(String).join('; ')}`).toHaveLength(0);
    await context.close();
  });

  test('sessão salva sob a chave LEGADA (default do supabase-js) é migrada e reaproveitada via "Entrar", sem forçar relogin (fix REF-ADMIN-03 · Onda 2)', async ({ browser, baseURL }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');

    // Sessão REAL do admin fixture (mesmo método que o formulário de login usa por baixo,
    // signInWithPassword) — só o LUGAR onde ela é injetada simula o navegador pré-Onda 2.
    const anon = supabaseAnon();
    const { data, error } = await anon.auth.signInWithPassword({ email: ADMIN_FIXTURE.email, password: ADMIN_FIXTURE.senha });
    if (error || !data?.session) throw new Error(`[e2e] login do admin fixture falhou: ${error?.message || 'sem sessão'}`);

    const chaveLegada = chaveStorageAdminLegada();
    const context = await browser.newContext({
      storageState: {
        cookies: [],
        origins: [{ origin: new URL(baseURL).origin, localStorage: [{ name: chaveLegada, value: JSON.stringify(data.session) }] }],
      },
    });
    const page = await context.newPage();
    const storePage = new StorePage(page);
    const adminPanel = new AdminPanelPage(page);
    const adminLoginPage = new AdminLoginPage(page);
    await storePage.goto();

    // Domínio principal abre a Loja mesmo com sessão válida salva — a migração da chave legada
    // acontece em background (lib/supabase.js) no load do módulo, independente da tela mostrada.
    await expect(page.locator('[data-prod]').first()).toBeVisible();

    await page.locator('[data-testid="header-admin-btn"]').click();
    await expect(page.locator('[data-testid="admin-login-senha"]')).toBeVisible(); // login, não o painel direto
    await adminLoginPage.submitButton.click();
    await expect(adminPanel.tab('dashboard')).toBeVisible(); // migrou e restaurou — sem digitar senha

    const chaves = await page.evaluate((chaveAntiga) => ({
      nova: window.localStorage.getItem('encanto-admin-auth') !== null,
      antiga: window.localStorage.getItem(chaveAntiga) !== null,
    }), chaveLegada);
    expect(chaves.nova).toBe(true);   // sessão agora vive na chave centralizada
    expect(chaves.antiga).toBe(false); // chave antiga limpa (não fica lixo duplicado)

    await context.close();
  });
});
