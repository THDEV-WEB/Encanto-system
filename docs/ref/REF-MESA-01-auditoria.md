# REF-MESA-01 — Auditoria arquitetural: terceiro modo de atendimento (Mesa)

**Status: AUDITORIA CONCLUÍDA (2026-08-30) — leitura pura, nenhum código/schema alterado. Parada no gate, aguardando decisão para abrir Onda 1 de implementação.**

Nasceu de um pedido de negócio: avaliar a inclusão de um terceiro modo de atendimento —
**MESA** (cliente fisicamente no estabelecimento) — ao lado dos dois modos existentes, ENTREGA
(delivery) e RETIRADA (pickup). Esta REF não implementa nada; mapeia tudo que hoje assume
binariamente "só existem 2 modos" e propõe caminho de implementação para decisão do dono do
produto.

Investigação feita em 5 frentes paralelas (frontend/storefront, banco/RPC/RLS/notificações,
Admin/comanda/relatórios, multi-tenant/segurança, testes), cobrindo `src/`, as ~198 migrations em
`migrations/`, `supabase/functions/`, `tests/` e `e2e/`.

---

## Achado central (resumo executivo)

**Não existe, em lugar nenhum do sistema — nem no frontend, nem no banco — um enum ou coluna de
"tipo de pedido".** O que existe é uma string solta (`deliveryMode`, `'entrega' | 'retirada'`) que
nasce num `useState` local do storefront, e do lado do banco uma inferência por **regex sobre texto
livre** da coluna `orders.address`: `/retirada\s+na\s+loja/i`. Essa mesma regra está duplicada,
independentemente, em pelo menos 3 lugares:

1. `src/components/admin/comanda/comandaModel.js:55-58` (`tipoDoPedido`, JS — fonte "canônica")
2. `enc_tempo_estimado()`, dentro de `migrations/REF-SAAS-01-onda4-3-config-operacional.sql:394-395` (SQL, notificação WhatsApp)
3. `admin_reports_summary()`, em `migrations/REF-DASHBOARD-01-admin-reports.sql:64` (SQL, relatório BI)

A própria migration nº 3 documenta essa fragilidade em comentário (linhas 9-12): *"'entrega vs
retirada' não é uma coluna — é um classificador de texto sobre orders.address (...) se RE_RETIRADA
mudar no JS, replicar aqui também."* Ou seja: o projeto já sabia que isso era dívida técnica antes
desta auditoria começar.

Existe um terceiro sinal, mas **transiente**: o payload de `create_order()` carrega
`p_order.retirada` (boolean), usado só dentro da transação para zerar taxa de entrega — e depois
**descartado**. Ele nunca é persistido em `orders`. No momento em que o pedido é gravado, a única
forma de saber depois se foi retirada é reaplicar a regex sobre `address`.

**Por que isso importa para Mesa:** o padrão dominante em todo o código (frontend e backend) é
`tipo === 'retirada' ? X : Y` — um ternário binário, nunca um `switch`/mapa. Isso significa que
**qualquer lugar não revisado explicitamente vai empurrar Mesa para o ramo "entrega" por padrão**,
silenciosamente, sem erro visível. Os riscos concretos mais graves desse mecanismo, em ordem de
gravidade, estão detalhados na seção 2.

---

## 1. Como Delivery e Retirada são representados hoje

**Frontend/storefront** — a fonte de tudo:
- `src/pages/StoreApp.jsx:82` — `const [deliveryMode, setDeliveryMode] = useState('entrega')`. Não
  vive em Context/Provider (diferente do endereço, que tem `AddressProvider`); é um `useState` local
  repassado por prop.
- `src/components/DeliveryBar.jsx:19-26` — `<select>` HTML nativo com 2 `<option>` fixas
  (`value="entrega"`/`value="retirada"`), sem consultar nenhuma capacidade da loja.
- `src/components/checkout/CheckoutPage.jsx:42` — `const retirada = deliveryMode === 'retirada'`.
  Essa variável derivada (booleana) é reusada em pelo menos 9 pontos distintos do mesmo arquivo
  (gate de endereço obrigatório, disparo de geocoding, cálculo de taxa, persistência de endereço,
  breadcrumbs, montagem do texto WhatsApp, avisos de UI).
- `src/components/checkout/SuccessPage.jsx:58` — **segunda cópia independente** do mesmo padrão
  (`const retirada = deliveryMode === 'retirada'`), não compartilhada com o Checkout.
- `src/utils/orderPayload.js:41` — `retirada: resumo ? resumo.status === 'retirada' : false`, o
  campo que efetivamente viaja no payload da RPC `create_order`.

**Banco** — nenhuma coluna de tipo. `orders.address` (texto livre) carrega a string
`"Retirada na loja — {endereço físico da loja}"` quando é retirada (gravada em
`CheckoutPage.jsx:43`), ou o endereço real do cliente quando é entrega. O servidor nunca recebe um
campo estruturado "tipo" — só essa string e o boolean transiente `p_order.retirada` (usado e
descartado, ver acima). `orders.endereco_id` (FK para `addresses`) fica `NULL` em retirada, mas
também pode ficar `NULL` em entregas legítimas (endereço não estruturado, ownership rejeitada) — não
é um proxy confiável de tipo. `delivery_fee = 0 AND maquininha_fee = 0` também não é proxy confiável
(pode ocorrer em entregas fora de alcance ou com config desativada).

**Admin/comanda** — deriva o tipo chamando `tipoDoPedido(order)` (a mesma função regex) em
`AdminPedidos.jsx`, `PedidoNotificacoes.jsx`, `comandaModel.js`.

---

## 2. Todos os pontos que assumem somente 2 modos (inventário)

### 2.1 Frontend / storefront

