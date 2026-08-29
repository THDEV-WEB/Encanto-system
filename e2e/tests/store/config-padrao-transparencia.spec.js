/* e2e/tests/store/config-padrao-transparencia.spec.js — REF-STORE-ONBOARD-02 · Onda 2 (@writes).
   Prova, pela UI real (storefront + checkout + Admin), que uma loja SEM configuração própria de
   horário/entrega avisa o cliente e o admin de forma transparente -- sem alterar o comportamento de
   bloqueio existente (lojaFechada) nem o cálculo da taxa. Loja 100% descartável, com domínio próprio
   (`{slug}.localhost`) para o navegador resolver via get_store_by_domain -- nunca usa a Encanto/E2E
   default nem qualquer loja compartilhada com outros specs.

   Escopo desta suite (ver docs/ref/REF-STORE-ONBOARD-02-progress.md para a justificativa completa):
   cobre o aviso de horário (aberta/fechada) e o de "Entrega: A confirmar" (sem coordenadas, fluxo
   padrão sem precisar de endereço/geocoding). NÃO cobre o cenário "coordenadas presentes + tabela
   própria ausente" nesta camada (exigiria construir pela primeira vez uma infraestrutura de
   endereço/geocoding E2E para o checkout com entrega real -- escopo desproporcional a esta onda,
   focada em transparência, não em expandir infraestrutura de teste). Esse cenário já está provado
   ponta a ponta (RPC real + montarResumoFinanceiro real) em
   scripts/store-onboard-02-onda2-transparencia-test.mjs. */
