/* e2e/tests/auth/session-restore.spec.js — REF-E2E-02 · Onda 2 (@writes).
   Sessão REAL do cliente fixture, injetada via storageState (support/authSession.js) — prova que o
   AuthProvider restaura a sessão persistida no boot (getSession()) sem repetir a UI de login (já
   coberta em login-email-otp.spec.js/login-google-trigger.spec.js: mecânica idêntica para qualquer
   provedor, do ponto de vista do AuthProvider). Só toca o usuário de Auth do cliente fixture — nenhuma
   linha em customers/orders é criada aqui (essa parte entra na Onda 3). */
import { test, expect } from '@playwright/test';
import { StorePage } from '../../pages/StorePage.js';
import { contextClienteFixture } from '../../support/authSession.js';
import { garantirClienteFixtureVinculado } from '../../support/fixture-customer.js';

test.describe('sessão restaurada via storageState', { tag: '@writes' }, () => {
  /* Sem telefone vinculado, `precisaTelefone` fica true e o modal "Complete seu cadastro" cobre a
     tela por cima do drawer — garantindo o baseline aqui, o teste fica sobre o cenário comum (cliente
     já cadastrado), não sobre o 1º acesso (fora do escopo desta REF, ver auditoria). */
  test.beforeAll(async () => { await garantirClienteFixtureVinculado(); });

  test('abre já logado, sem passar pela tela de login', async ({ browser, baseURL }) => {
    const context = await contextClienteFixture(browser, baseURL);
    test.skip(!context, 'ambiente de E2E não configurado (.env.e2e)');

    const page = await context.newPage();
    const storePage = new StorePage(page);
    await storePage.goto();

    // Estado logado: o topo do menu abre a tela de login já na "Minha conta" (avatar/nome + Sair),
    // nunca repete "Entre ou cadastre-se" — é a mesma tela, só o ramo isLogged (LoginScreen.jsx).
    await storePage.abrirLogin();
    await expect(page.getByRole('button', { name: /Sair da conta/ })).toBeVisible();

    await context.close();
  });
});
