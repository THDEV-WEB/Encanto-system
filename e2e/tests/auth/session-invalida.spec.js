/* e2e/tests/auth/session-invalida.spec.js — REF-E2E-02 · Onda 2 (@writes).
   Prova negativa REAL (não mockada): injeta via storageState uma sessão com `expires_at` no passado e
   `refresh_token` forjado — não existe hoje, num app curto, um jeito determinístico de esperar o TTL
   real expirar, então fabricamos o cenário. Ao carregar, `getSession()` (gotrue-js) detecta a sessão
   expirada e tenta renová-la contra o servidor REAL de Auth do projeto de E2E; o refresh token forjado
   é genuinamente rejeitado, a sessão é descartada e o AuthProvider cai para `status:'anon'` — o MESMO
   comportamento de um logout (AuthProvider.jsx não distingue eventos, ver auditoria REF-E2E-02
   §Contexto). A garantia que importa: o app não trava no loader infinito nem lança erro (REF-BOOT-02),
   apenas se comporta como um visitante anônimo. Não depende do cliente fixture (não usa Admin API). */
import { test, expect } from '@playwright/test';
import { StorePage } from '../../pages/StorePage.js';
import { STORAGE_KEY } from '../../support/authSession.js';
import { E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';

function sessaoForjada() {
  const expiradoHaUmaHora = Math.floor(Date.now() / 1000) - 3600;
  return {
    access_token: 'invalido.invalido.invalido',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiradoHaUmaHora,
    refresh_token: 'refresh-token-forjado-nao-existe',
    user: {
      id: '00000000-0000-4000-8000-000000000000',
      aud: 'authenticated',
      email: 'sessao-invalida@teste.encanto.local',
      app_metadata: {},
      user_metadata: {},
    },
  };
}

test.describe('sessão inválida/expirada', { tag: '@writes' }, () => {
  test('cai graciosamente para anônimo, sem travar o boot', async ({ browser, baseURL }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');

    const context = await browser.newContext({
      storageState: {
        cookies: [],
        origins: [{
          origin: new URL(baseURL).origin,
          localStorage: [{ name: STORAGE_KEY, value: JSON.stringify(sessaoForjada()) }],
        }],
      },
    });
    const page = await context.newPage();
    const erros = [];
    page.on('pageerror', (err) => erros.push(err));

    const storePage = new StorePage(page);
    await storePage.goto();

    // mesma proteção do boot.spec.js: nunca fica preso no loader estático (REF-BOOT-02)
    await expect(page.locator('#enc-loader')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('.header')).toBeVisible();

    await storePage.abrirLogin();
    await expect(page.getByRole('button', { name: 'Continuar com Google' })).toBeVisible();

    expect(erros, `erros JS não capturados: ${erros.map(String).join('; ')}`).toHaveLength(0);
    await context.close();
  });
});
