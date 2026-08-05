# ADR REF-DELIVERY-FEE-01 — Taxa de entrega automática por distância

**Status:** Implementada no código (7 ondas); **2 migrations pendentes de aplicação manual no Supabase**
(passo do dono, mesmo fluxo de sempre) antes de qualquer pedido real ser cobrado.
**Data:** 2026-08-05
**Escopo:** cálculo e cobrança automática da taxa de entrega por distância (loja↔cliente) + acréscimo de
retorno da maquininha, substituindo a inexistência de uma taxa codificada até aqui. Toca: schema
(`orders`, `settings`), `create_order`, `admin_orders_search`, checkout (tempo real + persistência),
comanda + mensagem WhatsApp, painel Admin.

---

## 1. Contexto

A operação usa uma central de motoboys terceirizada que cobra por quilometragem — a taxa de entrega
**não pode** depender de bairro/cidade/CEP/motoboy específico, só da distância loja↔cliente.

### Achados da auditoria antes de implementar

- **Não existia taxa de entrega manual codificada.** A tarefa original presumia estar "substituindo" uma
  taxa manual, mas a auditoria (leitura de `pricing.js`, `orderPayload.js`, `comandaModel.js`) confirmou
  que `order.total` sempre foi exatamente `cart.total` (soma dos itens) — o único artefato relacionado
  era um "delta" genérico (`total - subtotal`) na comanda, rotulado "Taxa de entrega / ajuste", nunca
  populado de fato (a mensagem do WhatsApp inclusive **suprimia** esse valor de propósito). Era,
  tecnicamente, uma feature nova, não uma migração de regra existente.
- **Endereço do cliente sem coordenadas em 1 dos 4 fluxos.** `montarEndereco` já tem `lat`/`lng`, e os
  fluxos de busca por texto/GPS/mapa sempre os preenchem (via waterfall Nominatim/Photon/Mapbox) — mas o
  fluxo por **CEP** (ViaCEP) nunca devolve coordenada, e o código nunca geocodificava depois. Gap real que
  precisava de tratamento (ver §2.4).
- **Sem haversine e sem coordenada da loja em lugar nenhum.** Nem `STORE_INFO` nem `company_info` tinham
  latitude/longitude da loja; nenhuma função de distância existia no projeto.
- **`orders` nunca teve coluna JSON genérica.** Todo dado novo dessa tabela sempre entrou como coluna
  dedicada e tipada (`endereco_id`, `request_id`, etc.) — confirma o padrão a seguir para `delivery_fee`/
  `maquininha_fee`, em vez de um campo `jsonb` solto.
- **Precedente mais forte para "tabela editável no Admin":** `business_hours_schedule`
  (REF-BUSINESS-HOURS-04) — um array JSON dentro de UMA linha de `settings`, RPC `get_/set_` dedicada,
  validação completa no servidor. Replicado aqui para as faixas de distância.

### Decisões do dono (checkpoint de aprovação, 2026-08-05)

1. **Localização da loja:** arrastar um pino no mapa (reaproveita a infraestrutura Leaflet/OSM gratuita já
   existente no domínio Address), não digitar coordenadas manualmente.
2. **Maquininha:** acréscimo só em Débito e Crédito (motoboy só leva o aparelho físico nesses casos;
   Dinheiro e PIX não precisam).
3. **Fallback quando a distância não pode ser calculada** (sem coordenadas mesmo após tentar
   geocodificar de novo, ou acima da maior faixa cadastrada): **nunca bloquear o checkout** — segue com
   taxa R$ 0,00 e um aviso de que o valor será confirmado pela loja.
4. **Ativação inicial:** a cobrança automática **já nasce LIGADA** em produção assim que a migration for
   aplicada (a tabela padrão de 17 faixas já vem semeada e ativa) — não fica esperando o dono ativar um
   toggle depois do deploy.

---

## 2. Decisão / arquitetura

### 2.1 Fundação de dados (2 migrations, aditivas, com rollback)

- **`migrations/REF-DELIVERY-FEE-01-step1-fee-config-rpc.sql`** — nova chave `delivery_fee_config` em
  `public.settings`: `{ version, ativo, maquininha:{ativo,valor}, faixas:[{de,ate,valor}, ...] }`. Semeada
  com a tabela fornecida pelo dono (17 faixas, 0–21 km, R$ 10–R$ 42) + maquininha R$ 2,00 ativa +
  `ativo:true`. RPCs `get_delivery_fee_config()` (`SECURITY DEFINER`, leitura pública — mesma razão de
  `get_business_hours_schedule`: a RLS de `settings` é trancada) e `set_delivery_fee_config(jsonb)`
  (`SECURITY DEFINER`, `is_admin()`, revalida cada faixa: numérica, `de>=0`, `ate>de`, valor `>=0`, sem
  duplicata, sem sobreposição — mesmo algoritmo de `set_business_hours_schedule`, adaptado de horários
  para quilômetros). **Nenhum valor fica hardcoded na regra de cálculo** — tudo vem deste registro.
