/* e2e/tests/admin/admin-permissao.spec.js — REF-E2E-03 · Onda 1, parte 1 (@writes) · reescrito na
   REF-REGRESSION-01 · P1 (achado de segurança crítica).
   Achado ORIGINAL (ADR §1.2, REF-E2E-03): NÃO existia verificação de is_admin() no cliente — qualquer
   usuário autenticado do Supabase chegava à UI inteira do Admin; só os DADOS eram protegidos por RLS
   (defesa em profundidade ausente — o painel nem deveria renderizar pra quem não é admin). Este teste
   documentava esse gap como comportamento ACEITO. A REF-REGRESSION-01 fechou o gap de verdade:
   useAdminSession.js/AdminLogin.jsx agora chamam is_admin() (RPC, tabela public.admins) antes de
   promover mode='admin' — uma sessão autenticada sem privilégio é deslogada e barrada ANTES de ver
   qualquer pixel do painel. Este teste passa a provar o comportamento NOVO (correto), não o antigo.
   Reaproveita CLIENTE_FIXTURE (E2E-02, decisão ADR §7.2) como a conta "autenticada, sem admin" — ele
   nunca está em public.admins, zero conta nova.

   Parte 2 (abaixo): escrita bloqueada por RLS para um usuário ANÔNIMO — a matriz completa do §1.9 já
   é exaustivamente provada pelos guards de domínio (`test:auth-rls`/`test:orders-rls`/`test:rls`,
   via SET LOCAL ROLE + BEGIN/ROLLBACK direto no Postgres), mas contra o banco de PRODUÇÃO, nunca o
   projeto `encanto-e2e`. Esta parte não duplica essa exaustão — é uma confirmação REPRESENTATIVA
   (poucas tabelas/RPCs, não a matriz inteira) de que o clone de schema preservou as MESMAS proteções
   no projeto de E2E, usando o client `anon` real (supabase-js), a mesma técnica de qualquer visitante
   anônimo do site — não simulação de role via SQL cru. */
import { test, expect } from '../../fixtures/index.js';
import { CLIENTE_FIXTURE } from '../../support/fixture-accounts.js';
import { E2E_ENV_PRONTO, supabaseAnon } from '../../support/supabaseAdmin.js';

test.describe('permissão — autenticado sem is_admin() (parte 1: gate de autorização)', { tag: '@writes' }, () => {
  test('CLIENTE_FIXTURE é barrado no login do Admin — credencial válida não basta sem is_admin()', async ({ adminLoginPage, adminPanel, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');

    let logoutChamado = false;
    await page.route('**/auth/v1/logout**', (route) => { logoutChamado = true; return route.continue(); });

    await adminLoginPage.goto();
    await adminLoginPage.login(CLIENTE_FIXTURE.email, CLIENTE_FIXTURE.senha);

    // Fix REF-REGRESSION-01 · P1: nunca chega ao painel — is_admin()===false desloga e mostra erro.
    await expect(adminLoginPage.erroMensagem).toHaveText('Acesso restrito ao administrador.');
    await expect(adminPanel.tab('dashboard')).toHaveCount(0);
    expect(logoutChamado).toBe(true); // a sessão autenticada (mas sem privilégio) é encerrada de verdade

    // Nem um F5 reabre o painel — sem sessão nenhuma sobrevivendo sob a chave do Admin. O hash secreto
    // já foi consumido (history.replaceState no 1º mount), então o reload cai na LOJA normal — mesmo
    // padrão de "Sair" (admin-logout.spec.js), não uma tela de login presa.
    await page.reload();
    await expect(adminPanel.tab('dashboard')).toHaveCount(0);
    await expect(page.locator('.header')).toBeVisible();
  });
});

test.describe('permissão — usuário anônimo (parte 2: escrita bloqueada por RLS)', { tag: '@writes' }, () => {
  test('anon não escreve catálogo, não lê a fila de notificações e não chama RPC de admin — no projeto de E2E', async () => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    const anon = supabaseAnon();

    const { error: errProd } = await anon.from('products').insert({ nome: 'E2E_TEST_RLS_Anon', preco: 1 });
    expect(errProd, 'anon deveria ser bloqueado ao inserir em products').toBeTruthy();

    const { error: errCat } = await anon.from('categories').insert({ id: `e2e-test-rls-anon-${Date.now()}`, nome: 'X', slug: `e2e-test-rls-anon-${Date.now()}`, tipo: 'business' });
    expect(errCat, 'anon deveria ser bloqueado ao inserir em categories').toBeTruthy();

    // notification_outbox tem RLS habilitada com UMA política (`notification_outbox_admin_read`,
    // USING is_admin()) mas o GRANT de SELECT da tabela em si nunca foi revogado do anon (diferente
    // das 3 RPCs de notificação, endurecidas à parte em REF-ORDER-01c) — então a chamada NÃO retorna
    // erro, a RLS filtra silenciosamente para ZERO linhas visíveis (achado real, não assumido).
    const { data: outbox, error: errOutbox } = await anon.from('notification_outbox').select('id').limit(1);
    expect(errOutbox).toBeNull();
    expect(outbox, 'RLS deveria filtrar notification_outbox para 0 linhas visíveis ao anon').toEqual([]);

    const { data: rpcData, error: errRpc } = await anon.rpc('set_store_mode', { p_mode: 'CLOSED' });
    expect(errRpc || rpcData === null, 'anon não deveria conseguir chamar set_store_mode (EXECUTE revogado)').toBeTruthy();
  });
});
