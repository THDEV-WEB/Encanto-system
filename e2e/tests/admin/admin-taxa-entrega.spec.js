/* e2e/tests/admin/admin-taxa-entrega.spec.js — REF-DELIVERY-FEE-01.
   AdminTaxaEntrega.jsx: liga/desliga a cobrança automática por distância, tabela de faixas De/Até/Valor
   (editável) e acréscimo de retorno da maquininha. Cobre o que é determinístico INDEPENDENTE da migration
   estar aplicada no Supabase de E2E (get_delivery_fee_config ainda pode não existir lá — o hook cai no
   MESMO fallback local DELIVERY_FEE_CONFIG_PADRAO, byte-igual à semente da migration, então a tela
   renderiza igual em ambos os casos): render inicial, validação inline (sobreposição/intervalo inválido),
   adicionar/remover faixa. O round-trip de escrita real (set_delivery_fee_config) exige a migration
   REF-DELIVERY-FEE-01-step1 aplicada no projeto de E2E — mesma disciplina de REF-ADDRESS-02 (Mapbox sem
   integração real testada até haver token): documentado como gap conhecido, não escondido. */
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
   o ✅ sobrevive a um reload real da página. company_info é GLOBAL — mesma disciplina de serialização +
   captura/restauração de baseline via supabaseAdmin() já usada em admin-status.spec.js/
   admin-delivery-eta.spec.js/admin-minha-conta.spec.js.

   GAP AMBIENTAL PRÉ-EXISTENTE achado nesta auditoria (não introduzido por esta ref, confirmado via REST
   direto — PGRST202): get_company_info/set_company_info NÃO existem no projeto Supabase dedicado a E2E —
   as migrations REF-COMPANY-01/02 nunca foram aplicadas lá (só em produção). Não há hoje NENHUM spec de
   AdminEmpresa.jsx cobrindo escrita real por esse mesmo motivo. O teste abaixo cobre os DOIS desfechos: se
   a RPC responder, valida o round-trip completo; se não existir ainda, prova que o erro aparece de forma
   honesta (TRUTHFUL, nunca finge sucesso) e a tela não quebra — documentado, não escondido (mesmo espírito
   do gap do token Mapbox em REF-ADDRESS-02). */
test.describe('Taxa de Entrega (Admin) — localização da loja', { tag: '@writes' }, () => {
  test.describe.configure({ mode: 'serial' }); // company_info é GLOBAL — evita corrida com outro describe mexendo na mesma linha

  let baseline = null; // { lojaLat, lojaLng } capturado ANTES deste teste mexer — restaurado no afterAll

  test.afterAll(async () => {
    if (!E2E_ENV_PRONTO || !baseline) return; // nunca escreve se o teste nem chegou a capturar o baseline
    const admin = supabaseAdmin();
    const { data } = await admin.from('settings').select('valor').eq('chave', 'company_info').single();
    const atual = data?.valor ? JSON.parse(data.valor) : {};
    await admin.from('settings').upsert(
      { chave: 'company_info', valor: JSON.stringify({ ...atual, lojaLat: baseline.lojaLat, lojaLng: baseline.lojaLng }) },
      { onConflict: 'chave' },
    );
  });

  test('sem coordenadas mostra ❌ destacado; clique no mapa + salvar grava de verdade; "Centralizar" descarta arrasto sem gravar; reload mantém ✅', async ({ adminLoginPage, adminPanel, page }) => {
    test.skip(!E2E_ENV_PRONTO, 'ambiente de E2E não configurado (.env.e2e)');
    const admin = supabaseAdmin();

    // Captura o baseline ANTES de mexer (restaurado no afterAll) e força "sem coordenadas" DIRETO no
    // banco — setup de estado, não a ação testada (mesma técnica de forcarStoreMode/admin-status.spec.js:
    // escrever direto via service_role evita forjar uma 2ª sessão de admin só pra isto).
    const { data: linhaInicial } = await admin.from('settings').select('valor').eq('chave', 'company_info').single();
    const infoInicial = linhaInicial?.valor ? JSON.parse(linhaInicial.valor) : {};
    baseline = { lojaLat: infoInicial.lojaLat ?? null, lojaLng: infoInicial.lojaLng ?? null };
    await admin.from('settings').upsert(
      { chave: 'company_info', valor: JSON.stringify({ ...infoInicial, lojaLat: null, lojaLng: null }) },
      { onConflict: 'chave' },
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

    // GAP AMBIENTAL PRÉ-EXISTENTE (achado real desta auditoria, não introduzido pela REF-DELIVERY-FEE-02):
    // confirmado via REST direto (PGRST202) que get_company_info/set_company_info NÃO existem no projeto
    // Supabase dedicado a E2E — REF-COMPANY-01/02 nunca foram aplicadas lá (só na produção). O client já é
    // TRUTHFUL para esse caso: salvarCompanyInfo nunca finge sucesso, devolve {ok:false, error} e a tela
    // mostra o erro real em vez de quebrar. Testamos os DOIS desfechos possíveis: se a RPC responder,
    // seguimos para o round-trip completo (grava-de-verdade + reload); se a RPC ainda não existir neste
    // ambiente, provamos que o erro aparece de forma honesta (nunca uma tela em branco/crash) e encerramos
    // aqui — documentado, não escondido (mesmo padrão de REF-ADDRESS-02 com o token do Mapbox pendente).
    const sucesso = page.getByText('Localização da loja salva com sucesso.');
    const erroRpcAusente = page.getByText(/Could not find the function|schema cache/i);
    await expect(sucesso.or(erroRpcAusente)).toBeVisible();

    if (await erroRpcAusente.isVisible()) {
      test.info().annotations.push({
        type: 'gap-ambiente',
        description: 'set_company_info ausente no Supabase de E2E (migrations REF-COMPANY-01/02 nunca '
          + 'aplicadas lá) — round-trip real (gravação + reload) não pôde ser exercitado nesta rodada. '
          + 'Erro apareceu de forma honesta, tela não quebrou. Aplicar as migrations no projeto de E2E '
          + 'para fechar esta lacuna.',
      });
      return;
    }

    await expect(titulo).toHaveText('Localização da loja configurada');
    await expect(status).toHaveAttribute('data-configurada', 'true');

    // Valor REAL persistido no banco (não só o estado otimista do React) — mesma disciplina de
    // admin-status.spec.js (lê direto via supabaseAdmin(), não confia só na tela).
    await expect.poll(async () => {
      const { data: linha } = await admin.from('settings').select('valor').eq('chave', 'company_info').single();
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
