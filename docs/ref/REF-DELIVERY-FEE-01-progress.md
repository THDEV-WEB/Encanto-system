# REF-DELIVERY-FEE-01 — Taxa de entrega automática por distância — progresso

Arquivo de retomada. Se a execução for interrompida, retomar EXCLUSIVAMENTE a partir daqui.

Detalhe arquitetural completo em
`docs/adr/REF-DELIVERY-FEE-01-taxa-entrega-por-distancia.md`.

## Estado atual

✅ **Implementada no código (7 ondas), testada (golden + guard + E2E real contra o Supabase de E2E) e
commitada localmente (7 commits, um por onda).** **2 migrations pendentes de aplicação manual no Supabase
de produção** — nenhum pedido real é cobrado até isso acontecer. Push para `origin/main` **não realizado
ainda** (aguardando autorização explícita do dono, mesmo padrão de sempre).

## Onda 1 — Fundação de dados (migrations SQL) — concluída

`migrations/REF-DELIVERY-FEE-01-step1-fee-config-rpc.sql` (+rollback): chave `delivery_fee_config` em
`settings` (ativo/faixas/maquininha), RPCs `get_/set_delivery_fee_config`, semente com as 17 faixas
fornecidas pelo dono. `migrations/REF-DELIVERY-FEE-01-step2-orders-schema.sql` (+rollback): colunas
`orders.delivery_fee`/`maquininha_fee`, `create_order` e `admin_orders_search` atualizadas. Commit
`f31b69b`.

## Onda 2 — Camada pura de domínio — concluída

`services/delivery/deliveryFeeRules.js` (localizarFaixa/calcularMaquininhaFee/montarResumoFinanceiro) +
`distanciaKm` (haversine) em `address/utils/coordinates.js`. `tests/deliveryFee.golden.mjs` criado.
Commit `289275c` (junto com a Onda 3).

## Onda 3 — Camada IO/cache + formulário Admin + localização da loja — concluída

`services/delivery/deliveryFeeConfig.js` + `deliveryFeeConfigForm.js` + `hooks/useDeliveryFeeConfig.js`
(espelham 1:1 `cronograma.js`/`scheduleForm.js`/`useBusinessHoursSchedule.js`). `company_info` ganha
`lojaLat`/`lojaLng` (sem migration — precedente REF-COMPANY-03). `tests/company-info.golden.mjs`
atualizado (27 campos). Commit `289275c`.

## Onda 4 — Integração no Checkout — concluída

Cálculo em tempo real (`useMemo` sobre `montarResumoFinanceiro`), fallback de geocodificação para o
fluxo por CEP (`geocoding.coordenadasDe`, novo método em `geocodingService.js`), `buildOrderArgs`/
`buildOrderConfirmationMessage`/`buildCheckoutView` ganham `resumo` opcional (compat total).
`tests/checkout.golden.mjs` atualizado (payload, pins de fonte, view com/sem resumo). Commit `336b860`.

## Onda 5 — Comanda + WhatsApp — concluída

`comandaModel.js` lê `delivery_fee`/`maquininha_fee` explícitos (delta vira só resíduo não explicado).
`comandaTexto.js` (interna + cliente) e `comandaHtml.js` ganham as linhas de Entrega/Maquininha — a
mensagem do cliente deixa de suprimir a taxa (antes proposital, "ainda não calculada"). 8 casos novos em
`tests/comanda.golden.mjs`. Commit `1899643`.

## Onda 6 — Painel Admin — concluída

Nova aba "🚚 Taxa de Entrega" (`AdminTaxaEntrega.jsx`): mapa de localização da loja (reaproveita
`mapService.js`), tabela de faixas editável (validação inline via `deliveryFeeConfigForm.js`), toggle+
valor da maquininha. `AdminPedidos.jsx` exibe os valores no card. `tests/deliveryFee-admin.guard.mjs`
(estrutural) + `e2e/tests/admin/admin-taxa-entrega.spec.js` — **rodado de verdade** contra o Supabase de
E2E, confirmado visualmente (screenshot do mapa/tabela renderizados). Ajuste em `e2e/pages/
AdminPanel.page.js` (allowlist de abas). Commit `2e739aa`.

## Onda 7 — Testes finais, revisão adversarial, documentação — em andamento

- Revisão adversarial própria (sem subagente, releitura crítica de cada arquivo tocado): confirmou
  consistência de fallback (maquininha independente do toggle de distância), pureza dos módulos novos,
  ausência de regressão nos golden tests pré-existentes. Pequeno refinamento de UX aplicado sob a
  autonomia concedida: `AdminTaxaEntrega` bloqueia "Salvar" quando a tabela de faixas fica vazia
  (`semFaixas`), evitando um round-trip de erro do servidor.
- **Achado registrado, não corrigido:** `v_order_reconciliation`/`orders_health()` (painel "Saúde do
  Sistema") ainda calcula divergência como `total - Σ(itens)`, sem descontar `delivery_fee`/
  `maquininha_fee` — pedidos de entrega com taxa vão aparecer como "divergência" mesmo estando corretos.
  Não redefini a view às cegas (introspecção via PostgREST no projeto de E2E só revelou as colunas
  `order_id`/`total`/`diff`, não a definição SQL completa — sem acesso a `pg_catalog` pela API). Ver ADR
  §3 para o encaminhamento recomendado.
- `test:domain` 37/37 + `test:deps` + `test:delivery-fee-admin-guard` + `npm run build` verdes a cada
  onda. `e2e/tests/admin/admin-taxa-entrega.spec.js` passou de verdade (não é golden estático).
- Documentação: este arquivo + ADR completo + índice `docs/adr/README.md` atualizado.
- Commits ficam **locais** até o dono autorizar push (nenhuma migration foi aplicada ainda — aplicar o
  código sem o schema deixaria tudo em modo degradado/fallback, mas sem quebrar nada: `get_delivery_fee_config`
  ausente cai no mesmo fallback local; `create_order` sem as colunas novas simplesmente ignoraria os 2
  campos extras do payload).

## Pendências (ação do dono)

1. Aplicar `REF-DELIVERY-FEE-01-step1-fee-config-rpc.sql` no SQL Editor.
2. Aplicar `REF-DELIVERY-FEE-01-step2-orders-schema.sql` no SQL Editor.
3. Entrar no Admin > Taxa de Entrega e arrastar o pino até a localização real da loja (sem isso, nenhum
   pedido tem taxa calculada — cai no fallback "sem coordenadas").
4. Autorizar o push para `origin/main` (deploy automático via Vercel).
5. (Opcional, não bloqueante) redefinir `v_order_reconciliation` — ver ADR §3.