| Arquivo:linha | Padrão binário | Efeito se Mesa não for tratado explicitamente |
|---|---|---|
| `DeliveryBar.jsx:19-26` (seletor) | 2 `<option>` fixas | Sem 3ª opção, cliente não pode escolher Mesa |
| `DeliveryBar.jsx:37` | `entrega ? (...) : (<span>...retiradaLabel</span>)` | Mesa cairia no ramo "retirada", mostrando texto de endereço fixo da loja rotulado incorretamente |
| `CheckoutPage.jsx:43` | `retirada ? 'Retirada na loja...' : endereco?.label` | Mesa herdaria texto "Retirada na loja" (ou pediria endereço, dependendo de qual ramo cair) |
| `CheckoutPage.jsx:77-85` | `if (retirada \|\| !endereco)` (pula geocoding) | Se Mesa não incluído em `retirada`, tenta geocodificar sem necessidade |
| `CheckoutPage.jsx:111-113` | `montarResumoFinanceiro({ retirada, ... })` | **Risco financeiro nº1**: se `retirada=false` para Mesa, calcula e cobra taxa de entrega de um pedido feito na própria loja |
| `CheckoutPage.jsx:144` | `if (!retirada && !temEndereco) { erro }` | **Bloqueia checkout**: cliente em Mesa seria obrigado a informar endereço de entrega |
| `CheckoutPage.jsx:161` | persiste `endereco_id` só se `!retirada` | Mesa tentaria persistir endereço estruturado desnecessário |
| `CheckoutPage.jsx:219` | `enderecoEstruturado: retirada ? null : endereco` (msg WhatsApp) | Mensagem herdaria bloco de endereço indevido |
| `CheckoutPage.jsx:298-306` | label do campo + `<AddressSummary retirada={retirada}>` | UI do campo de endereço não trata 3º modo |
| `SuccessPage.jsx:58,98-102` | 2ª cópia do padrão + texto "tempo estimado de entrega/retirada" | Tela de sucesso mostraria ETA de entrega errado para Mesa |
| `orderPayload.js:41` | `retirada: resumo.status === 'retirada'` | Campo enviado ao servidor ficaria `false` para Mesa → servidor recalcularia taxa (ver seção 7) |
| `pedidoStatus.js:20-22` (`fluxoDoTipo`) | `tipo === 'retirada' ? FLUXO_RETIRADA : FLUXO_ENTREGA` | Mesa herdaria a trilha de status de Entrega, incluindo o passo "Saiu para entrega" — sem sentido para atendimento presencial |
| `deliveryEtaFormat.js:20,26-28` | `tipo === 'retirada' ? RETIRADA_TEMPO_TEXTO : 'até Nmin'` | Texto de prazo herdaria o de entrega |
| `PedidoTimeline.jsx` (Meus Pedidos) | usa uma trilha `TIMELINE` fixa de 5 passos, **nem sequer usa `fluxoDoTipo`** hoje | Inconsistência pré-existente (ver "Achados de risco separados") — não seria piorada nem resolvida por Mesa |
| `PedidoCard.jsx` (Meus Pedidos) | **não mostra tipo de pedido hoje** | Não é "estender um badge existente" — é criar um badge do zero se quiser mostrar tipo ao cliente no histórico |

Pontos **sem** risco de herança (já neutros à cardinalidade do modo):
- `AddressProvider`/`AddressModal`/`useAddress` — desacoplados do modo por design; só os pontos de
  chamada (`DeliveryBar`, `AddressSummary`) decidem se mostram a UI de endereço.
- `useBusinessHours`/horário de funcionamento — zero menção a modo de atendimento.
- Programa de fidelidade no storefront — zero menção a modo.
- Layout do seletor — é um `<select>` nativo, não um toggle de 2 botões; uma 3ª opção não quebra
  layout nem no mobile (`index.css:350-404`, `667-688`).
- Resumo financeiro do checkout (JSX) — segue corretamente qualquer decisão tomada em
  `montarResumoFinanceiro` (não tem lógica de tipo própria).

### 2.2 Admin / Comanda / Dashboard

| Arquivo:linha | Padrão binário | Efeito se Mesa não for tratado |
|---|---|---|
| `comandaModel.js:55-58` (`tipoDoPedido`) | regex sobre `address` | Mesa seria classificada como `'entrega'` a menos que o texto de endereço seja ajustado E a regex também |
| `comandaModel.js:197,200,206,215` | `tipoLabel`/`tipoLabelCliente`/`previsaoLabel`/bloco de endereço, todos ternários de 2 vias | Comanda mostraria "PARA ENTREGA", "Entrega prevista", endereço indevido |
| `AdminPedidos.jsx:70-72` | badge `tipo === 'retirada' ? '🏪 Retirada' : '🛵 Entrega'` | Mesa rotulada como "🛵 Entrega" no painel operacional |
| `AdminPedidos.jsx:153` | busca endereço estruturado só se `tipoDoPedido !== 'retirada'` | Buscaria endereço inexistente para Mesa |
| `PedidoNotificacoes.jsx:37,44` | mesma dependência de `tipoDoPedido`/`fluxoDoTipo` | Prévias de mensagem WhatsApp por status herdam o mesmo erro |
| `AdminRelatorios.jsx:136-144` | `t.tipo === 'retirada' ? '🏪 Retirada' : '🚚 Entrega'` | **Achado mais grave do Admin**: se o backend um dia devolver `tipo:'mesa'`, o relatório rotula silenciosamente como Entrega, distorcendo o BI sem erro visível |
| `admin_reports_summary()` (SQL) | `CASE WHEN address ~* 'retirada...' THEN 'retirada' ELSE 'entrega' END` | Mesmo problema, na origem dos dados |
| `pedidoStatus.js` (`fluxoDoTipo`, usado no Admin) | binário | Trilha de avanço de status do operador herdaria "Saiu para entrega" |