- **`migrations/REF-DELIVERY-FEE-01-step2-orders-schema.sql`** — `orders` ganha `delivery_fee numeric NOT
  NULL DEFAULT 0 CHECK (>=0)` e `maquininha_fee numeric NOT NULL DEFAULT 0 CHECK (>=0)`. `create_order`
  (mesma assinatura, só o corpo muda) passa a ler essas 2 chaves opcionais de dentro do `p_order` jsonb já
  existente (mesmo veículo de `address`/`payment_method`/`endereco_id`) — ausentes, viram 0 (compat total
  com qualquer chamador antigo, incluindo pedidos de retirada). `admin_orders_search` (RETURNS TABLE muda
  → exige DROP+CREATE, mesmo procedimento de REF-DATETIME-01b) passa a expor as 2 colunas — sem isso, nem
  o card do Admin nem a comanda enxergariam os valores novos (mesmo problema que `endereco_id` teve antes
  de `admin_orders_search` ser atualizada).

**Localização da loja não precisou de migration própria.** Segue o precedente da REF-COMPANY-03: campos
novos em `company_info` (`lojaLat`/`lojaLng`, nullable) entram pelo merge raso já existente de
`set_company_info` — validação numérica só no cliente
(`companyInfoRules.validarPatchCompanyInfo`), já que o pior caso de um valor inválido é o cálculo cair no
fallback "sem coordenadas" (nunca cobra errado).

### 2.2 Camada única de regra de negócio

`src/services/delivery/deliveryFeeRules.js` — módulo 100% puro (mesma disciplina de `utils/pricing.js`):

- `localizarFaixa(distanciaKm, faixas)` — encontra a faixa de **menor "ate" que seja `>= distanciaKm`**.
  As faixas são contíguas por design (gap de exibição de 0,1 km entre uma e outra, ex. 5,0 → 5,1) —
  esse critério nunca deixa uma distância contínua cair num buraco de cobertura.
- `calcularMaquininhaFee(paymentMethod, maquininhaConfig)` — só `cartao_debito`/`cartao_credito`,
  independente da distância/faixa.
- `montarResumoFinanceiro({ subtotal, retirada, distanciaKm, config, paymentMethod })` — **fonte única**
  consumida por Checkout (tempo real), persistência, comanda e WhatsApp. Retorna sempre
  `{ subtotal, distanciaKm, faixa, deliveryFee, maquininhaFee, total, status }`, `status` ∈ `retirada` |
  `desativado` | `sem_coordenadas` | `fora_de_alcance` | `ok`. Retirada nunca tem taxa nem maquininha
  (sem motoboy); maquininha é **independente** do toggle de cobrança automática (só depende do seu próprio
  toggle + forma de pagamento).
- Haversine (`distanciaKm`) mora em `src/address/utils/coordinates.js` (dominio Address já possui
  lat/lng/`CENTRO_PADRAO`) — `deliveryFeeRules.js` só consome a distância, nunca recalcula geometria.

### 2.3 Camada IO/cache + formulário do Admin

Espelha 1:1 `services/businessHours/cronograma.js` + `scheduleForm.js` +
`hooks/useBusinessHoursSchedule.js` (substituição total do documento, não PATCH; cache em memória,
`geracao` anti-corrida, evento customizado, TRUTHFUL — só reflete "salvo" quando o servidor confirma):

- `services/delivery/deliveryFeeConfig.js` — `lerDeliveryFeeConfigCache`/`sincronizarDeliveryFeeConfig`/
  `definirDeliveryFeeConfig`, `DELIVERY_FEE_EVENT`, fallback `DELIVERY_FEE_CONFIG_PADRAO` (byte-igual à
  semente SQL).
- `services/delivery/deliveryFeeConfigForm.js` — puro: `paraEditavel`/`paraPersistirFaixas`/
  `validarFaixas` (sobreposição/duplicata/negativo/intervalo inválido — mesmas regras do RPC) +
  `valorMaquininhaValido`.
- `hooks/useDeliveryFeeConfig.js` — espelha `useBusinessHoursSchedule.js`.

### 2.4 Checkout: cálculo em tempo real + fallback de coordenadas

`CheckoutPage.jsx`:

- Coordenada do **cliente**: vem de `endereco.lat/lng` quando presentes (busca/GPS/mapa). Quando ausentes
  (aba CEP), um `useEffect` chama `geocoding.coordenadasDe(endereco)` (novo método da fachada de
  geocoding do domínio Address, `address/services/geocodingService.js`) — geocodifica o endereço
  **composto** (rua+número, bairro, cidade-UF) usando a **mesma** cadeia de provedores gratuitos
  (Mapbox/Nominatim/Photon) já usada pela busca do modal. Nenhum serviço novo, nenhum custo novo. Nunca
  bloqueia: falha/demora mantém `distanciaKm: null` → `status: 'sem_coordenadas'`.
