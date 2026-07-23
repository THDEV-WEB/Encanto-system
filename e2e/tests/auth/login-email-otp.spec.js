/* e2e/tests/auth/login-email-otp.spec.js — REF-E2E-02 · Onda 1 (@read-only).
   Mecânica de UI do login por e-mail (OTP de 6 dígitos), com o backend de auth STUBADO via
   network-stubs.js (mockEmailOtpAuth) — determinístico, sem depender de e-mail real nem de projeto
   Supabase nenhum. Cobre validação de e-mail, cooldown de reenvio, código incompleto/inválido e o
   caminho de sucesso. A sessão REAL pós-login (Google ou e-mail) é coberta à parte, via storageState
   (ver e2e/tests/auth/session-restore.spec.js, Onda 2) — aqui só a mecânica da tela. */
import { test, expect } from '../../fixtures/index.js';
import { mockEmailOtpAuth } from '../../support/network-stubs.js';

const EMAIL = 'cliente@teste.encanto.local';

test.describe('login por e-mail — mecânica de UI (backend mockado)', { tag: '@read-only' }, () => {
  test.beforeEach(async ({ storePage }) => {
    await storePage.goto();
  });

  test('e-mail inválido bloqueia o envio antes de chamar o backend', async ({ page, storePage, loginModal }) => {
    await storePage.abrirLogin();
    await loginModal.emailButton.click();
    await loginModal.emailInput.fill('nao-e-email');
    await loginModal.sendCodeButton.click();
    await expect(page.getByText('Digite um e-mail válido.')).toBeVisible();
  });

  test('envia código e avança para a tela de confirmação', async ({ page, storePage, loginModal }) => {
    await mockEmailOtpAuth(page);
    await storePage.abrirLogin();
    await loginModal.emailButton.click();
    await loginModal.emailInput.fill(EMAIL);
    await loginModal.sendCodeButton.click();
    await expect(page.getByText('Código enviado para:')).toBeVisible();
    await expect(page.getByText(EMAIL)).toBeVisible();
  });

  test('erro no envio (rate limit) mostra mensagem amigável e não avança de tela', async ({ page, storePage, loginModal }) => {
    await mockEmailOtpAuth(page, { falharEnvio: true });
    await storePage.abrirLogin();
    await loginModal.emailButton.click();
    await loginModal.emailInput.fill(EMAIL);
    await loginModal.sendCodeButton.click();
    await expect(page.getByText(/Muitas tentativas/)).toBeVisible();
    await expect(loginModal.sendCodeButton).toBeVisible(); // continua na tela de e-mail
  });

  test('código incompleto bloqueia a confirmação', async ({ page, storePage, loginModal }) => {
    await mockEmailOtpAuth(page);
    await storePage.abrirLogin();
    await loginModal.entrarComEmail(EMAIL);
    await loginModal.preencherCodigo('123');
    await loginModal.confirmCodeButton.click();
    await expect(page.getByText('Digite os 6 dígitos do código.')).toBeVisible();
  });

  test('código inválido mostra erro e permite tentar de novo', async ({ page, storePage, loginModal }) => {
    await mockEmailOtpAuth(page, { falharConfirmacao: true });
    await storePage.abrirLogin();
    await loginModal.entrarComEmail(EMAIL);
    await loginModal.preencherCodigo('000000');
    await loginModal.confirmCodeButton.click();
    await expect(page.getByText('Código inválido ou expirado.')).toBeVisible();
    await expect(loginModal.confirmCodeButton).toBeVisible(); // continua na tela de código
  });

  test('cooldown de reenvio desabilita o botão logo após o envio', async ({ page, storePage, loginModal }) => {
    await mockEmailOtpAuth(page);
    await storePage.abrirLogin();
    await loginModal.entrarComEmail(EMAIL);
    await expect(page.getByRole('button', { name: /Reenviar em \d+s/ })).toBeDisabled();
  });

  test('código correto confirma e fecha a tela de login', async ({ page, storePage, loginModal }) => {
    await mockEmailOtpAuth(page);
    await storePage.abrirLogin();
    await loginModal.entrarComEmail(EMAIL);
    await loginModal.preencherCodigo('123456');
    await loginModal.confirmCodeButton.click();
    await expect(loginModal.confirmCodeButton).toBeHidden();
  });
});