Filtros/busca do Admin Orders hoje **só existem por status**, não por tipo — não há sequer um
filtro Entrega × Retirada hoje, então a lacuna operacional para Mesa já existe de forma equivalente
para os 2 modos atuais.

Pontos sem risco (já robustos à cardinalidade):
- Exibição de `delivery_fee`/`maquininha_fee` no card e na comanda — sempre por valor `>= 0.01`,
  nunca por checagem de tipo. Mesa sem taxa já funcionaria certo aqui.
- `comandaHtml.js`/`comandaTexto.js` — renderers passivos de string (`tipoLabel` interpolado),
  aceitariam um 3º valor sem mudança de código, desde que `comandaModel.js` resolva certo.
- `PedidoHistorico.jsx` — agnóstico a tipo.
- `admin_orders_stats()` / `AdminDashboard.jsx` — breakdown só por `status`, não por tipo.
- `top_produtos`/`por_pagamento` (relatório) — não cruzam com tipo de pedido.

### 2.3 Banco / RPC / notificações

| Local | Padrão binário |
|---|---|
| `_resolve_delivery_fee(p_store_id, p_retirada, ...)` | boolean único: `true` = zera taxa incondicionalmente, `false` = calcula por distância |
| `create_order()` | não tem campo de tipo; só lê `p_order.retirada` transitoriamente |
| `enc_tempo_estimado()` | regex sobre `address` (mesma de `comandaModel.js`) |
| `enc_render_message()` (template status `'pronto'`) | hedgeia as duas frases ("se for retirada... se for entrega...") porque não recebe o tipo como parâmetro — funciona só porque são 2 opções |
| `v_order_reconciliation` | soma só `order_items`, não distingue nem subtrai `delivery_fee`/`maquininha_fee` — bug pré-existente, agnóstico a Mesa (ver "achados separados") |
| `admin_order_endereco()` | só popula campos estruturados quando existe `endereco_id` — Mesa também não teria, herdaria o mesmo comportamento de retirada aqui, sem problema |

Pontos confirmados **sem** dependência de tipo (Mesa herdaria de graça):
- `loyalty_grant()` — lido por completo, só recebe `(p_customer_id, p_order_id)`, nunca `address`
  nem `retirada`. Zero condicional de tipo.
- `loyalty_void_on_cancel()` — só olha `status`.
- RLS de `orders`/`order_items`/`addresses`/`loyalty_*` — isolam por `store_id` (tenant) e
  `customer_id`/`auth_user_id` (dono), nunca por tipo de pedido.
- `_resolve_item_pricing()` — preço por item, agnóstico a fulfillment.

### 2.4 Testes

Ver seção 14 (lista completa).

---

## 3. Arquivos/componentes/RPCs/views/tabelas afetados (consolidado)

**Frontend:** `src/pages/StoreApp.jsx`, `src/components/DeliveryBar.jsx`,
`src/components/checkout/CheckoutPage.jsx`, `src/components/checkout/SuccessPage.jsx`,
`src/utils/orderPayload.js`, `src/services/delivery/deliveryFeeRules.js`,
`src/services/delivery/deliveryEtaFormat.js`, `src/components/pedidos/pedidoStatus.js`,
`src/components/pedidos/PedidoCard.jsx`, `src/components/pedidos/PedidoTimeline.jsx`,
`src/constants/storeInfo.js`, `src/services/notifications/messageTemplates.js`.

**Admin:** `src/components/admin/AdminPedidos.jsx`,
`src/components/admin/comanda/comandaModel.js`, `comandaHtml.js`, `comandaTexto.js`,
`ComandaModal.jsx`, `printComanda.js`, `src/components/admin/PedidoNotificacoes.jsx`,
`src/components/admin/PedidoHistorico.jsx`, `src/components/admin/AdminRelatorios.jsx`,
`src/components/admin/AdminDashboard.jsx`.

**Banco (migrations relevantes para entender o estado vigente, não para reaplicar):**
`REF-ORDER-01-order-ops.sql`, `REF-ORDER-01b-whatsapp-dispatch.sql`,
`REF-DELIVERY-FEE-01-step2-orders-schema.sql`, `REF-DELIVERY-FEE-04-onda1-delivery-fee-autoritativo.sql`,
`REF-ADDRESS-GEO-INTEGRITY-01-onda2-parte1/parte2` (versão vigente de `create_order`/`_resolve_delivery_fee`),
`REF-ORDER-TENANT-01-onda1-create-order-tenant.sql`, `REF-DASHBOARD-01-admin-reports.sql`,
`REF-SAAS-01-onda4-3-config-operacional.sql` (padrão `store_settings`),
`REF-LOYALTY-AUDIT-01-onda1-config-por-loja.sql` (precedente direto de capability por loja),
`REF-MONEY-SCALE-01-precisao-decimal-monetaria.sql` (`v_order_reconciliation` vigente),
`REF-COMANDA-ENDERECO-01-admin-order-endereco.sql`, `REF-COMPANY-02-notify-empresa.sql` (templates).

**Tabelas:** `orders` (sem coluna de tipo), `order_items`, `order_events`, `addresses`, `customers`,
`store_settings`, `notification_outbox`.

**Views:** `v_order_reconciliation`, `order_status_durations`, `order_logs`.

**RPCs:** `create_order`, `_resolve_delivery_fee` (interna), `_resolve_item_pricing` (interna),
`admin_orders_search`, `admin_order_endereco`, `admin_orders_stats`, `orders_health`,
`admin_reports_summary`, `enc_tempo_estimado`, `enc_render_message`, `enc_enqueue_notification`,
`enc_dispatch_notifications`, `loyalty_grant`, `loyalty_void_on_cancel`,
`get_delivery_fee_config`/`set_delivery_fee_config` (molde a reaproveitar),
`get_loyalty_config`/`set_loyalty_config` (precedente mais próximo de capability por loja),
`is_admin_of`, `resolve_store_from_origin`.

