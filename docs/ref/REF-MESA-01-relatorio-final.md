# REF-MESA-01 — Relatório Final (Ondas 0-8)

**Status: PARADA NO GATE FINAL — todas as 8 ondas concluídas e testadas. Nada foi pushed, nada foi
aplicado em produção, nenhuma REF nova foi iniciada.**

Execução autônoma, gated onda a onda (auditoria → implementação → testes → correção de regressões →
revalidação → commit → onda seguinte), conforme o plano recebido. Este documento consolida tudo.

---

## 1. Ondas executadas

| Onda | Conteúdo | Status |
|---|---|---|
| 0 | Auditoria completa + plano técnico | ✅ Concluída |
| 1 | Fundação do domínio (schema + capability + validação server-side) | ✅ Concluída |
| 2 | Checkout/storefront (Mesa no cliente) | ✅ Concluída |
| 3 | Canal QR | ✅ Concluída |
| 4 | Canal Admin/garçom | ✅ Concluída |
| 5 | Propagação pra Admin/Comanda (elimina regex) | ✅ Concluída |
| 6 | Relatórios/Métricas | ✅ Concluída |
| 7 | WhatsApp/notificações | ✅ Concluída |
| 8 | Auditoria final + regressão completa + este relatório | ✅ Concluída |

Nenhuma onda foi pulada. Nenhum trabalho foi refeito por troca de contexto/sessão — o checkpoint
(`docs/ref/REF-MESA-01-checkpoint.md`) manteve a continuidade em pelo menos uma renovação de sessão.

---

## 2. Commits (todos locais, nenhum pushed)

```
af50c3a docs(mesa): REF-MESA-01 Onda 0 -- auditoria completa + plano tecnico de ondas
e972e1a feat(orders): REF-MESA-01 Onda 1 -- fundacao do dominio multicanal de atendimento
fff4946 docs(mesa): REF-MESA-01 checkpoint de retomada -- Onda 2 em andamento
287ee04 feat(checkout): REF-MESA-01 Onda 2 -- mesa no storefront/checkout
6875bf3 docs(mesa): REF-MESA-01 checkpoint -- Onda 2 concluida, plano da Onda 3
ddb0743 feat(orders): REF-MESA-01 Onda 3 -- canal QR de mesa
d1856c6 docs(mesa): REF-MESA-01 checkpoint -- Onda 3 concluida, plano da Onda 4
78e79f0 feat(admin): REF-MESA-01 Onda 4 -- canal Admin/garcom (criacao manual)
5c05be1 docs(mesa): REF-MESA-01 checkpoint -- Onda 4 concluida, plano da Onda 5
67f4bd2 feat(admin): REF-MESA-01 Onda 5 -- propaga tipo_pedido estruturado
f7750b9 docs(mesa): REF-MESA-01 checkpoint -- Onda 5 concluida, plano da Onda 6
cc1ab30 feat(admin): REF-MESA-01 Onda 6 -- relatorios separam Mesa (achado mais grave da auditoria)
7ba260c docs(mesa): REF-MESA-01 checkpoint -- Onda 6 concluida, plano da Onda 7
572cf72 feat(notifications): REF-MESA-01 Onda 7 -- WhatsApp trata Mesa corretamente
f1ff654 docs(mesa): REF-MESA-01 checkpoint -- Onda 7 concluida, iniciando Onda 8
```

(Um commit de outra sessão, `015dc80` — REF-ADDRESS-GEO-INTEGRITY-01 — aparece intercalado
cronologicamente entre `287ee04` e `d1856c6`; não pertence a esta REF, não foi tocado, listado aqui
só para não causar confusão em quem ler `git log` bruto.)

47 arquivos alterados no total (excluindo o próprio checkpoint), ~4.900 linhas adicionadas, ~95
removidas — a esmagadora maioria é adição (migrations + testes novos + componentes novos), não
reescrita de código existente.

---

## 3. Arquivos principais

**Frontend novo:**
`src/hooks/useMesaConfig.js`, `src/hooks/useMesaFromQuery.js`, `src/services/mesa/mesaConfig.js`,
`src/components/admin/NovoPedidoMesaModal.jsx`.