- Coordenada da **loja**: `useCompanyInfo().lojaLat/lojaLng` (Admin > Taxa de Entrega).
- `resumo = montarResumoFinanceiro(...)` recalculado via `useMemo` a cada mudança relevante (endereço,
  forma de pagamento, config, subtotal) — **sem precisar finalizar o pedido**.
- Resumo visual: `Subtotal`/`Entrega`/`Retorno da maquininha` só aparecem quando há parcela > 0 (retirada
  e "sem taxa" continuam com o resumo simples de sempre, zero mudança visual); "Entrega: A confirmar"
  quando `sem_coordenadas`/`fora_de_alcance`. Botão final mostra o TOTAL real (subtotal+entrega+
  maquininha).
- `buildOrderArgs`/`buildOrderConfirmationMessage`/`buildCheckoutView` (`utils/orderPayload.js`) ganham um
  `resumo` **opcional** — ausente preserva 100% o comportamento antigo (compat total com qualquer
  chamador/teste que não calcule taxa); presente, é a fonte única de `total`/`delivery_fee`/
  `maquininha_fee` persistidos e da mensagem de confirmação.

### 2.5 Comanda + WhatsApp

`comandaModel.js`: `totais.entrega`/`totais.maquininha` **explícitos**, lidos direto de
`order.delivery_fee`/`order.maquininha_fee` — nunca mais "adivinhados" pela diferença total-subtotal. O
`delta` (mecanismo antigo) continua existindo, mas só como **resíduo genuinamente não explicado**
(`total - subtotal - entrega - maquininha`) — pedidos legados/sem taxa (delivery_fee/maquininha_fee=0)
preservam o comportamento de sempre.

`comandaTexto.js` (interna + cliente) e `comandaHtml.js` ganham as linhas "Entrega"/"Retorno maquininha"
quando > 0. **Mudança de comportamento deliberada:** a mensagem do cliente deixa de suprimir a taxa
positiva (antes proposital, "ainda não calculada automaticamente" — comentário removido, não fazia mais
sentido) — o "ajuste" genérico residual continua suprimido quando positivo (só desconto), porque esse
resíduo nunca deveria ser exposto como número "adivinhado".

### 2.6 Painel Admin

Nova aba **"🚚 Taxa de Entrega"** (`AdminTaxaEntrega.jsx`), registrada em `AdminPanel.jsx`:

- **Localização da loja** — mapa com pino arrastável (reaproveita `mapService.js` do domínio Address,
  exportado pelo barrel `address/index.js`), salva via `set_company_info`. Botão próprio, TRUTHFUL.
- **Cobrança automática por distância** — toggle geral + tabela de faixas De/Até/Valor totalmente
  editável (+Adicionar/✕Remover, ordenação automática por "de", validação inline reaproveitando
  `deliveryFeeConfigForm.js` — nenhuma regra duplicada da que o servidor também valida).
- **Retorno da maquininha** — toggle + valor (R$), editável sem deploy.
- Ativo/faixas/maquininha salvos juntos (1 documento, 1 RPC, 1 botão "Salvar Alterações" — mesmo padrão
  de `AdminBusinessHours`); localização salva separadamente (fonte diferente, `company_info`).

`AdminPedidos.jsx` — card do pedido exibe "Entrega R$X"/"Maquininha R$X" quando existirem (lê os campos
já retornados por `admin_orders_search`, nunca recalcula).

### 2.7 O que NÃO mudou

`pricing.js` (subtotal do carrinho), `useCart`, fluxo de fidelidade, idempotência, validação de telefone,
`STORE_INFO.retirada`, endereço institucional (`company_info.cep/rua/...`), Mapbox/Nominatim/Photon
(waterfall intocado), `dentroDaArea` (segue desligada), autenticação, RLS de `orders`.

---

## 3. Limitação conhecida (registrada, não escondida)

**`v_order_reconciliation` / `orders_health()` (painel "Saúde do Sistema") ainda não sabe sobre
`delivery_fee`/`maquininha_fee`.** A view pré-existente (fora do histórico de migrations rastreado; a
introspecção via PostgREST no projeto de E2E confirmou as colunas `order_id`/`total`/`diff`, mas não expôs
a definição SQL completa — sem acesso a `pg_catalog` pela API, redefinir a view às cegas seria arriscado)
calcula `diff = total - Σ(itens)`. A partir desta ref, um pedido de entrega COM taxa tem `total > Σ(itens)`
**por desenho**, não por erro — então o contador "divergências" do painel de Saúde vai contar esses
pedidos como divergência, mesmo estando corretos. Não afeta cobrança, checkout, comanda ou WhatsApp — só
o diagnóstico interno. **Correção futura recomendada:** o dono (ou quem tiver acesso ao SQL Editor) roda
`SELECT pg_get_viewdef('v_order_reconciliation', true);`, e a view é redefinida subtraindo
`delivery_fee + maquininha_fee` do `diff`, mesmo espírito do ajuste já feito em `comandaModel.js` §2.5.