**Testes:** ver seção 14.

---

## 4. Como Mesa deveria ser representada

Dois problemas de representação, distintos:

**(a) Tipo do pedido.** Precisa deixar de ser inferido por regex e virar um fato estruturado e
persistido. O precedente mais próximo dentro do próprio projeto para "enum de pedido via CHECK" é
`orders_status_valid` (`REF-ORDER-01-order-ops.sql:34-36`:
`CHECK (status IN ('recebido','preparo','pronto','entrega','entregue','cancelado'))`). Uma coluna
nova seguiria o mesmo molde:

```
orders.tipo_pedido text NOT NULL DEFAULT 'entrega'
  CHECK (tipo_pedido IN ('entrega','retirada','mesa'))
```

(Nome ilustrativo — não é uma decisão desta auditoria, só o padrão estrutural recomendado.) O
`DEFAULT 'entrega'` preserva os pedidos históricos sem reinterpretação ambígua (seção 15).

**(b) Identificação da mesa.** `addresses` modela endereço físico de entrega (rua, número, bairro,
CEP, lat/lng) — não serve para "mesa 12". `orders.address` hoje é reaproveitado como "gaveta de
metadado" para o texto "Retirada na loja..."; perpetuar esse padrão para Mesa (escrever "Mesa 12" em
`address`) manteria viva exatamente a fragilidade que a própria migration do Dashboard já sinalizou
como risco. O caminho mais limpo é um campo próprio (novo, estruturado ou pelo menos isolado de
`address`) para o identificador da mesa — sem decidir aqui se é número digitado, seleção, QR code ou
código gerado (ver seção 16).

---

## 5. Como habilitação por tenant deveria funcionar

Este projeto já tem um precedente **direto e recente** para exatamente este problema:
`loyalty_enabled` (`REF-LOYALTY-AUDIT-01-onda1-config-por-loja.sql`) — uma capacidade booleana
opcional por loja, nascendo desligada por padrão, documentada explicitamente: *"uma loja nova SEMPRE
nasce com fidelidade DESLIGADA até um admin ligar explicitamente."* O molde arquitetural do projeto
(documentado no ADR `docs/adr/REF-SAAS-01-fundacao-multitenant.md`, §12) é:

- **Nunca** criar coluna nova em `stores` nem tabela dedicada para uma config de UMA loja.
- Usar `store_settings(store_id, chave, valor)` — já usada por `business_hours_schedule`,
  `delivery_fee_config`, `delivery_eta_min`, `loyalty_enabled`, `store_mode`, `company_info`.
- Par de RPCs por capability: `get_X(p_store_id DEFAULT default_store_id())` — `STABLE SECURITY
  DEFINER`, leitura **pública** (`anon`+`authenticated`, porque o storefront anônimo precisa saber
  se mostra a opção); `set_X(..., p_store_id)` — `SECURITY DEFINER`, gate
  `IF NOT is_admin_of(p_store_id) THEN RAISE EXCEPTION`.
- `is_admin_of(store_id)` já resolve `is_super_admin() OR admin vinculado àquela loja` — ou seja, a
  mesma função cobre "o operador da própria loja liga" e "o super admin liga por ela", sem precisar
  de trilha de autorização nova no Platform Console.
- Default seguro: ausência de linha em `store_settings` para essa chave = **Mesa desligada**. Nunca
  herdado de outra loja, nunca ligado por omissão.
- Platform Console (`platform_list_tenants`/`platform_tenant_detail`) ganharia, no máximo, um sinal
  agregado a mais (`tem_mesa_habilitada`, mesmo padrão de `tem_horario_config`/`tem_delivery_config`)
  — para **supervisão**, não para edição (o Console nunca edita config operacional de loja, só
  supervisiona a existência).
- Provisionamento (`provision_store`) não precisa de mudança — default `false` por ausência de linha
  já é seguro; só precisaria de seed explícita se o default desejado fosse "ligado" (não é o caso).

---

## 6. Regras de checkout

Consolidado da seção 2.1: pelo menos 9 pontos em `CheckoutPage.jsx` decidem comportamento a partir
da variável derivada `retirada`, mais uma 2ª cópia independente do mesmo padrão em `SuccessPage.jsx`.
Nenhum desses pontos herdaria Mesa corretamente "de graça" — cada um precisaria de uma decisão
explícita (a maioria seguiria o mesmo caminho hoje reservado a retirada: sem endereço obrigatório,
sem geocoding, sem cálculo de distância). O ponto de maior risco é `CheckoutPage.jsx:144` (endereço
obrigatório) — se esquecido, bloqueia completamente o checkout de Mesa; e `CheckoutPage.jsx:111-113`
(cálculo de taxa) — se esquecido, cobra taxa de entrega indevida.

O domínio de endereço (`AddressProvider`/`AddressModal`) **não precisa de nenhuma mudança interna**
— o acoplamento ao modo acontece inteiramente nos pontos de chamada externos (`DeliveryBar`,
`AddressSummary`), que já sabem esconder a UI de endereço para retirada e replicariam a mesma lógica
para Mesa.

---

## 7. Regras de endereço/taxa

`src/services/delivery/deliveryFeeRules.js` (`montarResumoFinanceiro`) é a camada única client-side
da regra "sem taxa" — hoje um `if (retirada) { delivery_fee:0, maquininha_fee:0, status:'retirada' }`.
No servidor, `_resolve_delivery_fee(p_store_id, p_retirada, p_payment_method, p_endereco_id)`
(`SECURITY DEFINER`, sem GRANT a `anon`/`authenticated` — só chamável de dentro de `create_order`) é
quem **realmente decide e recalcula** a taxa, ignorando qualquer valor de `delivery_fee`/
`maquininha_fee` que o client tente enviar (correção da REF-DELIVERY-FEE-04, que fechou uma
vulnerabilidade real de frete forjado).

