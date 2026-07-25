/* e2e/tests/admin/admin-minha-conta.spec.js — REF-CUSTOMER-01 · Parte 3 (@writes).
   Aba nova "Minha Conta" do Admin (AdminMinhaConta.jsx): dados JA disponiveis pela sessao Supabase Auth
   (email/ultimo login/criado em - nativos do GoTrue) + nome/telefone em user_metadata (mesmo padrao
   usado pro CLIENTE em AuthService.atualizarNome, aqui espelhado pro client `db`). Restaura o fixture
   ao estado original ao final (nome/telefone vazios) - nao deixa residuo no ambiente compartilhado de
   E2E. NAO testa o caminho de SUCESSO da troca de senha (evitaria alterar a senha real do fixture
   compartilhado por toda a suite) - so os 2 caminhos de validacao client-side (nunca chegam a chamar
   auth.updateUser). */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';

test.describe('Minha Conta (Admin)', { tag: '@writes' }, () => {
  test('mostra e-mail/último login, salva nome/telefone e restaura o fixture ao final', async ({ adminLoginPage, adminPanel, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await expect(adminPanel.tab('dashboard')).toBeVisible();

    await adminPanel.abrirAba('minhaconta');
    await expect(page.getByText(ADMIN_FIXTURE.email)).toBeVisible();
    await expect(page.getByText(/Último login:/)).toBeVisible();

    const nomeInput = page.locator('[data-testid="minhaconta-admin-nome"]');
    const telInput = page.locator('[data-testid="minhaconta-admin-telefone"]');
    const salvarBtn = page.locator('[data-testid="minhaconta-admin-salvar-perfil"]');
    const msg = page.locator('[data-testid="minhaconta-admin-msg-perfil"]');

    await nomeInput.fill('Admin E2E Teste');
    await telInput.fill('38999990000');
    await salvarBtn.click();
    await expect(msg).toHaveText('Dados atualizados.');

    // Recarrega o painel — confirma que persistiu de verdade na sessão (user_metadata), não só no state local.
    await page.reload();
    await adminPanel.abrirAba('minhaconta');
    await expect(page.locator('[data-testid="minhaconta-admin-nome"]')).toHaveValue('Admin E2E Teste');
    await expect(page.locator('[data-testid="minhaconta-admin-telefone"]')).toHaveValue('38999990000');

    // Restaura o fixture (nao deixa residuo no ambiente compartilhado de E2E).
    await page.locator('[data-testid="minhaconta-admin-nome"]').fill('');
    await page.locator('[data-testid="minhaconta-admin-telefone"]').fill('');
    await page.locator('[data-testid="minhaconta-admin-salvar-perfil"]').click();
    await expect(msg).toHaveText('Dados atualizados.');
  });

  test('troca de senha valida antes de chamar o backend (senha curta / confirmação divergente)', async ({ adminLoginPage, adminPanel, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await expect(adminPanel.tab('dashboard')).toBeVisible();
    await adminPanel.abrirAba('minhaconta');

    const senha = page.locator('[data-testid="minhaconta-admin-senha"]');
    const confirmar = page.locator('[data-testid="minhaconta-admin-confirmar-senha"]');
    const salvar = page.locator('[data-testid="minhaconta-admin-salvar-senha"]');
    const msg = page.locator('[data-testid="minhaconta-admin-msg-senha"]');

    // Curta demais — nunca chega a chamar auth.updateUser (validação client-side primeiro).
    await senha.fill('123');
    await confirmar.fill('123');
    await salvar.click();
    await expect(msg).toHaveText('A senha deve ter ao menos 6 caracteres.');

    // Confirmação divergente — idem, sem tocar o backend.
    await senha.fill('senhaNova123');
    await confirmar.fill('outraSenha456');
    await salvar.click();
    await expect(msg).toHaveText('As senhas não coincidem.');

    // Continua autenticado (nunca caiu pro login) — nenhuma das 2 validações chegou a chamar o backend.
    // A próxima spec que logar com ADMIN_FIXTURE.senha prova que nada foi alterado de verdade.
    await expect(page.locator('[data-testid="admin-login-senha"]')).toHaveCount(0);
  });
});
