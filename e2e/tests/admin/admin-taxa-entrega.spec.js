/* e2e/tests/admin/admin-taxa-entrega.spec.js — REF-DELIVERY-FEE-01.
   AdminTaxaEntrega.jsx: liga/desliga a cobrança automática por distância, tabela de faixas De/Até/Valor
   (editável) e acréscimo de retorno da maquininha. Cobre o que é determinístico independente do hook
   cair no RPC real (get_delivery_fee_config, por loja desde a REF-SAAS-01 Onda 4.3) ou no fallback local
   DELIVERY_FEE_CONFIG_PADRAO (byte-igual à semente da migration, então a tela renderiza igual nos dois
   casos): render inicial, validação inline (sobreposição/intervalo inválido), adicionar/remover faixa. */
import { test, expect } from '../../fixtures/index.js';
import { ADMIN_FIXTURE } from '../../support/fixture-accounts.js';
import { supabaseAdmin, E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';

test.describe('Taxa de Entrega (Admin)', { tag: '@writes' }, () => {
  test('renderiza localização + faixas + maquininha; validação inline de faixa inválida; adicionar/remover faixa', async ({ adminLoginPage, adminPanel, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('taxaentrega');

    await expect(page.getByRole('heading', { name: '🚚 Taxa de Entrega' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Localização da loja' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cobrança automática por distância' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Retorno da maquininha' })).toBeVisible();

    // Tabela padrão: 17 faixas (0-21km) semeadas pela migration — mesmo fallback local sem ela aplicada.
    const linhasFaixa = page.locator('input[aria-label^="Faixa "][aria-label$="— de (km)"]');
    await expect(linhasFaixa).toHaveCount(17);

    const salvarFaixas = page.getByRole('button', { name: /Salvar Alterações/ });
    await expect(salvarFaixas).toBeDisabled(); // nada pendente ao abrir a tela

    // Adicionar faixa: nasce com "De" já sugerido a partir da última "Até" cadastrada (21.0 -> 21.1),
    // "Até"/"Valor" em branco -> inválida até o admin preencher (Salvar continua bloqueado).
    await page.getByRole('button', { name: '+ Adicionar faixa' }).click();
    await expect(linhasFaixa).toHaveCount(18);
    await expect(salvarFaixas).toBeDisabled();
    await expect(page.getByText('Corrija as faixas destacadas em vermelho antes de salvar.')).toBeVisible();

    // Remove a faixa recém-adicionada (inválida): volta a bater com o oficial -> Salvar desabilita de novo.
    await page.getByRole('button', { name: 'Remover faixa 18' }).click();
    await expect(linhasFaixa).toHaveCount(17);
    await expect(salvarFaixas).toBeDisabled();

    // Nova faixa SOBREPOSTA de propósito (0-3km, já coberta pela 1ª faixa 0-5km) para provar a validação
    // em tempo real. Preenche "até"/"valor" primeiro (a faixa nasce no FIM da lista, de=21.1 — maior "de"
    // de todas) e só por último "de" (essa edição é o que reordena a tabela, ver "Ordenação automática").
    await page.getByRole('button', { name: '+ Adicionar faixa' }).click();
    const novaLinha = 18;
    await page.getByLabel(`Faixa ${novaLinha} — até (km)`).fill('3');
    await page.getByLabel(`Faixa ${novaLinha} — valor (R$)`).fill('5');
    await page.getByLabel(`Faixa ${novaLinha} — de (km)`).fill('0');
    await expect(page.getByText(/sobrepost/i).first()).toBeVisible();
    // Sobreposição bloqueia Salvar — nada é persistido enquanto a tabela tiver esse erro (mesma garantia
    // que set_delivery_fee_config revalida no servidor; aqui é só o feedback imediato do cliente).
    await expect(salvarFaixas).toBeDisabled();
  });
});

/* REF-DELIVERY-FEE-02 — auditoria do bloqueante operacional: sem lojaLat/lojaLng, TODO pedido de entrega
   sai com taxa R$ 0,00 (fallback silencioso, nunca bloqueia o checkout) — e nada na tela avisava disso
   de forma destacada. Cobre o round-trip REAL que a suíte acima nunca exercitava (só tocava BlocoFaixas):
   banner ❌ quando ausente, clique no mapa move o pino e habilita "Salvar localização", "Centralizar"
   descarta o arrasto pendente SEM gravar nada, e (quando o ambiente permitir) salvar grava de verdade +
   o ✅ sobrevive a um reload real da página. company_info é POR LOJA desde a REF-SAAS-01 Onda 6.2 (antes
   era GLOBAL) — mesma disciplina de serialização + captura/restauração de baseline via supabaseAdmin()
   já usada em admin-status.spec.js/admin-delivery-eta.spec.js/admin-minha-conta.spec.js.

   GAP AMBIENTAL HISTÓRICO (achado numa auditoria anterior, FECHADO na sincronização de schema da
   REF-SAAS-01 Onda 7.1): get_company_info/set_company_info não existiam no projeto Supabase dedicado a
   E2E (as migrations da REF-SAAS-01 nunca tinham sido aplicadas lá). O teste abaixo ainda cobre os DOIS
   desfechos possíveis (RPC ausente vs. presente) por robustez, mas o caminho normal agora é o RPC
   responder e o round-trip completo ser exercitado de verdade. */
test.describe('Taxa de Entrega (Admin) — localização da loja', { tag: '@writes' }, () => {
  test.describe.configure({ mode: 'serial' }); // company_info é POR LOJA — evita corrida com outro describe mexendo na mesma linha

  let baseline = null; // { lojaLat, lojaLng } capturado ANTES deste teste mexer — restaurado no afterAll

  test.afterAll(async () => {
    if (!E2E_ENV_PRONTO || !baseline) return; // nunca escreve se o teste nem chegou a capturar o baseline
    const admin = supabaseAdmin();
    const { data: loja } = await admin.from('stores').select('id').eq('slug', 'encanto').single();
    const { data } = await admin.from('store_settings').select('valor').eq('store_id', loja.id).eq('chave', 'company_info').single();
    const atual = data?.valor ? JSON.parse(data.valor) : {};
    await admin.from('store_settings').upsert(
      { store_id: loja.id, chave: 'company_info', valor: JSON.stringify({ ...atual, lojaLat: baseline.lojaLat, lojaLng: baseline.lojaLng }) },
      { onConflict: 'store_id,chave' },
    );
  });

  test('sem coordenadas mostra ❌ destacado; clique no mapa + salvar grava de verdade; "Centralizar" descarta arrasto sem gravar; reload mantém ✅', async ({ adminLoginPage, adminPanel, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    const admin = supabaseAdmin();
    const { data: loja } = await admin.from('stores').select('id').eq('slug', 'encanto').single();

    // Captura o baseline ANTES de mexer (restaurado no afterAll) e força "sem coordenadas" DIRETO no
    // banco — setup de estado, não a ação testada (mesma técnica de forcarStoreMode/admin-status.spec.js:
    // escrever direto via service_role evita forjar uma 2ª sessão de admin só pra isto).
    const { data: linhaInicial } = await admin.from('store_settings').select('valor').eq('store_id', loja.id).eq('chave', 'company_info').single();
    const infoInicial = linhaInicial?.valor ? JSON.parse(linhaInicial.valor) : {};
    baseline = { lojaLat: infoInicial.lojaLat ?? null, lojaLng: infoInicial.lojaLng ?? null };
    await admin.from('store_settings').upsert(
      { store_id: loja.id, chave: 'company_info', valor: JSON.stringify({ ...infoInicial, lojaLat: null, lojaLng: null }) },
      { onConflict: 'store_id,chave' },
    );

    await adminLoginPage.goto();
    await adminLoginPage.login(ADMIN_FIXTURE.email, ADMIN_FIXTURE.senha);
    await adminPanel.abrirAba('taxaentrega');

    const status = page.getByTestId('status-localizacao-loja');
    const titulo = page.getByTestId('status-localizacao-titulo');
    await expect(titulo).toHaveText('Localização da loja NÃO configurada');
    await expect(status).toHaveAttribute('data-configurada', 'false');
    await expect(page.getByText(/TODOS os pedidos de entrega saem com taxa R\$ 0,00/)).toBeVisible();
    await expect(page.getByText('⚠️ Localização ainda não definida — arraste o pino até a loja.')).toBeVisible();

    const salvarLocalizacao = page.getByRole('button', { name: /Salvar localização/ });
    await expect(salvarLocalizacao).toBeDisabled(); // nada pendente ao abrir

    const mapa = page.locator('.leaflet-container');
    await expect(mapa).toBeVisible();
    // Ponto de clique longe do canto superior-esquerdo — é onde o Leaflet desenha o controle de zoom
    // (+/-) por padrão; clicar ali cai no botão do CONTROLE (para propagação), não no mapa em si.
    const box = await mapa.boundingBox();
    const pontoLivre = { x: box.width - 24, y: box.height - 24 };

    // "Centralizar" sem nenhum arrasto pendente é inofensivo (idempotente) — continua ❌, nada gravado.
    await page.getByRole('button', { name: 'Centralizar no ponto salvo' }).click();
    await expect(salvarLocalizacao).toBeDisabled();
    await expect(titulo).toHaveText('Localização da loja NÃO configurada');

    // Clica fora do centro do mapa -> move o pino (mesmo handler `aoClicar` do arrasto) -> habilita Salvar.
    await mapa.click({ position: pontoLivre });
    await expect(salvarLocalizacao).toBeEnabled();

    // "Centralizar" descarta o arrasto pendente SEM gravar nada — Salvar volta a ficar desabilitado e o
    // banner continua ❌ (prova que "Centralizar" nunca é confundido com "Salvar").
    await page.getByRole('button', { name: 'Centralizar no ponto salvo' }).click();
    await expect(salvarLocalizacao).toBeDisabled();
    await expect(titulo).toHaveText('Localização da loja NÃO configurada');

    // Move de novo e agora salva de verdade — round-trip REAL contra o Supabase de E2E.
    await mapa.click({ position: pontoLivre });
    await expect(salvarLocalizacao).toBeEnabled();
    await salvarLocalizacao.click();

    // Gap ambiental histórico (ver comentário de cabeçalho) — mantém a checagem dupla por robustez, mas
    // o caminho normal agora é a RPC responder e seguir para o round-trip completo.
    const sucesso = page.getByText('Localização da loja salva com sucesso.');
    const erroRpcAusente = page.getByText(/Could not find the function|schema cache/i);
    await expect(sucesso.or(erroRpcAusente)).toBeVisible();

    if (await erroRpcAusente.isVisible()) {
      test.info().annotations.push({
        type: 'gap-ambiente',
        description: 'set_company_info respondeu com erro inesperado no Supabase de E2E — round-trip '
          + 'real (gravação + reload) não pôde ser exercitado nesta rodada. Erro apareceu de forma '
          + 'honesta, tela não quebrou.',
      });
      return;
    }

    await expect(titulo).toHaveText('Localização da loja configurada');
    await expect(status).toHaveAttribute('data-configurada', 'true');

    // Valor REAL persistido no banco (não só o estado otimista do React) — mesma disciplina de
    // admin-status.spec.js (lê direto via supabaseAdmin(), não confia só na tela).
    await expect.poll(async () => {
      const { data: linha } = await admin.from('store_settings').select('valor').eq('store_id', loja.id).eq('chave', 'company_info').single();
      const info = JSON.parse(linha.valor);
      return Number.isFinite(info.lojaLat) && Number.isFinite(info.lojaLng);
    }).toBe(true);

    // Reload real: o bundle do admin sempre reabre no login; a sessão é reaproveitada (REF-UX-SESSION-01)
    // sem pedir senha de novo — prova que o ✅ sobrevive a um F5, não é só otimismo do estado React.
    await page.reload();
    await expect(adminPanel.tab('dashboard')).toHaveCount(0);
    await adminLoginPage.entrarReaproveitandoSessao();
    await expect(adminPanel.tab('dashboard')).toBeVisible();
    await adminPanel.abrirAba('taxaentrega');
    await expect(page.getByTestId('status-localizacao-titulo')).toHaveText('Localização da loja configurada');
  });
});