Ambas as camadas (client e servidor) só conhecem um boolean `retirada`/`p_retirada`. Mesa precisaria
do mesmo efeito ("sem taxa, incondicional"), mas colapsar Mesa dentro desse mesmo boolean
reintroduziria ambiguidade: hoje `delivery_fee=0` já pode significar "retirada", "fora de alcance",
"config desativada" ou "endereço inválido" — indistinguíveis entre si sem reler `address`. Somar
Mesa a essa lista sem um sinal de tipo próprio (seção 4a) pioraria essa ambiguidade, não resolveria.

Disparo de geocoding/cálculo de rota viária (HeiGIT/OpenRouteService) já é condicionado a
`!retirada && endereco` — Mesa seguiria o mesmo padrão de não disparar, uma vez que o novo tipo seja
tratado explicitamente nesse ponto.

---

## 8. Regras de pagamento

O campo `payment_method` já é **inteiramente independente** do modo de atendimento hoje — dinheiro,
PIX, débito, crédito funcionam igual em entrega e retirada, e a taxa de maquininha
(`maquininha_fee`) é calculada só a partir de `payment_method IN ('cartao_debito','cartao_credito')`,
nunca do tipo de pedido. Tecnicamente Mesa herdaria essa independência sem qualquer mudança de
código.

Ponto que fica para decisão de produto (não técnica): `maquininha_fee` parece ter nascido como taxa
de uso da maquininha física do entregador/atendente na hora da entrega/retirada — faz sentido
perguntar se essa taxa deveria existir para pagamento feito à mesa (onde presumivelmente o
estabelecimento já tem seu próprio ponto de venda, sem custo extra de "maquininha do entregador").
Esta auditoria não decide isso — só sinaliza que hoje o campo é calculado de forma agnóstica ao tipo,
e que uma regra diferenciada para Mesa exigiria tratamento explícito em `_resolve_delivery_fee` (ou
onde quer que essa regra passe a viver).

---

## 9. Regras de Admin/Comanda

Ver inventário completo na seção 2.2. Resumo do que muda: `comandaModel.js` precisa de um terceiro
ramo em `tipoLabel`/`tipoLabelCliente`/`previsaoLabel`/decisão de mostrar endereço (hoje todos são
`? :` de 2 vias, virariam `if/else if/else` ou lookup por objeto); `pedidoStatus.js` precisa de um
`FLUXO_MESA` novo (provavelmente mais próximo do fluxo de retirada — sem "Saiu para entrega" — mas
com rótulo final possivelmente diferente, ex. "Servido" em vez de "Entregue", decisão de produto);
`AdminPedidos.jsx` troca o ternário do badge por mapa de 3 entradas.

`comandaHtml.js`/`comandaTexto.js` (renderers) não precisam de mudança — são passivos, aceitam
qualquer `tipoLabel` resolvido a montante. Isso é uma boa notícia arquitetural: a superfície real de
mudança está concentrada em `comandaModel.js`, não espalhada pelos renderers.

Lacuna operacional identificada (fora do escopo técnico estrito, mas relevante para Mesa fazer
sentido): **não existe hoje nenhuma tela de "criar pedido manualmente" no Admin.** Toda origem de
pedido hoje é o storefront do cliente. Se "Mesa" pressupõe o garçom/operador lançando o pedido pelo
painel (cenário comum em restaurantes com atendimento presencial), isso é uma feature nova inteira —
formulário de novo pedido no Admin —, não apenas um terceiro rótulo no checkout do cliente. Vale
decidir isso antes de desenhar a Onda 2.

---

## 10. Regras de relatório

**Achado mais grave de todo o Admin:** `AdminRelatorios.jsx:136-144` (`t.tipo === 'retirada' ? '🏪
Retirada' : '🚚 Entrega'`) e `admin_reports_summary()` (`CASE WHEN address ~* 'retirada...' THEN
'retirada' ELSE 'entrega' END`) rotulariam Mesa como Entrega **silenciosamente** — distorcendo
faturamento/contagem por tipo sem qualquer erro visível. Isso precisa ser corrigido antes de
qualquer lançamento real de pedidos de Mesa, mesmo que a UI de seleção ainda não exista, porque o
`ELSE` universal captura qualquer terceiro valor que comece a aparecer em `address`.

`top_produtos`, `por_pagamento`, `admin_orders_stats` (Dashboard "hoje") — todos agrupam por produto,
forma de pagamento ou status, nunca por tipo de pedido. Não são afetados.

---

## 11. Regras de fidelidade

Confirmado por leitura completa de `loyalty_grant()` (`REF-LOYALTY-01-loyalty.sql:95-124`) e por
grep exaustivo no frontend: **não existe nenhuma condição hardcoded de tipo de pedido em toda a
fidelidade.** `loyalty_grant(p_customer_id, p_order_id)` só recebe esses dois parâmetros — nunca
`address`, `retirada` ou qualquer sinal de fulfillment. A única condição de negócio é
`loyalty_enabled` (config por loja) e o cap de selos.

**Recomendação baseada no comportamento atual (não é uma regra nova, é a constatação do que já
acontece):** um pedido de Mesa geraria fidelidade exatamente como qualquer outro pedido válido, sem
precisar de nenhuma mudança de código — a regra de fidelidade já trata "pedido válido" como
independente do modo de atendimento. Se o dono do produto quiser uma regra diferente para Mesa
(ex.: não contar fidelidade em pedidos presenciais), isso seria uma **nova exceção**, não a
continuidade do comportamento atual — e precisaria ser decidida explicitamente, não inferida.

---

## 12. Regras de WhatsApp/notificações

