/* e2e/tests/admin/admin-login.spec.js — REF-E2E-03 · Onda 1 (@writes).
   Login real do Admin (e-mail/senha via `db.auth.signInWithPassword`, sem mock — decisão de
   arquitetura do ADR §4: ao contrário do cliente (Google/OTP), o form do Admin é testável de ponta a
   ponta contra o backend real). Prova os 3 caminhos: sucesso (ADMIN_FIXTURE, já registrado em
   public.admins desde a Onda 4 da E2E-01), senha errada e e-mail inexistente — os 2 últimos devolvem
   a MESMA mensagem genérica do Supabase (não revela se a conta existe), então as specs verificam
   apenas que o erro aparece e a tela de login permanece, sem fixar o texto exato (pode variar por
   versão do gotrue). */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';

test.describe('login do Admin — formulário real', { tag: '@writes' }, () => {
  test.beforeEach(async ({ adminLoginPage }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await adminLoginPage.goto();
  });

  test('credenciais corretas abrem o painel', async ({ adminLoginPage, adminPanel }) => {
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await expect(adminPanel.tab('dashboard')).toBeVisible();
  });

  test('senha errada mostra erro e permanece na tela de login', async ({ adminLoginPage }) => {
    await adminLoginPage.login(ADMIN_FIXTURE.email, 'senha-errada-nao-existe-123');
    await expect(adminLoginPage.erroMensagem).toBeVisible();
    await expect(adminLoginPage.emailInput).toBeVisible();
  });

  test('e-mail inexistente mostra o mesmo erro genérico', async ({ adminLoginPage }) => {
    await adminLoginPage.login('nao-existe-e2e-admin@teste.encanto.local', 'qualquer-senha-123');
    await expect(adminLoginPage.erroMensagem).toBeVisible();
    await expect(adminLoginPage.emailInput).toBeVisible();
  });
});
