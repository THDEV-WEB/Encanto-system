/* e2e/tests/auth/login-google-trigger.spec.js — REF-E2E-02 · Onda 1 (@read-only).
   Login Google fica fora do escopo de automação real (tela de consentimento do próprio Google —
   decisão já tomada na auditoria da E2E-01, reafirmada na da E2E-02): cobrimos só o DISPARO
   (signInWithOAuth chama `GET .../auth/v1/authorize?provider=google`, interceptado antes de a página
   navegar de verdade). O que acontece DEPOIS do OAuth (sessão restaurada) é indistinguível do fluxo de
   e-mail do ponto de vista do AuthProvider — coberto em session-restore.spec.js (Onda 2) via
   storageState, sem depender de qual provedor originou a sessão. */
import { test, expect } from '../../fixtures/index.js';
import { mockGoogleOAuthTrigger } from '../../support/network-stubs.js';

test.describe('login com Google — disparo', { tag: '@read-only' }, () => {
  test('clicar em "Continuar com Google" chama signInWithOAuth(provider=google)', async ({ page, storePage, loginModal }) => {
    await storePage.goto();
    const google = await mockGoogleOAuthTrigger(page);
    await storePage.abrirLogin();
    await loginModal.googleButton.click();
    await expect.poll(() => google.foiChamado()).toBe(true);
  });
});