`notification_outbox` é populada por trigger (`trg_enc_order_notify`, em `INSERT` ou mudança de
`status`) via `enc_enqueue_notification()`, despachada por `pg_cron` a cada 30s
(`enc_dispatch_notifications()`, lendo credenciais do Vault, enviando via Graph API da Meta).

O template da mensagem de status `'pronto'` já **hedgeia** as duas possibilidades hoje, porque
`enc_render_message(status, vars)` nunca recebe o tipo do pedido:

> Se for retirada, já pode ser buscado.
> Se for entrega, nosso entregador sairá em instantes.

Isso só "funciona" hoje porque são 2 frases genéricas e o cliente decide sozinho qual se aplica. Com
3 modos, esse hedge não escala — nenhuma combinação de frases fixas seria reconhecível como
"sua mesa está servida" ou "seu prato está pronto para a mesa X". Corrigir isso exige que
`enc_render_message` receba o tipo do pedido como parâmetro explícito, o que por sua vez depende de
o tipo estar persistido (seção 4a) no momento em que `enc_enqueue_notification` monta as variáveis da
mensagem.

`enc_tempo_estimado()` tem a mesma regex duplicada da comanda — herdaria o mesmo erro de classificar
Mesa como "entrega" se não for corrigido em paralelo.

No storefront, o WhatsApp abre automaticamente pós-pedido (`SuccessPage.jsx`) usando
`buildOrderConfirmationMessage`/`buildComanda` — a mensagem ao cliente segue exatamente a mesma
lógica da comanda (`comandaTexto.js`), então corrigir `comandaModel.js` (seção 9) resolve os dois ao
mesmo tempo, por construção (é a mesma função-fonte).

---

## 13. Segurança e validações server-side necessárias

**Achado central de segurança:** hoje **não existe nenhuma validação server-side de "esse tipo de
pedido é permitido para essa loja"** — porque essa pergunta nunca precisou ser feita (Entrega e
Retirada são universais, toda loja aceita as duas). O client pode, em teoria, forjar qualquer texto
em `address` ou qualquer valor em `p_order.retirada` — hoje isso não é um vetor de ataque
interessante porque não há capacidade a bypassar. **Com Mesa opcional por loja, isso muda**: seria a
primeira modalidade que uma loja pode legitimamente não oferecer, e portanto a primeira vez que um
client malicioso teria motivo para tentar forçar um tipo não habilitado via chamada direta à RPC.

O padrão de correção já existe no projeto e se estende naturalmente: `create_order()` resolve
`v_store_id` com confiança (via `tenant_id` do JWT quando autenticado, via
`resolve_store_from_origin()` quando guest — nunca confiando em `p_store_id` bruto do client, desde
a correção da REF-ORDER-TENANT-01). Uma checagem de capacidade entraria **no mesmo ponto** onde
`_resolve_delivery_fee` já é chamado, depois de `v_store_id` resolvido:

```sql
if v_tipo_pedido = 'mesa' then
  if not coalesce((select valor from store_settings
                     where store_id = v_store_id and chave = 'mesa_enabled'), 'false') <> 'false' then
    return jsonb_build_object('ok', false, 'error', 'modalidade indisponivel para esta loja');
  end if;
end if;
```

(Ilustrativo — não é código a aplicar agora.) Mensagem de erro genérica, sem revelar se a loja existe
ou não tem a config, seguindo a mesma disciplina anti-enumeração já usada em `create_order` para
"loja invalida"/"loja nao identificada".

**Importante:** esconder a opção "Mesa" no frontend (`DeliveryBar`) para lojas sem
`mesa_enabled=true` é UX, não é a barreira de segurança — é a checagem dentro de `create_order` que
importa, porque é a única camada que uma chamada direta à RPC (contornando a UI) não consegue pular.

RLS de `orders`/`order_items`/`addresses`/`loyalty_*` não precisaria de mudança estrutural — todas
isolam por `store_id` (tenant) e `customer_id`/`auth_user_id` (dono), nunca por tipo de pedido; um
novo campo de tipo/identificador de mesa não abriria vetor novo de isolamento entre tenants, desde
que a validação de capacidade acima seja feita.

---

## 14. Impacto nos testes

**Precisam ser revisados/estendidos:**

| Arquivo | Motivo |
|---|---|
| `tests/checkout.golden.mjs` | payload fixa `p_order.retirada: boolean`; mensagem trava só 2 cabeçalhos possíveis; pin de fonte assume `!retirada ⇒ precisa de endereço` |
| `tests/comanda.golden.mjs` | `tipoDoPedido` binário; todo o view-model ramificado em 2 vias; só 2 fixtures (`pedidoEntrega`/`pedidoRetirada`) |
| `tests/order-status.guard.mjs` | `FLUXO_ENTREGA`/`FLUXO_RETIRADA`, `fluxoDoTipo` ternário testado diretamente |
| `tests/whatsapp-templates.golden.mjs` | `textoTempoEntrega('entrega'\|'retirada', ...)` só aceita esses 2 literais |
| `tests/deliveryFee.golden.mjs` | parâmetro `retirada: boolean` em `montarResumoFinanceiro` |
| `tests/address.render.mjs` | 3 snapshots fixos de `AddressSummary` com prop `retirada: boolean` |
| `tests/render.smoke.mjs` | snapshot HTML **literal** do `<select>` com exatamente 2 `<option>` — quebra assim que uma 3ª opção for adicionada ao componente real |
| `e2e/tests/admin/admin-pedidos-status.spec.js` | testa explicitamente "as 2 trilhas" de status por design |
| `e2e/tests/admin/admin-pedidos-lista.spec.js` | asserção de rótulo fixo `'🏪 Retirada'` |
| `e2e/pages/StorePage.js` | só tem `selecionarRetirada()`, sem método para um 3º modo |
| `e2e/support/fixture-order.js` | fixture de pedido de teste depende do mesmo regex de endereço para "fabricar" um tipo |
| `e2e/tests/checkout/*.spec.js` (guest/logado/whatsapp) | hoje só cobrem retirada via E2E real (entrega só é coberta pelo golden puro, sem browser) — infraestrutura de teste precisaria de extensão dupla (cobrir entrega E2E + Mesa) |