Outras limitações honestas, já eram gaps preexistentes e continuam fora de escopo: `troco` nunca
persistido no banco (ADR REF-ORDER-01 §5); número do pedido (`numeroCurto`) é aproximação por epoch, não
sequencial real (ADR REF-CHECKOUT-03).

---

## 4. Testes

- `tests/deliveryFee.golden.mjs` — haversine (pontos iguais/distância conhecida/coordenada inválida),
  `localizarFaixa` (as 17 faixas da tabela padrão, meio de faixa, buraco de exibição, mudança exata,
  fora de alcance, distância inválida), `calcularMaquininhaFee` (débito/crédito cobram; dinheiro/PIX não;
  toggle desligado), `montarResumoFinanceiro` (retirada/desativado/sem coordenadas/fora de
  alcance/ok-com-e-sem-taxa/maquininha independente/pureza), `deliveryFeeConfigForm` (ida-e-volta,
  sobreposição, início>fim, intervalo inválido, negativos, duplicata, toque exato permitido).
- `tests/deliveryFee-admin.guard.mjs` — estrutural: Admin registrado, reaproveita validação/mapa (nunca
  reimplementa), nenhum valor de faixa hardcoded no componente, `AdminPedidos` só exibe (nunca recalcula).
- `tests/checkout.golden.mjs` — `p_order` com `delivery_fee`/`maquininha_fee` (payload byte-a-byte),
  pins de fonte atualizados (`order.total`, `buildOrderArgs` recebe `resumo`), `buildCheckoutView`
  com/sem resumo (linhas condicionais, nunca "R$ 0,00").
- `tests/comanda.golden.mjs` — `totais.entrega`/`maquininha` explícitos, linhas na comanda interna e na
  mensagem do cliente (com e sem taxa), HTML impresso.
- `tests/company-info.golden.mjs` — `lojaLat`/`lojaLng` (27 campos agora, validação de intervalo global,
  null aceito).
- `e2e/tests/admin/admin-taxa-entrega.spec.js` — rodado de verdade contra o Supabase de E2E: renderização
  (localização/faixas/maquininha), 17 faixas semeadas, adicionar/remover faixa, validação de faixa
  inválida e de sobreposição em tempo real. **Confirmado visualmente** (screenshot: mapa Leaflet
  renderizado com pino, tabela de faixas, botões, mensagens de estado).
- `test:domain` 37/37 + `test:deps` + `npm run build` verdes a cada onda.

**Não coberto por E2E nesta entrega (gap registrado, não escondido):** o fluxo completo de checkout em
modo **entrega** com seleção de endereço real (busca/GPS/mapa) até a confirmação com taxa calculada —
exigiria simular geolocalização/geocoding de forma confiável em CI, fora do escopo desta rodada. A
correção matemática do cálculo está integralmente coberta pelos goldens (§ acima); o que falta é a prova
"ponta a ponta pelo navegador" desse caminho específico.

---

## 5. Impacto e próximos passos

1. **Dono aplica as 2 migrations** no SQL Editor do Supabase de produção (`REF-DELIVERY-FEE-01-step1-*` e
   `-step2-*`, nessa ordem).
2. **Dono define a localização da loja** no Admin (Taxa de Entrega > arrastar o pino) — sem isso, todo
   pedido cai no fallback "sem coordenadas" (taxa R$0 + aviso), mesmo com a cobrança automática ativa.
3. Validar ao vivo um pedido de entrega real (endereço com coordenadas conhecidas) e conferir: resumo do
   checkout, pedido salvo (`orders.delivery_fee`), comanda impressa, mensagem WhatsApp — todos com o
   mesmo valor.
4. (Opcional, não bloqueante) redefinir `v_order_reconciliation` — ver §3.

Relaciona: [[REF-ADDRESS-02-arquitetura-profissional]] (schema/coordenadas do endereço, waterfall de
geocoding reaproveitado), [[REF-BUSINESS-HOURS-04-cronograma-administravel]] (molde direto da config
"documento inteiro" + formulário puro), [[REF-COMPANY-03-central-configuracao-empresa]] (precedente de
campo novo sem migration), [[REF-CHECKOUT-02-confirmacao-automatica-whatsapp]] /
[[REF-CHECKOUT-03-comanda-whatsapp-layout-comercial]] (camada compartilhada comanda/WhatsApp estendida
aqui).