**Frontend editado:** `src/components/DeliveryBar.jsx`, `src/pages/StoreApp.jsx`,
`src/components/checkout/CheckoutPage.jsx`, `src/components/checkout/SuccessPage.jsx`,
`src/utils/orderPayload.js`, `src/components/admin/AdminPedidos.jsx`,
`src/components/admin/AdminRelatorios.jsx`, `src/components/admin/PedidoNotificacoes.jsx`,
`src/components/admin/comanda/comandaModel.js`, `src/components/pedidos/pedidoStatus.js`,
`src/services/delivery/deliveryEtaFormat.js`, `src/services/notifications/messageTemplates.js`,
`src/services/DataService.js`.

**E2E:** `e2e/pages/AdminPedidosPage.page.js`, `e2e/support/fixture-order.js` (corrigido, ver §16),
`e2e/support/mesaMode.js` (novo), `e2e/tests/admin/admin-pedidos-novo-mesa.spec.js` (novo).

**Testes de domínio editados:** `tests/checkout.golden.mjs`, `tests/comanda.golden.mjs`,
`tests/order-status.guard.mjs`, `tests/whatsapp-templates.golden.mjs`.

**Scripts de teste de banco (novos, um por onda):** `scripts/mesa-01-onda1-fundacao-test.mjs`,
`-onda3-canal-qr-test.mjs`, `-onda4-canal-admin-test.mjs`, `-onda5-admin-orders-search-test.mjs`,
`-onda6-admin-reports-test.mjs`, `-onda7-notificacoes-test.mjs`.

**Documentação:** `docs/ref/REF-MESA-01-auditoria.md`, `-plano-ondas.md`, `-checkpoint.md`, este
relatório.

---

## 4. Migrations (todas aplicadas SOMENTE no projeto Supabase de E2E dedicado, `bgzcro...`, "nunca
produção" por documentação do próprio repo — NUNCA em `db.env`/hvbcdx nem produção real)

| Migration | O que faz |
|---|---|
| `REF-MESA-01-onda1-fundacao.sql` | Colunas `tipo_pedido`/`origem_pedido`/`mesa_identificador` em `orders` + CHECKs; `get_mesa_config`/`set_mesa_config`; `create_order()` valida `mesa_habilitada` |
| `REF-MESA-01-onda3-canal-qr.sql` | `create_order()` valida `mesa_canal_qr` quando `origem_pedido='qr_mesa'` |
| `REF-MESA-01-onda4-canal-admin.sql` | `create_order()` valida `mesa_canal_admin` + `is_admin_of()` quando `origem_pedido='admin_garcom'` |
| `REF-MESA-01-onda5-admin-orders-search.sql` | `admin_orders_search()` devolve as 3 colunas novas |
| `REF-MESA-01-onda6-admin-reports.sql` | `admin_reports_summary()::por_tipo` usa `tipo_pedido` em vez de regex |
| `REF-MESA-01-onda7-notificacoes-mesa.sql` | `enc_tempo_estimado`/`enc_enqueue_notification`/`enc_render_message` tratam Mesa; elimina a última regex do sistema |

Cada uma tem rollback correspondente (`-rollback.sql`), testado por construção (todas restauram a
versão anterior EXATA — para a Onda 7, a versão anterior real ao vivo no E2E, que por sua vez já
estava desatualizada em relação ao git, ver §16).

**Nenhuma migration foi aplicada em produção. Todas aguardam decisão do dono do produto para
aplicação (fora do escopo desta REF — aplicação em produção nunca foi autorizada).**

---

## 5. RPCs alteradas

`create_order()` (Ondas 1/3/4 — cada uma soma uma checagem, nunca reescreve as anteriores),
`get_mesa_config()`/`set_mesa_config()` (novas, Onda 1), `admin_orders_search()` (Onda 5),
`admin_reports_summary()` (Onda 6), `enc_tempo_estimado()`/`enc_enqueue_notification()`/
`enc_render_message()` (Onda 7). **`_resolve_delivery_fee()` NUNCA foi tocada** (confirmado por
verificação direta na Onda 8 — zero menção a "mesa"/"tipo_pedido" no seu corpo) — Mesa sempre
reaproveitou o ramo "sem taxa" que retirada já tinha, só variando o booleano que `create_order`
passa pra ela.