**Não precisam ser revisados (já agnósticos ao tipo de pedido):** `tests/loyalty.golden.mjs`,
`tests/loyalty.guard.mjs`, `tests/whatsapp-service.golden.mjs`, `tests/deliveryFee-admin.guard.mjs`,
`tests/routeDistance.golden.mjs`, `tests/address.guard.mjs`, `tests/address-multitenant.golden.mjs`,
`tests/address-recentes.golden.mjs`, `tests/business-hours*.mjs`, `tests/store-status.guard.mjs`,
`tests/recompra.smoke.mjs`, `tests/tenantSync.golden.mjs`, e no E2E:
`admin-pedidos-comanda.spec.js`, `admin-pedidos-escala.spec.js`, `admin-taxa-entrega.spec.js`,
`admin-delivery-eta.spec.js`, `admin-dashboard.spec.js` (breakdown é por status, não por tipo),
`config-padrao-transparencia.spec.js`, `logout-limpa-endereco-carrinho.spec.js`.

Achado tangencial: `e2e/tests/admin/platform-console.spec.js` tem um checklist de onboarding que
assume que toda loja precisa configurar entrega (`plataforma-checklist-entrega-*`) — uma loja
hipoteticamente "só Mesa" ficaria eternamente com esse item pendente. Não quebra a suíte, mas é um
ponto de produto a decidir se Mesa vier a permitir lojas sem delivery algum.

---

## 15. Compatibilidade com pedidos antigos

Uma coluna nova `tipo_pedido` com `NOT NULL DEFAULT 'entrega'` (padrão já usado no projeto para
colunas monetárias como `delivery_fee`/`maquininha_fee`, `REF-DELIVERY-FEE-01-step2`) preserva
100% dos pedidos históricos sem qualquer necessidade de reinterpretação: todo pedido existente já
tem, hoje, `address` como fonte de verdade textual — migrar dados existentes exigiria rodar a mesma
regex heurística sobre o histórico para popular a coluna nova corretamente (distinguir entrega de
retirada retroativamente), o que é sabidamente imperfeito (a própria migration do Dashboard já
reconhece isso como "classificador de texto", não fonte de verdade) — mas **não é obrigatório**: o
sistema pode conviver perfeitamente com `DEFAULT 'entrega'` para todo o histórico pré-migração (a
distinção "retirada" desses pedidos antigos continuaria disponível via a regex já existente sobre
`address`, sem urgência de backfill) e só usar a coluna nova, confiável, a partir da data de corte.
Isso evita reinterpretar pedidos antigos de forma ambígua — decisão explicitamente pedida pelo
usuário.

---

## 16. Alternativas arquiteturais

**A) Estender a heurística de regex sobre `address` para reconhecer também Mesa.** Caminho de menor
esforço imediato, mas perpetua e piora a dívida técnica já documentada pelo próprio projeto
(duplicação de regra entre JS e 2 pontos de SQL, mais um 3º sinal a manter sincronizado). **Não
recomendado** — é o caminho que a própria migration de Dashboard já sinalizou como frágil antes
mesmo de existir um terceiro modo.

**B) Coluna estruturada `tipo_pedido` com CHECK + capability por loja via `store_settings`.**
Segue dois precedentes já validados e em produção neste projeto (`orders_status_valid` para enum via
CHECK; `loyalty_enabled`/`delivery_fee_config` para capability por loja). Resolve a causa raiz (a
inferência por regex) em vez de estendê-la. **Recomendado.**

**C) Identificação da mesa — não decidido, apresentando alternativas para decisão de produto:**
- **Número digitado pelo cliente no checkout** — mais simples de implementar, mas sujeito a erro de
  digitação/mesa inexistente; não exige cadastro prévio de mesas.
- **Seleção de mesa numa lista pré-cadastrada** — exige uma tela/tabela de "mesas da loja" (cadastro
  novo, capability adicional), mas evita erro de digitação e permite ao Admin saber a ocupação.
- **QR Code por mesa** — mais robusto operacionalmente (cliente escaneia e o sistema já sabe a mesa),
  mas é a opção de maior esforço de implementação (geração/impressão de QR por mesa, roteamento do
  storefront a partir do QR).
- **Código gerado pelo estabelecimento** (ex.: crachá/senha entregue ao cliente) — meio-termo, mas
  introduz um processo operacional novo (emitir/recolher códigos).

Nenhuma dessas quatro é claramente imposta pela arquitetura atual — todas são viáveis dado o estado
do código. A escolha depende de decisão de produto (quanto esforço operacional o dono da loja está
disposto a assumir) e de uma decisão correlata: **se Mesa depende de o garçom lançar o pedido pelo
Admin** (lacuna identificada na seção 9 — não existe tela de "novo pedido" no Admin hoje), a
identificação da mesa poderia nascer no lado do operador, não do cliente — mudando completamente qual
das 4 alternativas faz mais sentido.

---

## 17. Recomendação

1. Modelar o tipo de pedido como coluna estruturada (`orders.tipo_pedido` ou nome equivalente,
   `CHECK IN ('entrega','retirada','mesa')`, `DEFAULT 'entrega'`), eliminando a dependência de regex
   sobre `address` para decisões novas (a regex pode continuar existindo só para reclassificar o
   histórico pré-migração, sem urgência de backfill).
2. Modelar a habilitação por loja como `store_settings(store_id, 'mesa_enabled', ...)`, com o par
   `get_mesa_config`/`set_mesa_config` seguindo exatamente o molde de `loyalty_enabled` — inclusive o
   default seguro "desligado".
