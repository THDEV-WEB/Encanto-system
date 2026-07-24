/* e2e/tests/admin/admin-categorias.spec.js — REF-E2E-03 · Onda 3 (@writes) + REF-ADMIN-01 · Onda 1
   (fix: exclusão de categoria em uso).
   CRUD de Categorias (AdminCategorias.jsx). `DS.upsertCat` não encadeia `.select()` no insert — nem
   o app nem este spec sabem o id da categoria recém-criada sem uma consulta própria; por isso
   descobrimos o id via `supabaseAdmin()` (mesmo padrão já usado em checkout-logado.spec.js para
   verificar fatos direto no backend), nunca raspando o DOM.

   "Categoria em uso": achado original (REF-E2E-03) era que `DS.delCat` fazia `DELETE ... WHERE id=?`
   sem checar vínculo — a exclusão sucedia mesmo com produtos referenciando a categoria em
   `categoria_ids` (text[], sem FK), deixando referência órfã. REF-ADMIN-01 · Onda 1 corrigiu:
   `DS.delCat` agora conta produtos vinculados (`.contains('categoria_ids',[id])`) ANTES de excluir e
   recusa com `{ok:false,count}` se houver algum; `AdminCategorias.jsx` mostra a contagem numa
   mensagem clara (`data-testid="cat-erro"`) e NÃO exclui nada. O teste abaixo prova o bloqueio real
   contra o backend (não só a mensagem na tela) — categoria e vínculo devem sobreviver íntegros. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { supabaseAdmin, E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';
import { limparCatalogoDeTeste } from '../../support/fixture-catalog-admin.js';

const NOME_CATEGORIA = 'E2E_TEST_CategoriaNova';
const NOME_CATEGORIA_EDITADA = 'E2E_TEST_CategoriaEditada';

test.describe('CRUD de Categorias', { tag: '@writes' }, () => {
  test.afterEach(async () => { await limparCatalogoDeTeste(); });

  test('cria, edita e exclui uma categoria', async ({ adminLoginPage, adminPanel, adminCategoriasPage, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('categorias');

    await adminCategoriasPage.abrirNova();
    await adminCategoriasPage.preencher({ nome: NOME_CATEGORIA, icone: '🧪', ordem: 999 });
    await adminCategoriasPage.salvar();
    await expect(page.getByText(NOME_CATEGORIA)).toBeVisible();

    const admin = supabaseAdmin();
    const { data: criada } = await admin.from('categories').select('id').eq('nome', NOME_CATEGORIA).single();

    await adminCategoriasPage.editar(criada.id);
    await adminCategoriasPage.preencher({ nome: NOME_CATEGORIA_EDITADA });
    await adminCategoriasPage.salvar();
    await expect(page.getByText(NOME_CATEGORIA_EDITADA)).toBeVisible();
    await expect(page.getByText(NOME_CATEGORIA, { exact: true })).toHaveCount(0);

    await adminCategoriasPage.excluir(criada.id);
    await expect(page.getByText(NOME_CATEGORIA_EDITADA)).toHaveCount(0);
  });

  test('nome vazio não salva e mantém o modal aberto', async ({ adminLoginPage, adminPanel, adminCategoriasPage, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('categorias');

    const contador = page.getByRole('heading', { name: /^Categorias \(\d+\)$/ });
    await expect(page.getByText('Carregando...')).toHaveCount(0); // aguarda o load real (1º paint sempre mostra "Categorias (0)")
    const antes = await contador.textContent();

    await adminCategoriasPage.abrirNova();
    await adminCategoriasPage.salvar(); // nome vazio -> save() é um no-op (achado: sem mensagem de erro)
    await expect(adminCategoriasPage.nomeInput).toBeVisible(); // modal continua aberto
    await expect(contador).toHaveText(antes); // nada foi criado
  });

  test('categoria "em uso" não é excluída — mensagem clara e zero órfãos (fix REF-ADMIN-01)', async ({ adminLoginPage, adminPanel, adminCategoriasPage }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    const admin = supabaseAdmin();
    const catId = `E2E_TEST_cat_em_uso_${Date.now()}`;
    const prodId = randomUUID();
    await admin.from('categories').insert({ id: catId, nome: 'E2E_TEST_CategoriaEmUso', ordem: 999, ativo: true, slug: `e2e-test-cat-em-uso-${Date.now()}`, tipo: 'business' });
    await admin.from('products').insert({ id: prodId, nome: 'E2E_TEST_ProdutoEmUso', descricao: 'teste', preco: 9.99, categoria_id: catId, categoria_ids: [catId], disponivel: true, adicionais_gratis: 0 });

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('categorias');

    await adminCategoriasPage.excluir(catId);
    await expect(adminCategoriasPage.erroMensagem).toBeVisible();
    await expect(adminCategoriasPage.erroMensagem).toContainText('1 produto');
    await expect(adminCategoriasPage.row(catId)).toBeVisible(); // continua na tela — não foi excluída

    const { data: categoria } = await admin.from('categories').select('id').eq('id', catId).maybeSingle();
    expect(categoria).not.toBeNull(); // sobreviveu no backend

    const { data: produto } = await admin.from('products').select('categoria_id,categoria_ids').eq('id', prodId).single();
    expect(produto.categoria_id).toBe(catId);
    expect(produto.categoria_ids).toContain(catId); // vínculo intacto, nenhum órfão gerado

    await admin.from('products').delete().eq('id', prodId);
    await admin.from('categories').delete().eq('id', catId);
  });

  test('categoria sem vínculo continua sendo excluída normalmente', async ({ adminLoginPage, adminPanel, adminCategoriasPage, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    const admin = supabaseAdmin();
    const catId = `E2E_TEST_cat_sem_uso_${Date.now()}`;
    await admin.from('categories').insert({ id: catId, nome: 'E2E_TEST_CategoriaSemUso', ordem: 999, ativo: true, slug: `e2e-test-cat-sem-uso-${Date.now()}`, tipo: 'business' });

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('categorias');

    await adminCategoriasPage.excluir(catId);
    await expect(page.getByText('E2E_TEST_CategoriaSemUso')).toHaveCount(0);
    await expect(adminCategoriasPage.erroMensagem).toHaveCount(0);

    const { data: categoria } = await admin.from('categories').select('id').eq('id', catId).maybeSingle();
    expect(categoria).toBeNull();
  });
});