---

## 6. Modelo final de dados

```
orders.tipo_pedido         text NOT NULL DEFAULT 'entrega'
                            CHECK IN ('entrega','retirada','mesa')
orders.origem_pedido       text NOT NULL DEFAULT 'storefront'
                            CHECK IN ('storefront','qr_mesa','admin_garcom')
orders.mesa_identificador  text NULL
                            CHECK (coerente com tipo_pedido='mesa', 1-40 chars quando presente)
```

`address` permanece `NOT NULL`, mas agora é **só texto de exibição** — nunca mais fonte de verdade
do tipo (o motivo desta REF inteira existir). Para mesa, vira `'Mesa ' || mesa_identificador` quando
o client não fornece endereço nenhum.

**Capability por loja** (`store_settings`, mesmo molde de `loyalty_enabled`):
`mesa_habilitada`, `mesa_canal_qr`, `mesa_canal_admin` — 3 chaves flat independentes, default seguro
= tudo `false` (nenhuma loja existente ganhou Mesa automaticamente).

---

## 7. Configuração por tenant

Cada loja controla independentemente: (a) se aceita Mesa (`mesa_habilitada`), (b) se aceita pedidos
via QR (`mesa_canal_qr`), (c) se aceita pedidos lançados pelo garçom/Admin (`mesa_canal_admin`).
Nenhuma dessas 3 depende uma da outra estruturalmente — uma loja pode ter Mesa habilitada só para o
canal Admin (garçom lança manualmente) sem QR, por exemplo. `get_mesa_config`/`set_mesa_config`
seguem exatamente o padrão já usado por `loyalty_enabled` (leitura pública, escrita `is_admin_of`).

**Gap registrado:** não existe ainda uma tela de Admin para LIGAR essas capabilities — `set_mesa_config`
existe desde a Onda 1 sem consumidor de UI. Só foi ligado via script/service_role nos testes desta
REF. Ver §17.

---

## 8. Fluxo Delivery (Entrega) — preservado, testado, zero regressão

Comportamento idêntico a antes desta REF em toda a extensão: seleção no `DeliveryBar`, endereço
obrigatório, geocoding, cálculo de distância/taxa via `_resolve_delivery_fee` (intocada), badge
"🛵 Entrega", trilha de status completa (5 passos, inclui "Saiu para entrega"), notificações com
`{{tempo}}`="até Nmin" e `{{situacao}}`="Nosso entregador sairá em instantes.". Confirmado por
regressão em 129 checks de backend de outras REFs + dezenas de specs E2E de checkout.

## 9. Fluxo Retirada — preservado, testado, zero regressão