3. Validar a capacidade dentro de `create_order()`, no mesmo ponto onde `_resolve_delivery_fee` já é
   chamado, fail-closed, mensagem genérica — fechando o vetor de bypass via chamada direta à RPC.
4. Corrigir `AdminRelatorios.jsx`/`admin_reports_summary()` para não rotular um terceiro tipo como
   "Entrega" por padrão, **antes** de qualquer pedido real de Mesa poder ser criado (para não
   corromper silenciosamente o BI desde o primeiro pedido).
5. Decidir, como pré-requisito de produto (não técnico): Mesa nasce pelo storefront do cliente
   (como hoje Entrega/Retirada) ou depende de uma tela de "novo pedido" no Admin operado pelo
   garçom/caixa? Essa decisão muda o formato de identificação da mesa (seção 16) e o escopo real da
   Onda 2.
6. Adicionar um campo próprio para identificação da mesa, não reaproveitar `address` como já é feito
   hoje para retirada — para não perpetuar a mesma fragilidade que motivou este relatório.

---

## 18. Proposta de ondas de implementação (não iniciar sem aprovação)

- **Onda 1 — Schema e capability (banco):** coluna `tipo_pedido` + CHECK; `store_settings` +
  `get_mesa_config`/`set_mesa_config`; validação de capacidade dentro de `create_order`; sem tocar
  UI ainda.
- **Onda 2 — Checkout/storefront:** 3ª opção no seletor (gated por `get_mesa_config`), tratamento
  explícito dos ~9 pontos de `CheckoutPage.jsx` + `SuccessPage.jsx`, campo de identificação da mesa
  (formato definido na decisão de produto da seção 17.5).
- **Onda 3 — Admin/Comanda/Relatórios:** `comandaModel.js` com 3º ramo, `pedidoStatus.js` com
  `FLUXO_MESA`, badge do Admin, correção do rótulo em `AdminRelatorios`/`admin_reports_summary`
  (esta parte específica pode e talvez deva ser adiantada para antes da Onda 2, por segurança de
  dados — ver recomendação 4).
- **Onda 4 — WhatsApp/notificações:** `enc_render_message` recebendo tipo explícito, texto próprio
  para Mesa nos templates de status.
- **Onda 5 — Testes:** atualizar os 11 arquivos listados na seção 14, golden novo (`pedidoMesa`),
  E2E novo (`selecionarMesa()` no Page Object, fixture de pedido de Mesa).

Cada onda seguiria a disciplina já estabelecida no projeto (1 commit por subfase, gates de
verificação, sem squash/push automático).

---

## Achados de risco/bugs separados (não corrigidos nesta auditoria, conforme solicitado)

- **`v_order_reconciliation` já soma incorretamente hoje**, sem relação com Mesa: a view soma só
  `order_items`, sem subtrair `delivery_fee`/`maquininha_fee` de `diff` — todo pedido de entrega com
  taxa > 0 aparece como "divergente" em `orders_health()`. Confirmado ainda presente na migration
  mais recente (`REF-ADDRESS-GEO-INTEGRITY-01`, 2026-08-30). Já registrado anteriormente na memória
  do projeto (REF-DELIVERY-FEE-01); permanece não corrigido.
- **Duplicação de regra de negócio JS/SQL**, já documentada pelo próprio código
  (`REF-DASHBOARD-01-admin-reports.sql:9-12`): a regex `RE_RETIRADA` existe independentemente em
  `comandaModel.js` (JS), `enc_tempo_estimado()` (SQL) e `admin_reports_summary()` (SQL) — qualquer
  mudança futura, com ou sem Mesa, precisa ser replicada manualmente nos 3 lugares.
  Também vale para a **classificação de tipo depender de texto livre** de forma geral: qualquer
  cliente ou processo que grave um `address` com esse padrão de texto (mesmo sem ser uma retirada
  real) seria classificado incorretamente — não é explorável de forma útil hoje, mas é uma
  fragilidade estrutural.
- **Inconsistência de trilha de status já existente entre cliente e Admin**: `PedidoTimeline.jsx`
  (visão do cliente em Meus Pedidos) usa uma constante `TIMELINE` fixa de 5 passos e **não usa**
  `fluxoDoTipo`, enquanto o Admin (`AdminPedidos.jsx`, `PedidoNotificacoes.jsx`) sim usa — ou seja,
  hoje um cliente que fez retirada já vê, na própria tela de acompanhamento, um passo "Saiu para
  entrega" que nunca vai acontecer. Pré-existente, não criado nem agravado por esta auditoria.
- **Ausência de filtro por tipo de pedido no Admin Orders**, já hoje (antes de Mesa existir) — só há
  filtro por status. Se Mesa for adicionada, essa lacuna se torna mais sentida operacionalmente (um
  operador de salão vai querer ver só as comandas de mesa).
- **Ausência de tela de criação manual de pedido no Admin** — toda origem de pedido hoje é o
  storefront do cliente. Relevante como pré-requisito de produto para Mesa fazer sentido
  operacionalmente (seção 9/17.5), registrado aqui como lacuna estrutural pré-existente.
- **Template de notificação `'pronto'` já hedgeia duas frases hoje** por não receber o tipo do
  pedido como parâmetro — funciona por acaso com 2 modos, mas é sintoma do mesmo problema de fundo
  (tipo não é um dado de primeira classe em nenhum ponto do pipeline de notificação).

---

**Gate desta REF:** auditoria concluída, nenhum código/schema/dado alterado, nenhuma migration
criada, Delivery/Retirada/Fidelidade/WhatsApp não tocados. Aguardando decisão do dono do produto
sobre a recomendação da seção 17 e a pergunta de produto da seção 17.5 antes de abrir Onda 1.
