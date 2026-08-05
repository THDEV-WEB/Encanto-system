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
import { E2E_ENV_PRONTO } from '../../support/supabaseAdmin.js';

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