import { test, expect } from '../../fixtures/index.js';
import { supabaseAdmin, E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';

const PORT = 5183; // mesma porta do webServer, e2e/playwright.config.js
const TS = Date.now();
const SLUG = `onda2-transp-e2e-${TS}`;
const HOST = `${SLUG}.localhost`;
const BASE = `http://${HOST}:${PORT}`;
const EMAIL_ADMIN = `onda2-transp-admin-${TS}@teste.encanto.local`;
const SENHA_ADMIN = `Onda2TranspSenha!${TS}`;

let storeId = null;
let categoriaId = null;
let adminUserId = null;
let PROD_ID = null; // uuid real (gen_random_uuid()), capturado após o insert

test.describe('transparência de configuração padrão/herdada (storefront + checkout + admin)', { tag: '@writes' }, () => {
  test.beforeAll(async () => {
    if (!E2E_ENV_PRONTO) return;
    const admin = supabaseAdmin();
    const { data: loja, error: errLoja } = await admin.from('stores')
      .insert({ slug: SLUG, nome: 'Onda2 Transparencia E2E', status: 'ativo', dominio: HOST })
      .select('id').single();
    if (errLoja) throw new Error(`setup loja: ${errLoja.message}`);
    storeId = loja.id;

    const { data: cat, error: errCat } = await admin.from('categories')
      .insert({ store_id: storeId, nome: 'Categoria Onda2', slug: `categoria-onda2-${TS}` })
      .select('id').single();
    if (errCat) throw new Error(`setup categoria: ${errCat.message}`);
    categoriaId = cat.id;

    const { data: prod, error: errProd } = await admin.from('products')
      .insert({ store_id: storeId, nome: 'Produto Onda2', preco: 10, disponivel: true, categoria_ids: [categoriaId] })
      .select('id').single();
    if (errProd) throw new Error(`setup produto: ${errProd.message}`);
    PROD_ID = prod.id;

    const { data: novoUsuario, error: errUser } = await admin.auth.admin.createUser({ email: EMAIL_ADMIN, password: SENHA_ADMIN, email_confirm: true });
    if (errUser) throw new Error(`setup admin descartável: ${errUser.message}`);
    adminUserId = novoUsuario.user.id;
    await admin.from('admins').insert({ store_id: storeId, user_id: adminUserId });
  });

  test.afterAll(async () => {
    if (!E2E_ENV_PRONTO) return;
    const admin = supabaseAdmin();
    if (storeId) {
      await admin.from('admins').delete().eq('store_id', storeId);
      await admin.from('store_settings').delete().eq('store_id', storeId);
      await admin.from('products').delete().eq('store_id', storeId);
      await admin.from('categories').delete().eq('store_id', storeId);
      await admin.from('stores').delete().eq('id', storeId);
    }
    if (adminUserId) await admin.auth.admin.deleteUser(adminUserId).catch(() => {});
  });

  test('loja sem NENHUMA config própria: aviso no cabeçalho + "Entrega: A confirmar" com explicação, sem bloquear navegação', async ({ page, cartSidebar, productModal, checkoutPage }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await page.goto(`${BASE}/encanto/`);

    // (1) Cabeçalho: aviso visível quando horário não é próprio (loja recém-criada, sem cronograma).
    await expect(page.getByTestId('header-config-padrao-aviso')).toBeVisible();

    // Adiciona o produto e vai para o checkout (modo padrão = "entrega", sem endereço escolhido).
    await page.locator(`[data-prod="${PROD_ID}"]`).scrollIntoViewIfNeeded();
    await page.locator(`[data-prod="${PROD_ID}"]`).click();
    await productModal.adicionar();
    await page.getByTestId('header-cart-btn').click();
    await cartSidebar.goToCheckout();

    // (5) "Entrega: A confirmar" continua funcionando (sem coordenadas -- nenhuma regra mudou) + nova
    // explicação curta, sem inventar termo técnico.
    await expect(page.getByText('A confirmar')).toBeVisible();
    await expect(page.getByText('Vamos confirmar o valor da entrega com você antes de despachar seu pedido.')).toBeVisible();

    // Preenche o essencial e confirma que o formulário segue utilizável (não travou por causa do aviso).
    await checkoutPage.preencher({ nome: 'Cliente Onda2', telefone: '47999998888' });
    await expect(checkoutPage.submitButton).toBeEnabled();
  });

  test('loja FECHADA (forçado) com horário não-próprio: aviso qualifica o bloqueio, sem mudar a regra', async ({ page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    const admin = supabaseAdmin();
    // Força CLOSED (independente do cronograma) -- schedule própria continua ausente nesta loja.
    await admin.from('store_settings').upsert({ store_id: storeId, chave: 'store_mode', valor: 'CLOSED' }, { onConflict: 'store_id,chave' });

    await page.goto(`${BASE}/encanto/`);
    await page.locator(`[data-prod="${PROD_ID}"]`).scrollIntoViewIfNeeded();
    await page.locator(`[data-prod="${PROD_ID}"]`).click();
    await page.locator('.modal-overlay').getByRole('button', { name: /Adicionar/ }).click();
    await page.locator('.modal-overlay').waitFor({ state: 'detached' });
    await page.getByTestId('header-cart-btn').click();
    await page.getByRole('button', { name: /Finalizar Pedido/ }).click();

    // (11) Regra de bloqueio fora do horário continua intacta -- botão de confirmar desabilitado.
    await expect(page.getByTestId('checkout-submit')).toBeDisabled();
    await expect(page.getByText('🔒 Loja fechada no momento')).toBeVisible();
    // (2) Aviso qualifica o fechamento como possivelmente não-definitivo (horário não é próprio).
    await expect(page.getByTestId('checkout-horario-config-padrao')).toBeVisible();

    await admin.from('store_settings').delete().eq('store_id', storeId).eq('chave', 'store_mode');
  });

  test('loja configurada (horário + entrega próprios): nenhum aviso de configuração padrão aparece', async ({ page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    const admin = supabaseAdmin();
    // (1)/(10): configura de verdade -- a partir daqui esta loja passa a ter config PRÓPRIA.
    await admin.from('store_settings').upsert([
      { store_id: storeId, chave: 'business_hours_schedule', valor: JSON.stringify({ version: 1, timezone: 'America/Sao_Paulo', schedule: {}, exceptions: {} }) },
      { store_id: storeId, chave: 'store_mode', valor: 'OPEN' },
      { store_id: storeId, chave: 'delivery_fee_config', valor: JSON.stringify({ version: 1, ativo: true, maquininha: { ativo: true, valor: 2 }, faixas: [{ de: 0, ate: 10, valor: 8 }] }) },
    ], { onConflict: 'store_id,chave' });

    await page.goto(`${BASE}/encanto/`);
    // (1) Nenhum aviso no cabeçalho quando a configuração é própria.
    await expect(page.getByTestId('header-config-padrao-aviso')).toHaveCount(0);

    await page.locator(`[data-prod="${PROD_ID}"]`).scrollIntoViewIfNeeded();
    await page.locator(`[data-prod="${PROD_ID}"]`).click();
    await page.locator('.modal-overlay').getByRole('button', { name: /Adicionar/ }).click();
    await page.locator('.modal-overlay').waitFor({ state: 'detached' });
    await page.getByTestId('header-cart-btn').click();
    await page.getByRole('button', { name: /Finalizar Pedido/ }).click();

    // Loja aberta (forçado OPEN) -- não deve aparecer nenhum bloqueio nem aviso de horário padrão.
    await expect(page.getByTestId('checkout-submit')).toBeEnabled();
    await expect(page.getByTestId('checkout-horario-config-padrao-aberta')).toHaveCount(0);

    await admin.from('store_settings').delete().eq('store_id', storeId);
  });

  test('AdminStatus: administrador da loja vê as pendências de configuração no ponto operacional principal', async ({ page, adminLoginPage, adminPanel }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    // Estado nesta altura: nenhuma config própria (a suite roda em ordem -- a spec anterior limpou tudo).
    await page.goto(`${BASE}/encanto/admin.html`);
    await adminLoginPage.login(EMAIL_ADMIN, SENHA_ADMIN);
    await adminPanel.abrirAba('status');

    const banner = page.getByTestId('admin-status-config-padrao');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Horário de Funcionamento');
    await expect(banner).toContainText('Taxa de Entrega');

    // Configura os dois -- o aviso deve sumir (mesma fonte, get_store_config_status).
    const admin = supabaseAdmin();
    await admin.from('store_settings').upsert([
      { store_id: storeId, chave: 'business_hours_schedule', valor: JSON.stringify({ version: 1, timezone: 'America/Sao_Paulo', schedule: {}, exceptions: {} }) },
      { store_id: storeId, chave: 'delivery_fee_config', valor: JSON.stringify({ version: 1, ativo: true, maquininha: { ativo: true, valor: 2 }, faixas: [{ de: 0, ate: 10, valor: 8 }] }) },
    ], { onConflict: 'store_id,chave' });
    await page.reload();
    await adminLoginPage.entrarReaproveitandoSessao();
    await adminPanel.abrirAba('status');
    await expect(page.getByTestId('admin-status-config-padrao')).toHaveCount(0);

    await admin.from('store_settings').delete().eq('store_id', storeId);
  });
});
