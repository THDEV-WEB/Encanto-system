/* e2e/tests/cliente/minha-conta.spec.js — REF-E2E-02 · Onda 3 (@writes).
   Área "Minha Conta" (MinhaContaScreen.jsx) do cliente autenticado: ver dados carregados, editar
   nome/telefone (mesmo customer.id — nunca cria linha nova, ver link_customer_to_auth ramo "atualizado"
   em migrations/LOGIN-ARCH-02.1-hybrid-auth.sql) e solicitar troca de e-mail (fluxo oficial do
   Supabase, backend de auth MOCKADO — ver support/network-stubs.js/mockEmailChangeAuth: e-mail `.local`
   é rejeitado pela validação de domínio do Supabase, e mesmo com domínio válido o envio real esbarra
   no rate limit de e-mail do plano free, o mesmo recurso escasso que já motivou mockar o OTP).
   Serializado: o teste de edição MUTA o perfil do cliente fixture
   (nome/telefone); o afterEach restaura o baseline via a MESMA RPC que a UI usa
   (garantirClienteFixtureVinculado) — nunca por delete de customers (cleanup.js não apaga a linha do
   fixture, ver support/cleanup.js). */
import { test, expect } from '@playwright/test';
import { StorePage } from '../../pages/StorePage.js';
import { MinhaContaPage } from '../../pages/MinhaContaPage.page.js';
import { contextClienteFixture } from '../../support/authSession.js';
import { garantirClienteFixtureVinculado } from '../../support/fixture-customer.js';
import { CLIENTE_FIXTURE } from '../../support/fixture-accounts.js';
import { mockEmailChangeAuth } from '../../support/network-stubs.js';

function telefoneUnico() { return '479' + String(Date.now()).slice(-8); }

async function abrirMinhaConta(browser, baseURL) {
  const context = await contextClienteFixture(browser, baseURL);
  test.skip(!context, 'ambiente de E2E não configurado (.env.e2e)');
  const page = await context.newPage();
  const storePage = new StorePage(page);
  const minhaConta = new MinhaContaPage(page);
  await storePage.goto();
  await storePage.abrirMinhaConta();
  return { context, page, minhaConta };
}

test.describe('Minha Conta', { tag: '@writes' }, () => {
  test.describe.configure({ mode: 'serial' }); // muta o perfil do fixture — evita corrida com outros specs que leem o mesmo cliente

  test.beforeAll(async () => { await garantirClienteFixtureVinculado(); });
  test.afterEach(async () => { await garantirClienteFixtureVinculado(); }); // restaura o baseline após qualquer edição

  test('mostra os dados carregados da conta', async ({ browser, baseURL }) => {
    const { context, page, minhaConta } = await abrirMinhaConta(browser, baseURL);

    await expect(minhaConta.nomeInput).toHaveValue(CLIENTE_FIXTURE.nome);
    await expect(minhaConta.telefoneInput).toHaveValue(CLIENTE_FIXTURE.telefone);
    await expect(page.getByText(CLIENTE_FIXTURE.email).first()).toBeVisible();

    await context.close();
  });

  test('editar nome e telefone salva e reflete na tela', async ({ browser, baseURL }) => {
    const { context, page, minhaConta } = await abrirMinhaConta(browser, baseURL);
    const novoNome = 'Cliente E2E Editado';
    const novoTelefone = telefoneUnico();

    await minhaConta.editarPerfil({ nome: novoNome, telefone: novoTelefone });

    await expect(page.getByRole('status')).toContainText('Perfil atualizado com sucesso.');
    await expect(minhaConta.nomeInput).toHaveValue(novoNome);
    await expect(minhaConta.telefoneInput).toHaveValue(novoTelefone);

    await context.close();
  });

  test('solicitar troca de e-mail fica em "confirmação enviada" (backend de auth mockado)', async ({ browser, baseURL }) => {
    const { context, page, minhaConta } = await abrirMinhaConta(browser, baseURL);

    // auth.updateUser({email}) mockado — ver justificativa em support/network-stubs.js
    // (mockEmailChangeAuth): e-mail .local é rejeitado pela validação de domínio do Supabase, e o
    // envio real do link de confirmação esbarra rápido no rate limit de e-mail do plano free.
    await mockEmailChangeAuth(page);
    await minhaConta.solicitarTrocaEmail('novo-email-e2e@teste.encanto.local');
    await expect(page.getByText(/Confirmação enviada/)).toBeVisible();

    await context.close();
  });
});