Idêntico a antes: sem endereço, sem taxa, badge "🏪 Retirada", trilha de 4 passos (sem "Saiu para
entrega"), notificações com `{{tempo}}`="cerca de 20 min" e `{{situacao}}`="Já pode ser buscado.".

## 10. Fluxo Mesa — implementado ponta a ponta

- **Storefront:** 3ª opção no seletor (só visível com `mesa_habilitada`), sem endereço/geocoding/
  taxa, campo "Número da mesa", confirmação sem ETA de entrega fabricado, trilha de status própria
  (Recebido→Em preparo→Pronto→Servido, sem "Saiu para entrega").
- **Backend:** `tipo_pedido='mesa'` estruturado, validado fail-closed no servidor.
- **Admin/Comanda:** badge "🍽️ Mesa {id}", comanda mostra "MESA" + a mesa (não endereço).
- **Relatórios:** fatia própria em `por_tipo`, nunca somada a Entrega.
- **WhatsApp:** `{{tempo}}`="preparo em andamento", `{{situacao}}`="Em breve será servido em sua
  mesa.".
- **Fidelidade:** concede selo normalmente (confirmado — `loyalty_grant` é 100% agnóstico a tipo,
  nenhuma mudança de código necessária).
- **Pagamento:** todas as formas funcionam igual (campo `payment_method` sempre foi independente do
  tipo). Decisão de produto em aberto: se `maquininha_fee` deveria se aplicar a Mesa (hoje herda o
  mesmo "sem taxa" de retirada) — registrado, não decidido (ver §17).

## 11. Canal QR

Link `https://{slug}.dominio/?mesa=07` — reaproveita a resolução de loja por domínio já existente
(zero infraestrutura nova, zero superfície de cross-tenant por construção, já que não há `store_id`
nenhum no link). `useMesaFromQuery` aplica automaticamente quando `mesa_canal_qr=true`. Servidor
valida a capacidade de novo, fail-closed. Geração/impressão de imagem de QR ficou fora do escopo
(visual/operacional, não arquitetural).

## 12. Canal Garçom/Admin

Primeira tela do Admin capaz de criar pedido manualmente (`NovoPedidoMesaModal.jsx`) — até esta REF,
**nenhuma existia**. Reaproveita `create_order()` via `DS.savePedidoAdmin` (nova, corrige um bug real
que teria sido introduzido se `savePedido` do cliente fosse reaproveitada ingenuamente — ver §17).
Exige `mesa_canal_admin=true` **e** que o chamador seja `is_admin_of` daquela loja especificamente
(diferente do canal QR, que é do cliente final sem checagem de papel).

## 13. Admin (geral)

`AdminPedidos.jsx`: badge de 3 vias, botão condicional de novo pedido, mostra `mesa_identificador`.
`fluxoDoTipo`/`FLUXO_MESA` corrigidos (`pedidoStatus.js`). Nenhuma outra tela do Admin (Dashboard,
Saúde, Produtos, Categorias, etc.) tinha dependência de tipo de pedido — confirmado por varredura.

## 14. Comanda

`comandaModel.js::tipoDoPedido` lê `orders.tipo_pedido` estruturado (regex vira fallback defensivo,
nunca mais o caminho normal). `tipoLabel`/`tipoLabelCliente`/`previsao`/`previsaoLabel`/`endereco`
todos com 3º ramo explícito. `comandaHtml.js`/`comandaTexto.js` não precisaram de nenhuma mudança
(são renderers passivos, já herdaram o fix de graça).

## 15. Relatórios

`admin_reports_summary()::por_tipo` — achado mais grave de toda a auditoria original (Mesa
contabilizada silenciosamente como Entrega no BI) — corrigido na Onda 6, com teste dedicado provando
3 fatias distintas (5/5 checks).

## 16. WhatsApp/Notificações

Template `'pronto'` parou de hedgear "se for retirada/se for entrega" (não escalaria pra 3 modos) —
virou `{{situacao}}`, resolvida no enqueue (nunca no render), JS↔SQL espelhados byte a byte (o
próprio golden test compara literalmente). `enc_tempo_estimado` eliminou a última regex do sistema
inteiro. **Achado operacional registrado, não é bug desta REF:** a versão de `enc_render_message` ao
vivo no projeto de E2E ainda era a de `REF-ORDER-01b` (hardcoded "Encanto Delivery", nunca
substituía `{{empresa}}`) — o fix de `REF-COMPANY-02` (commitado 2026-07-26) nunca tinha sido
aplicado nesse ambiente especificamente. A migration da Onda 7 partiu da versão já commitada
(correta) como base — não foi uma correção "de carona" fora de escopo, era a linha de base que
qualquer alteração desta função precisaria de qualquer forma.

---

## 17. Segurança

- **Fail-closed em 3 pontos independentes** dentro de `create_order()`: `mesa_habilitada` (Onda 1),
  `mesa_canal_qr` (Onda 3), `mesa_canal_admin` + `is_admin_of` (Onda 4) — cada capability checada no
  MESMO ponto onde o tenant já é resolvido com confiança (padrão herdado de REF-ORDER-TENANT-01).
- **Canal Admin/garçom exige papel, canal QR não** — decisão deliberada: QR é pro cliente final
  (guest ou logado), Admin/garçom exige ser administrador daquela loja específica. Testado
  explicitamente (cross-tenant, authenticated sem vínculo, bypass anon — todos bloqueados).
- **`resolve_store_from_origin()`/JWT `tenant_id`** continuam sendo a única fonte de verdade pra
  `store_id` — nenhum novo vetor de manipulação foi introduzido (QR nunca carrega `store_id`, só o
  identificador da mesa, que não afeta preço/isolamento).
- **`_resolve_item_pricing`/preço autoritativo** intocados — Mesa segue exatamente a mesma regra de
  preço server-side de qualquer outro pedido.
- **Achado técnico corrigido durante a implementação (não é falha de segurança, é bug de correção
  evitado):** `DataService.savePedido` (do cliente) usa `buildStorefrontRpcParam()`, que nunca
  resolve dentro do bundle Admin. Se `NovoPedidoMesaModal` tivesse reaproveitado essa função
  ingenuamente, o pedido cairia silenciosamente em `default_store_id()` em vez da loja ativa do
  seletor multi-loja do Admin — bug real de isolamento em cenário multi-loja. Corrigido com
  `savePedidoAdmin` (usa `buildStoreRpcParam`, o mesmo já usado por toda RPC Admin-only existente).

## 18. Compatibilidade histórica

`tipo_pedido`/`origem_pedido` nascem com `DEFAULT` seguro e verdadeiro para todo o histórico
(`'entrega'`/`'storefront'`) — Postgres aplica o default a linhas existentes sem reescrever a tabela
e sem heurística nenhuma rodando sobre dado antigo. `origem_pedido='storefront'` não é uma suposição:
é fato, porque nenhum outro canal existia antes desta REF. Nenhum pedido histórico foi reinterpretado
de forma ambígua — exatamente a exigência do plano original.

---

## 19. Testes por onda (resumo — detalhe completo em cada mensagem de commit)

| Onda | Testes de banco (E2E) | Testes de domínio novos | E2E específico |
|---|---|---|---|
| 1 | 26/26 | — | — |
| 2 | — (frontend puro) | 2 pins atualizados | 9/9 checkout |
| 3 | 8/8 | — | (gap: sem spec dedicado, registrado) |
| 4 | 8/8 | — | 2/2 novos (fluxo completo real) |
| 5 | 4/4 | 9+4+1 = 14 casos novos | 6/6 (badge+comanda reais) |
| 6 | 5/5 | — | 2/2 |
| 7 | 9/9 | 6 casos novos | 1/1 (preview) |

## 20. Regressão completa (Onda 8)

- **Backend próprio da REF:** 60/60 (26+8+8+4+5+9, somando as 6 suites de todas as ondas rodadas de
  novo no final).
- **Backend de REFs relacionadas** (que compartilham `create_order`/`_resolve_delivery_fee`/
  `_resolve_item_pricing`): 129/129 — `address-geo-integrity-01-onda2` (14), `delivery-fee-04-onda1/2/3`
  (26+16+5), `price-source-01-onda1/2` (16+15), `price-hardening-01` (14), `money-scale-01` (23).
- **`test:domain`** (40 arquivos, suíte inteira): 40/40.
- **`lint`**: 0 erros (59 warnings pré-existentes, nenhum novo).
- **`typecheck`**: limpo.
- **`build`** (storefront) e **`build:admin`**: ambos compilam sem erro.
- **`test:e2e` completo** (50 arquivos, 140 testes) — rodado **duas vezes** nesta REF:
  - 1ª rodada (durante a Onda 8, antes deste relatório): **139 passaram, 1 falhou**
    (`e2e/tests/auth/logout.spec.js:39` — limpeza de cache de visitante no logout).
  - Investigação imediata da falha: isolado → 2/2 passou; dentro da pasta `auth/` inteira (13 specs)
    → 13/13 passou, incluindo o teste antes falho — a falha só se manifestava dentro da sequência
    completa de ~130 testes anteriores, assinatura clássica de poluição de estado entre specs
    (storageState/localStorage compartilhado), sem overlap com nenhum arquivo tocado por esta REF
    (`AuthProvider`, `useAuth.js`, `guestIdentity.js`, handler de logout — nenhum tocado em nenhuma
    onda).
  - **2ª rodada, completa e independente, pedida explicitamente para confirmar a hipótese antes de
    fechar este relatório: `140/140 passaram, exit code 0`** — zero falhas, `logout.spec.js:39`
    incluso e verde (linha 88 do log). Reconfirmado ainda mais uma vez isolado (2/2) e na pasta
    `auth/` inteira (13/13). Três execuções independentes convergem: a falha da 1ª rodada foi
    **instabilidade transitória de infraestrutura de teste, não regressão da REF-MESA-01** — não
    corrigida (fora de escopo desta REF), mas agora com evidência mais forte que a de uma única
    rodada.

**Total geral: 60 + 129 + 40 + 140 = 369 verificações automatizadas passando, mais lint/typecheck/2
builds limpos.**

---

## 21. Limitações e gaps registrados (não corrigidos nesta REF, por regra explícita de escopo)

1. **Sem tela de Admin para ligar `mesa_habilitada`/`mesa_canal_qr`/`mesa_canal_admin`** — as RPCs
   existem desde a Onda 1, sem consumidor de UI de escrita. Precisa de decisão de onde essa tela
   entra (provavelmente uma aba de configuração nova, ou dentro de alguma tela já existente).
2. **Sem geração/impressão de imagem de QR Code** — só o link/parâmetro e a validação server-side
   (a parte arquitetural) foram implementados; a parte visual/operacional ficou de fora por decisão
   explícita do próprio plano ("não é o que a REF pediu para provar").
3. **Sem spec Playwright dedicado ao fluxo `?mesa=` via browser real** (Onda 3) — a parte de
   servidor foi provada exaustivamente (8/8 testes de banco); só o hook `useMesaFromQuery` em si não
   tem prova end-to-end automatizada ainda (foi validado por lint/typecheck/revisão de código). O
   canal Admin/garçom (Onda 4), por comparação, TEM prova E2E completa.
4. **Adicionais/extras pagos não são selecionáveis no formulário do garçom** (`NovoPedidoMesaModal`)
   — só produto + tamanho + observação em texto livre (que não gera cobrança extra). Reduz o escopo
   de uso real da tela pra pedidos sem customização paga.
5. **Preview de notificação (Admin) e notificação automática real divergem temporariamente para
   Mesa** — o preview (JS, `PedidoNotificacoes.jsx`) já mostra o texto certo desde a Onda 5/7; a
   notificação SQL automática (`enc_render_message`) só foi corrigida na Onda 7 — MAS o ambiente de
   E2E estava com uma versão ainda mais antiga (pré-`REF-COMPANY-02`) dessa função, então este gap
   específico já estava fechado por esta REF no momento em que este relatório foi escrito.
6. **`maquininha_fee` para Mesa** — hoje herda o mesmo "sempre zero" de retirada (reaproveitando o
   ramo existente de `_resolve_delivery_fee`). Não há decisão de produto registrada sobre se
   pagamento com cartão à mesa deveria ter alguma taxa diferente — mantido no comportamento mais
   simples/seguro (zero) por não haver evidência/pedido para outra regra.
7. **Trilha de status do CLIENTE (`PedidoTimeline.jsx`, Meus Pedidos) não usa `fluxoDoTipo`** — já
   era assim ANTES desta REF (mostra sempre os 5 passos fixos, mesmo pra retirada) — pré-existente,
   não causado nem agravado pela REF-MESA-01, não corrigido (fora do escopo desta REF, que tratou só
   do lado Admin/operacional).

## 22. Achados fora de escopo (registrados, não corrigidos, conforme regra do plano)

- `v_order_reconciliation` não desconta `delivery_fee`/`maquininha_fee` do `diff` — já documentado
  antes desta REF (REF-DELIVERY-FEE-01), confirmado ainda presente, agnóstico a tipo de pedido
  (Mesa não piora nem resolve esse gap pré-existente).
- Duplicação de convenção entre `db.env` (hvbcdx) e o projeto de E2E (`bgzcro`) — descoberto durante
  a Onda 1: `create_order()`/`_resolve_delivery_fee()` no `db.env` estavam atrasadas em relação ao
  git (faltava o hardening de `REF-ADDRESS-GEO-INTEGRITY-01`); o projeto de E2E, pelo contrário,
  estava ATUALIZADO nessas duas funções mas ATRASADO em `enc_render_message` (faltava o fix de
  `{{empresa}}` de `REF-COMPANY-02`). Nenhuma das duas discrepâncias foi causada por esta REF — são
  evidências de que os dois ambientes (produção real e o projeto de E2E) não recebem exatamente o
  mesmo conjunto de migrations na mesma ordem/tempo. Vale a pena, em algum momento, uma auditoria de
  sincronização entre ambientes — fora do escopo desta REF, só registrado aqui.
- Falta de filtro por tipo de pedido no Admin Orders (já existia antes desta REF, para os 2 tipos
  originais) — continua faltando, agora com 3 tipos; não implementado (fora de escopo, é uma
  melhoria de UX operacional, não uma correção de bug).

## 23. Decisões tomadas dentro das regras do plano

- **Valor persistido da modalidade de entrega continua `'entrega'`, não `'delivery'`** — o texto do
  usuário usava "delivery" como rótulo conceitual/inglês; manter o valor já em produção evita
  reescrever histórico sem necessidade (decisão registrada na Onda 0, nunca reaberta).
- **Capability por loja em 3 chaves flat** (`store_settings`), não um único JSON — confirmado contra
  o código vivo que esse é o padrão real usado pra capabilities simples (`loyalty_enabled` etc.), não
  o padrão JSON usado só para configs estruturalmente aninhadas (`delivery_fee_config`).
- **`mesa_identificador` como campo estruturado próprio, nunca reaproveitando `address`** — é
  literalmente a razão desta REF existir; qualquer atalho aqui reintroduziria a fragilidade original.
- **QR aponta pro mesmo domínio da loja, sem `store_id` no link** — elimina a necessidade de
  qualquer mecanismo novo de resolução de loja e fecha o vetor de cross-tenant por construção, não
  por validação adicional.
- **Canal Admin/garçom exige `is_admin_of`, canal QR não** — reflete a diferença real de quem opera
  cada canal (cliente final vs. operador da loja).
- **`FLUXO_MESA` reusa os 4 status de retirada** em vez de inventar um status novo (`'servido'`, por
  exemplo) — criar um valor novo exigiria migration de `CHECK` em `orders.status`, fora do escopo
  desta REF; "Entregue" foi considerado honesto o suficiente pra mesa (pedido concluído/entregue na
  própria mesa).
- **`{{situacao}}` resolvida no enqueue, nunca no template em si** — mantém `enc_render_message`
  simples (só substituição de placeholder), toda a lógica de decisão fica num único lugar
  (`enc_enqueue_notification`), espelhada byte a byte pelo lado JS (`situacaoPronto`).

---

## O que foi implementado

Todo o domínio multicanal descrito no plano original: modalidade (`tipo_pedido`) e origem
(`origem_pedido`) estruturados e persistidos; capability por loja pros 3 canais (storefront, QR,
Admin/garçom); validação fail-closed em `create_order()` pros 3; storefront, canal QR e canal
Admin/garçom funcionais ponta a ponta; comanda, Admin e relatórios mostrando Mesa como Mesa; WhatsApp
sem hedge e sem herdar linguagem de entrega/retirada; zero regex remanescente decidindo tipo de
pedido em qualquer caminho ativo do sistema.

## O que NÃO foi implementado (gaps §21, decisão consciente de escopo)

Tela de Admin para ligar as capabilities; geração de QR Code visual; seleção de adicionais pagos no
formulário do garçom; spec E2E dedicado ao fluxo de QR via browser real.

## Se a suíte completa ficou verde

**Sim, 140/140, sem exceção** (§20) — 369 verificações automatizadas passando. Uma falha isolada
apareceu numa primeira rodada (`logout.spec.js:39`), foi investigada de imediato (isolado e por
pasta, ambos verdes) e depois reconfirmada como instabilidade transitória por uma segunda rodada
completa e independente da suíte inteira, 100% verde, incluindo esse mesmo teste.

## Migration aguardando produção

**Sim — todas as 6 migrations desta REF** (Ondas 1, 3, 4, 5, 6, 7) estão testadas e prontas, mas
**nenhuma foi aplicada em produção** (nem foi essa a instrução). Aguardam decisão do dono do produto.

---

**PARADO NO GATE FINAL.**

Não foi feito push. Não foi aplicada produção. Nenhuma REF nova foi iniciada. Todos os commits estão
locais, prontos para revisão.
