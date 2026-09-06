# REF-PAGAMENTO-01 — Arquitetura técnica (Mercado Pago)

**Status: ARQUITETURA ESPECIFICADA. PARADA NO GATE DE APROVAÇÃO — zero código de produção criado.**

Continuação da descoberta (`docs/ref/REF-PAGAMENTO-01-descoberta.md`, commit `459bd8c`) após decisão
de produto: **gateway escolhido = Mercado Pago**. Esta etapa NÃO reabre a descoberta nem a
contradiz — parte dela como base e a transforma em especificação de implementação. Executada de
forma autônoma (autorização explícita do dono, madrugada de 2026-09-06), só para arquitetura/
decisões técnicas — zero migration, zero RPC, zero frontend, zero Edge Function, zero secret criado
ou solicitado nesta etapa.

## Reconfirmação do estado do código (não presumido do relatório anterior)

Antes de especificar qualquer coisa, reconferido ao vivo (não assumido):
- `create_order()` continua exatamente como descrito na descoberta — última alteração é
  `REF-MESA-02-onda6-abertura-implicita.sql` (commit `f489603`), nenhuma migration entre `459bd8c` e
  agora tocou essa função. Confirmado via `git log --diff-filter=AM -- migrations/*.sql`.
  `REF-DELIVERY-FEE-05` avançou mais uma onda (3.2, commit `611b69f`) mas só em
  `delivery_route_cache`/`route-distance` (Edge Function) — zero sobreposição com pagamento,
  não tocada.
- `SuccessPage.jsx` (lida agora pela 1ª vez, não estava na descoberta original): a tela pós-checkout
  abre o WhatsApp **automaticamente e sem confirmação de pagamento nenhuma** assim que monta
  (`useEffect` na 1ª renderização) — é presencial/COD hoje, então isso é correto; é o ponto exato que
  uma integração online precisa interceptar (ver §H).
- `DataService.js::savePedido/savePedidoAdmin` (linhas 174-212): chamam a RPC `create_order`, tratam
  `divergencia_valor` (mostra o valor real ao cliente, nunca re-tenta cegamente com o valor antigo) e
  logam erro real (`sqlstate`) no Sentry via `capturarDenyTenant`. Nenhuma mudança necessária aqui
  pra manter compatibilidade — a integração de pagamento é uma camada ADITIVA sobre isso, não uma
  reescrita.

## 1. Checkout Pro vs Checkout Bricks (Payment Brick) — comparação técnica

Pesquisado na documentação oficial atual (`developers.mercadopago.com.br`, pt-BR), não em blog/vídeo.

| Critério | Checkout Pro | Checkout Bricks (Payment Brick) |
|---|---|---|
| Modelo | Hospedado — cliente é redirecionado/abre overlay no domínio do Mercado Pago pra pagar | Embutido — componente de UI renderizado DENTRO da própria página do Encanto |
| Controle de UX | Baixo — tela é do Mercado Pago, só personalização visual limitada (preferência) | Alto — tema/cores configuráveis, cliente nunca sai do fluxo do Encanto |
| Esforço de integração | Baixo — cria uma "preference" (objeto com itens/valor) no backend, redireciona | Médio-alto — SDK JS no frontend (renderiza o componente), backend processa o pagamento tokenizado via API |
| Dados de cartão | Nunca tocam o Encanto (tudo na página do Mercado Pago) | Tokenizados DIRETO no browser pelo SDK JS do Mercado Pago — raw PAN/CVV também nunca chegam ao backend do Encanto, só um token opaco |
| Pix embutido | Sim, mas numa tela do Mercado Pago | Sim, QR code renderizado dentro da própria página do Encanto |
| Taxa de aprovação | Historicamente mais alta (segundo doc oficial: "maior índice de pedidos aprovados") — cliente logado no MP ganha atalhos/parcelamento próprio | Equivalente tecnicamente, mas sem os atalhos de conta logada do MP |
| Compatível com Split/marketplace | Sim — `marketplace_fee` na criação da preference | Sim — `application_fee` na criação do pagamento via API |
| Compatível com React/Vite | Sim, mas é essencialmente um redirect/link — qualquer stack serve | Sim, SDK JS oficial (`@mercadopago/sdk-react` tem wrapper React pronto) — integra bem com o padrão de componentes já usado no projeto |
| Consistência com a UX atual do Encanto | Quebra o padrão — o checkout hoje é 100% customizado (`CheckoutPage.jsx`), sair pra um domínio externo no MEIO do fluxo de pagamento é uma ruptura de UX nova (diferente do WhatsApp pós-pedido, que já é uma saída ACEITA hoje, mas só DEPOIS do pedido confirmado) | Mantém o cliente dentro do funil do Encanto do início ao fim — consistente com o investimento já feito em UX própria (REF-PERF-01/02, REF-UI-*) |
| Manutenção/dependências | Nenhuma dependência de frontend nova (é um link/redirect) | Nova dependência (`@mercadopago/sdk-react`), mais superfície de manutenção |

### Recomendação técnica

**Payment Brick (Checkout Bricks) é a opção recomendada.** Justificativa: (1) mantém o cliente dentro
do funil do Encanto — este projeto já investiu pesado em UX própria e nunca delegou uma etapa
crítica do fluxo de compra pra um domínio externo; (2) a tokenização client-side do cartão já
resolve o requisito de segurança mais importante (raw card data nunca toca o backend do Encanto,
igual ao Checkout Pro nesse quesito específico); (3) tem wrapper React oficial
(`@mercadopago/sdk-react`), reduzindo o esforço de integração frente a uma implementação 100%
manual via API pura; (4) é igualmente compatível com Split 1:1 pra evolução futura.

**Trade-off honesto**: exige mais esforço de implementação e mais superfície de manutenção do que
Checkout Pro (que é essencialmente "criar uma preference e redirecionar"). Se o dono priorizar
velocidade de entrega sobre controle de UX nesta fase, Checkout Pro é uma alternativa legítima e
mais rápida — não é uma escolha errada, é um trade-off diferente.

**Esta é uma DECISÃO AINDA DEPENDENTE DO DONO.** O que está acima é recomendação técnica com
justificativa e trade-offs explícitos, não uma escolha já aprovada — nenhuma linha de integração
foi criada partindo dela.

## 2. Modelo de dados (especificação — nenhuma migration criada)

Filosofia preservada de TODA a base existente (mesmo idioma arquitetural de `mesa_sessao_habilitada`,
`mesa_habilitada`, etc.): **capability opt-in por loja, aditiva, zero mudança de comportamento pra
quem não ligou**. `create_order()` e `_resolve_delivery_fee()` permanecem **intocados** — a
integração de pagamento é uma camada por CIMA da criação do pedido, nunca uma reescrita dela.

### Tabelas novas (especificação)

**`payment_intents`** (nome provisório) — 1:1 com uma tentativa de cobrança de um `order`:
- `id uuid PK`, `order_id uuid FK -> orders(id)`, `store_id uuid` (sempre igual ao do order, checado
  explicitamente em toda RPC/Edge Function, nunca inferido)
- `provider text` (`'mercadopago'` — já nasce genérico o suficiente pra um 2º provedor futuro sem
  redesenho)
- `mp_payment_id text NULL` (preenchido só depois que o Mercado Pago cria o pagamento; nulo durante
  criação de PIX/preference antes da 1ª resposta)
- `status text` (espelha os status do Mercado Pago, ver §5 — nunca um enum fechado numa 1ª versão,
  mesmo padrão de `payment_method` hoje: gateway evolui os status mais rápido que uma migration)
- `status_detail text NULL` (sub-status do Mercado Pago, auditoria)
- `amount numeric(10,2)` — SEMPRE = `orders.total` no momento da criação (nunca um valor recalculado
  depois; se o pedido mudar de valor, isso não deveria acontecer pós-criação, ver §7)
- `idempotency_key uuid` — gerado no momento da criação, reenviado em qualquer retry da MESMA
  operação lógica (nunca um novo a cada tentativa)
- `raw_payload jsonb NULL` — snapshot da última resposta/webhook do Mercado Pago (auditoria, mesmo
  espírito de `valor_cobrado_snapshot` da Mesa — nunca fonte de cálculo, só rastro)
- `created_at`, `updated_at timestamptz`

**Por que uma tabela nova em vez de colunas em `orders`**: evita inchar `orders` (já tem 20+ colunas)
com um domínio inteiro (múltiplas tentativas possíveis por pedido — ex.: Pix expira, cliente tenta
cartão) e preserva `orders` como a fonte única de verdade OPERACIONAL do pedido, com
`payment_intents` como o histórico financeiro auxiliar (mesmo padrão relacional já usado por
`mesa_session_mesas` vs `mesa_sessions`).

### Colunas novas em `orders` (aditivas, nullable, zero impacto em pedido existente)

- `payment_status text NULL` — `NULL` = "não aplicável" (todo pedido COD existente e futuro continua
  `NULL` pra sempre, comportamento 100% preservado). Só populado quando a loja tem a capability
  ligada E o cliente escolheu pagamento online. Valores propostos em §5.
- Nenhuma outra coluna nova em `orders` é necessária — `payment_intents` carrega o resto.

### `store_settings` — nova capability (mesmo padrão de `mesa_habilitada` etc.)

- `pagamento_online_habilitada` (bool, default false)
- `mp_public_key` (texto, pode ir em `store_settings` — é público por design do próprio Mercado Pago)
- `mp_access_token` **NUNCA** em `store_settings` (tabela lida por RPCs `STABLE`/client-facing em
  vários pontos) — vive em **Supabase Vault**, mesmo mecanismo já usado pelos tokens do WhatsApp
  Cloud API (REF-ORDER-01) — reaproveita padrão existente, não inventa um novo.

## 3. Segredos — o que fica onde (nenhum criado nesta etapa)

| Segredo | Onde vive | Quem acessa |
|---|---|---|
| `mp_public_key` (por loja) | `store_settings` (texto normal) ou até bundle client-side | Frontend (Payment Brick SDK precisa dele pra tokenizar cartão) — é PÚBLICO por design do Mercado Pago, não é segredo real |
| `mp_access_token` (por loja) | Supabase Vault (mesmo padrão do WhatsApp Cloud API, REF-ORDER-01) | SOMENTE Edge Function/RPC server-side — nunca sai do backend |
| Webhook secret (assinatura HMAC) | Supabase Vault | SOMENTE a Edge Function que recebe o webhook, pra validar `x-signature` |
| `Client ID`/`Client Secret` (OAuth, só se/quando Split 1:1 avançar) | Supabase Vault, nível PLATAFORMA (não por loja — é da VALION) | SOMENTE o fluxo de OAuth server-side, nunca client-side |

**Nunca em `VITE_*`** (env var com esse prefixo entra no bundle público) exceto o `mp_public_key`,
que é seguro por design (é assim que o Mercado Pago documenta o uso dele). Nenhum destes foi criado,
solicitado ou colado nesta sessão — confirmado no `git status` final (§13).

## 4. Fluxo de criação de cobrança (especificação)

```
1. Cliente finaliza checkout no Encanto (CheckoutPage.jsx) — MESMO fluxo de hoje até aqui:
   endereço, itens, forma de pagamento escolhida (agora incluindo "pix_online"/"cartao_online").
2. create_order() roda EXATAMENTE como hoje — resolve preço/taxa/adicional 100% server-side,
   persiste o pedido com orders.status = 'aguardando_pagamento' (novo valor, só quando
   pagamento_online_habilitada=true E o método escolhido for online) e orders.payment_status='pendente'.
   ZERO mudança na lógica de precificação/taxa existente.
3. Uma NOVA RPC (ex.: admin_criar_cobranca_pagamento ou equivalente client-facing) recebe
   SOMENTE o order_id já criado — nunca um valor solto do client. Lê orders.total (autoritativo,
   já resolvido no passo 2), cria a linha em payment_intents (status='criando', idempotency_key
   novo), e devolve os dados necessários pro frontend renderizar o Payment Brick (ou os dados de
   Pix, se for esse o método).
4. Uma Edge Function (chamada pela RPC acima, ou pela própria RPC via pg_net -- decisão de
   implementação, não desta arquitetura) chama a API do Mercado Pago (POST /v1/payments ou
   /orders, dependendo da geração de API escolhida na implementação -- ver nota na Onda 2) com:
   - amount = orders.total (autoritativo, nunca do client)
   - external_reference = order_id (nunca um valor livre -- é a chave de correlação do webhook)
   - metadata = { store_id } (2ª camada de correlação, redundante de propósito -- nunca confiar
     só no external_reference sozinho)
   - X-Idempotency-Key = payment_intents.idempotency_key
5. Resposta do Mercado Pago atualiza payment_intents (mp_payment_id, status inicial).
6. Frontend recebe o necessário pra completar o pagamento (QR do Pix, ou o Payment Brick processa
   o cartão) -- SEM NUNCA ver o access_token da loja.
```

**Ponto crítico preservado**: em nenhum passo o valor cobrado nasce do browser. O único número que
sai do client é a ESCOLHA do método (pix/cartão), nunca o valor — exatamente a mesma filosofia já
provada em `_resolve_delivery_fee`/`create_order` (client é sempre advisory, servidor é sempre
autoritativo).

## 5. Máquina de estados

**`orders.status`** (operacional — ganha 1 valor novo, opt-in, resto INTOCADO):
```
aguardando_pagamento  (NOVO — só quando pagamento_online_habilitada + método online)
        │
        │ (webhook confirma aprovado, SERVER-SIDE)
        ▼
    recebido   (JÁ EXISTE — reaproveita 100% do fluxo atual: notificação, WhatsApp admin, etc.)
```
Se o pagamento for recusado/expirado, o pedido NUNCA vira `recebido` — fica retido em
`aguardando_pagamento` até: (a) o cliente tentar de novo (nova `payment_intent` pro MESMO `order_id`,
nunca um pedido duplicado), ou (b) expirar por tempo e o pedido ser cancelado (política de expiração
é decisão de produto, não definida aqui — ver §15).

**`orders.payment_status`** (financeiro, novo, `NULL` pra todo pedido COD):
```
pendente  →  aprovado
   │      ↘
   │        recusado
   │      ↘
   │        expirado   (Pix não pago no prazo)
   ▼
em_contestacao  →  estornado   (chargeback/refund, pode acontecer DEPOIS de aprovado)
```

Mapeamento a partir dos status reais do Mercado Pago (confirmado na documentação oficial atual —
nota: a doc atual descreve DOIS modelos, o clássico `/v1/payments` (`pending`/`approved`/
`authorized`/`in_process`/`in_mediation`/`rejected`/`cancelled`/`refunded`/`charged_back`) e o mais
novo unificado da Orders API (`created`/`processed`/`processing`/`action_required`/`charged_back`/
`expired`/`refunded`/`failed`/`canceled`, cada um com `status_detail` próprio) — **qual API
efetivamente usar é decisão da Onda 2/implementação, não desta arquitetura**; o mapeamento acima é
alto nível o suficiente pra caber nos dois. `payment_intents.status`/`status_detail` guardam o valor
CRU do Mercado Pago sem tradução, exatamente pra não perder informação se a tradução de alto nível
precisar mudar depois.

**Regra inegociável (pedida explicitamente)**: **o frontend NUNCA escreve `payment_status` nem
`orders.status='recebido'` diretamente.** Só o webhook (validado por assinatura) ou uma consulta
server-side direta à API do Mercado Pago podem transicionar esses campos. Nenhuma RPC client-facing
recebe um `status` como parâmetro nesse domínio.

## 6. Webhooks

Confirmado na documentação oficial (`docs/split-payments/.../webhooks`):

- Header `x-signature`: formato `ts=<timestamp_ms>,v1=<hmac>`. A assinatura HMAC é calculada sobre
  uma string composta por `x-signature` + `x-request-id` (outro header) + `data.id` (query param) —
  validada contra o "webhook secret" configurado em "Suas integrações" (por loja, vive no Vault,
  §3).
- Payload contém `id`, `type` (`payment`, `order`, etc.), `action`, `data.id` (id do recurso — nunca
  o valor/status em si), `user_id`, `live_mode`.
- **A doc é explícita: é OBRIGATÓRIO consultar a API (`GET /v1/payments/{id}` ou equivalente) depois
  de receber o webhook** — o payload do webhook é só um "algo mudou, vá conferir", nunca a fonte de
  verdade do valor/status. Isso já é exatamente a postura que este projeto adota em toda parte
  (nunca confiar em dado do client) — aqui o "client" é o próprio webhook.
- Mercado Pago reenvia se não receber 200/201 em ~22 segundos, com retentativa a cada ~15 minutos —
  a Edge Function precisa responder rápido (confirmar recebimento) e pode processar o grosso de
  forma que não bloqueie a resposta, se necessário.
- **Duplicidade/replay não é coberta pela doc oficial como responsabilidade do Mercado Pago** — é
  responsabilidade da integração (nossa). Ver idempotência (§7).

### Fluxo do webhook (especificação)

```
Mercado Pago → POST Edge Function (endpoint dedicado, ex.: supabase/functions/mp-webhook)
  1. Valida x-signature (HMAC, secret do Vault) — 401 imediato se inválido, ZERO leitura de banco
     antes disso.
  2. Extrai data.id (id do pagamento) do payload/query.
  3. Consulta GET /v1/payments/{id} na API do Mercado Pago (usando o access_token DA LOJA
     correspondente -- resolvida via metadata.store_id do payload, nunca assumida) -- nunca confia
     no valor/status do corpo do webhook em si.
  4. Resolve o order_id via external_reference (setado por nós na criação, §4) -- RE-VALIDA que
     esse order_id pertence ao MESMO store_id do metadata (mesma dupla-checagem já usada em toda
     RPC de Mesa desde a auditoria da Onda 16 da REF-MESA-02) -- discrepância = rejeita e loga,
     nunca escreve.
  5. Upsert idempotente em payment_intents (chave: mp_payment_id + status -- se já processamos
     este EXATO status pra este pagamento, no-op) sob lock (mesmo padrao FOR UPDATE ja usado 3x
     no projeto: redeem_reward, enc_claim_notifications, admin_fechar_conta_mesa).
  6. Se status novo = aprovado: transiciona orders.status 'aguardando_pagamento' -> 'recebido'
     (reaproveita 100% a notificacao/WhatsApp existente -- trg_enc_order_notify ja dispara sozinho
     em UPDATE de orders.status, ZERO codigo novo de notificacao necessario).
  7. Loga em application_logs (mesma tabela/padrao ja usado por create_order em caso de erro).
  8. Responde 200/201 rapido.
```

## 7. Idempotência

Confirmado na doc oficial: `X-Idempotency-Key` é **obrigatório** desde 2024 nas chamadas de criação
de pagamento/refund da API do Mercado Pago (evita cobrança duplicada em caso de timeout/retry de
rede do NOSSO lado). Pontos onde a arquitetura precisa disso:

1. **Criação da cobrança** (§4, passo 4): `idempotency_key` gerado 1x por tentativa lógica, salvo em
   `payment_intents` ANTES da chamada à API — um retry de rede reenvia a MESMA chave, nunca gera 2
   cobranças pro mesmo pedido.
2. **Webhook**: idempotência própria (não é a mesma chave acima) via upsert por
   `(mp_payment_id, status)` — reentrega do Mercado Pago não duplica efeito.
3. **RPC de criação de cobrança** (client-facing): protegida pelo mesmo padrão de `request_id` já
   usado em `create_order()` — um duplo-clique no botão de pagar não cria 2 `payment_intents` pro
   mesmo pedido (reaproveita o padrão já existente e testado, não inventa um novo).

**Garantia explícita pedida**: nenhuma arquitetura aqui permite que um retry crie cobrança
duplicada — os 3 pontos acima cobrem criação, confirmação, e o gatilho do usuário.

## 8. Mesa — impacto e não-impacto

**Não quebra o modelo da REF-MESA-02.** `admin_fechar_conta_mesa()` continua sendo o ponto de
fechamento — se cobrança online algum dia entrar pra Mesa, o design natural (não implementado aqui)
seria: o QR já existente da mesa (`mesas.qr_token`, Onda 5) levar a uma tela de "pagar a conta" que
cria uma `payment_intent` com `order_id` **inexistente** (é uma sessão inteira, não um pedido) —
**isso exigiria um FK alternativo em `payment_intents` (`mesa_session_id` em vez de `order_id`)**,
não coberto pela especificação de §2 como está. **Pagamento PARCIAL de mesa não é assumido nem
especificado** — não estava no escopo desta descoberta original nem foi pedido agora; se o produto
quiser isso no futuro, é uma decisão de negócio nova (dividir conta, pagar por pessoa, etc.) que
merece sua própria REF. Registrado aqui como **dependência/integração futura em aberto**, não como
gap desta arquitetura.

## 9. Delivery / Retirada — preservação explícita

`_resolve_delivery_fee()`, a tabela comercial de faixas, `adicional_pagamento_fee` e
`maquininha_fee` **não são tocados por esta arquitetura**. Efeito colateral a documentar
honestamente: se um pedido usa pagamento online (`pix_online`/`cartao_online`), os dois acréscimos
citados (que hoje só disparam pra `IN('dinheiro','cartao_debito','cartao_credito')`) **não deveriam
mais disparar** — `maquininha_fee` existe porque o motoboy precisa LEVAR a maquininha física (não
existe mais motoboy levando maquininha se o cliente já pagou online), e `adicional_pagamento_fee`
tem a mesma lógica presencial. **Isso é uma mudança real e inevitável em `_resolve_delivery_fee()`
quando a implementação avançar** (adicionar `'pix_online'`/`'cartao_online'` como métodos que NUNCA
acionam nenhum dos dois, simétrico ao tratamento que `'pix'` já recebe hoje pro `maquininha_fee`) —
documentado aqui como impacto conhecido e inevitável, não como algo decidido a mais.

## 10. Multi-tenant / futuro SaaS (Split 1:1 e OAuth) — mapeado, não implementado

Confirmado na doc oficial (`split-payments/split-1-1`, `checkout-pro/how-tos/integrate-marketplace`):

- **Modelo**: Mercado Pago opera como PSP pro "vendedor" (cada loja/tenant), a VALION é o
  "marketplace". Existe uma conta Mercado Pago da PLATAFORMA (VALION) e uma conta por VENDEDOR (cada
  loja do Encanto que quiser receber online).
- **OAuth por vendedor**: fluxo de autorização (o lojista aprova a conexão da conta dele com a
  aplicação da VALION), resultando em `access_token` + `public_key` PRÓPRIOS daquele vendedor —
  **nunca um token único compartilhado entre lojas**. Documentação oficial confirma validade de 6
  meses pro access_token OAuth, exigindo reautorização periódica (mecanismo de refresh não coberto
  em detalhe pela doc consultada — pesquisar na Onda de implementação se avançar).
  **Consequência arquitetural direta pro schema (§2)**: `mp_access_token`/`mp_public_key` já nascem
  **por `store_id`** desde o design inicial (nunca um valor único global) — exatamente pra não
  precisar redesenhar o schema quando/se o Split 1:1 avançar. Isso é o motivo de `store_settings`/
  Vault já serem pensados por loja em §2/§3, mesmo numa 1ª fase sem OAuth (a 1ª fase teria só a
  conta da própria VALION recebendo, sem split — o schema já suporta os dois casos sem migration
  extra).
- **`application_fee`/`marketplace_fee`**: parâmetro na criação do pagamento/preference — a fatia
  que a VALION reteria por transação. **Valor/percentual NÃO decidido aqui** — depende de
  REF-BILLING-01 (ainda não iniciada, ver `encanto-roadmap-paralelo-saas01` na memória).
- **Isolamento multi-tenant**: cada `payment_intent`/pagamento só pode ser criado com o
  `access_token` DAQUELE `store_id` (nunca um token de outra loja usado por engano) — a mesma
  garantia de "um tenant nunca vê/usa credencial de outro" já provada extensivamente em toda a
  REF-MESA-02 (Onda 16) se estende naturalmente aqui: `payment_intents` tem RLS por `store_id`,
  toda RPC/Edge Function valida `store_id` explicitamente, nunca confia em inferência.

**Não implementado nesta etapa, por instrução explícita**: nenhum onboarding financeiro de sellers,
nenhum fluxo OAuth real, nenhuma conta de vendedor criada. O único compromisso assumido é de
**design** — o schema de §2/§3 já nasce store_id-first pra não bloquear essa evolução depois.

## 11. Segurança — threat model

| Ameaça | Mitigação especificada |
|---|---|
| Adulteração do preço | `amount` de `payment_intents` sempre = `orders.total` já resolvido por `create_order()` — nunca um valor solto do client (§4) |
| Adulteração do `order_id` | `external_reference` setado só no momento da criação server-side; webhook revalida `store_id` antes de qualquer escrita (§6, passo 4) |
| Adulteração do tenant | Mesma revalidação — dupla-checagem `store_id` (metadata + order lookup), mesmo padrão da Onda 16 da MESA-02 |
| Replay de webhook | Upsert idempotente por `(mp_payment_id, status)` (§7) |
| Webhook falso | Validação HMAC de `x-signature` ANTES de qualquer leitura/escrita de banco (§6, passo 1) |
| Webhook duplicado | Mesma idempotência do replay |
| Token vazado | `access_token` nunca sai do backend (Vault); só `public_key` (seguro por design) chega ao frontend (§3) |
| Access token no frontend | Arquitetura probe explicitamente contra isso — nenhum fluxo desta especificação expõe `access_token` client-side |
| Acesso cross-tenant | RLS em `payment_intents` por `store_id` + toda RPC/Edge Function com `WHERE store_id` explícito |
| Pagamento associado ao pedido/tenant errado | `external_reference`+`metadata.store_id` (dupla correlação, nunca uma só) |
| Cobrança duplicada | `X-Idempotency-Key` na criação (§7, ponto 1) |
| Race condition | `SELECT ... FOR UPDATE` no `payment_intent`/`order` durante transição de estado — mesmo padrão já provado 3x no projeto |
| Status forjado | Só o webhook validado (ou uma consulta direta à API do MP) pode escrever `payment_status`/promover `orders.status` — nenhuma RPC client-facing aceita esses campos como parâmetro |
| Refund indevido | Iniciar refund é ação **admin-gated** (`is_admin_of`, mesmo padrão de `admin_fechar_conta_mesa`) — nunca uma RPC callable por cliente/anon |

**Nenhuma dessas mitigações foi implementada nesta etapa** — é o desenho de defesa que a
implementação futura precisa seguir, documentado ANTES de qualquer código pra não ser uma
reflexão tardia.

## 12. Compliance — separado por natureza (pedido explicitamente)

**Requisito técnico** (fato de engenharia, não opinião):
- Manter o processamento de cartão (raw PAN/CVV) inteiramente fora do backend do Encanto —
  tokenização client-side via SDK do Mercado Pago (Payment Brick) é o mecanismo que garante isso.
- Nenhum dado de cartão em log, `application_logs`, ou `raw_payload` de `payment_intents` (só
  tokens/ids/status do Mercado Pago, nunca PAN).

**Risco/recomendação de compliance** (minha leitura técnica, não uma afirmação jurídica):
- Mesmo com tokenização client-side, recomenda-se validar com a documentação de compliance do
  próprio Mercado Pago (e/ou um profissional da área) qual nível de PCI DSS (provavelmente SAQ A ou
  A-EP) se aplica à integração final escolhida antes de produção real.
- Dados de pagamento (valor, status, id do Mercado Pago) associados a um pedido/cliente entram no
  mesmo regime de dados pessoais que `orders`/`customers` já têm hoje — nenhuma categoria NOVA de
  dado sensível é introduzida (não armazenamos número de cartão/CPF de pagamento) — a auditoria da
  REF-LGPD-01 (já fechada) não previu este domínio porque ele não existia; **vale uma revisão pontual
  quando a implementação avançar**, não uma reabertura completa daquela REF.

**Decisão jurídica/empresarial** (fora do meu alcance, não decidida aqui):
- Se a VALION precisa de termo de uso/política de privacidade atualizados mencionando o
  processamento de pagamento por terceiro (Mercado Pago).
- Se algum nível de certificação/avaliação formal de PCI DSS é exigido antes do go-live real —
  depende do volume/modelo final, decisão do dono com assessoria própria.

## 13. Estado do repositório nesta etapa (confirmado, não presumido)

```
git status --porcelain=v1
 M src/constants/privacyPolicy.js      <- outra sessão, intocado
?? scripts/loadtest-e2e.mjs            <- outra sessão, intocado
```
Nenhum arquivo de `REF-DELIVERY-FEE-05` foi tocado (commit `611b69f`, dela, permanece como estava).
Nenhuma migration, RPC, componente ou Edge Function foi criada ou alterada nesta etapa — só este
documento (mais o próprio commit desta doc, feito isoladamente, ver mensagem final).

## 14. Plano de ondas (proposto — nenhuma onda executada)

### Onda 1 — Fundação de schema (E2E apenas)
- **Objetivo**: criar `payment_intents` + `orders.payment_status` + capability
  `pagamento_online_habilitada` em `store_settings`.
- **Escopo**: migration aditiva pura, zero alteração de `create_order()`/`_resolve_delivery_fee()`.
- **Tabelas afetadas**: nova `payment_intents`; `orders` ganha 1 coluna nullable; `store_settings`
  ganha chaves novas (mesmo padrão de toda capability já existente).
- **Migration + rollback**: sim, obrigatório (padrão do projeto).
- **Testes**: RLS de `payment_intents` (isolamento cross-tenant), coluna nova não quebra nenhuma
  query/RPC existente (regressão completa de TODAS as suítes já existentes).
- **Critério de aceite**: zero regressão em qualquer suíte hoje verde; `payment_status` de todo
  pedido pré-existente continua `NULL`.
- **Riscos**: baixo (aditivo puro).
- **Dependências**: nenhuma.
- **Requer decisão humana**: nome final das colunas/tabela (proposto aqui é provisório), e
  confirmação de qual geração de API do Mercado Pago usar (clássica `/v1/payments` vs `Orders API`
  unificada — achado §5, a doc atual sugere a Orders API como o caminho mais novo, mas isso muda
  detalhes de payload/status que só se confirmam na implementação real).

### Onda 2 — RPC de criação de cobrança + Edge Function de integração (E2E apenas, sandbox MP)
- **Objetivo**: `payment_intents` sendo criado de verdade contra o AMBIENTE DE TESTE do Mercado
  Pago (nunca produção).
- **Escopo**: nova RPC client-facing (recebe só `order_id`), nova Edge Function (chama API do MP
  com credenciais de TESTE, lidas do Vault do projeto E2E).
- **Migration**: não (é código de RPC/Edge Function, não schema novo além da Onda 1).
- **Testes**: criação de cobrança Pix e cartão contra o sandbox oficial do Mercado Pago (usuários de
  teste, documentados oficialmente), idempotência (2 chamadas com a mesma `X-Idempotency-Key` não
  duplicam).
- **Critério de aceite**: cobrança de teste criada, `payment_intents` refletindo o `mp_payment_id`
  real do sandbox.
- **Riscos**: médio — 1ª integração real com API externa, latência/erros de rede precisam de
  tratamento (mesmo padrão de `try/catch` + log já usado em `create_order`).
- **Dependências**: Onda 1, decisão de credenciais de teste (o dono cria a aplicação no painel do
  Mercado Pago — fora do meu alcance).
- **Requer decisão humana**: confirmação de Checkout Pro vs Payment Brick (§1) antes de começar.

### Onda 3 — Webhook receiver (E2E apenas, sandbox MP)
- **Objetivo**: Edge Function que recebe, valida (`x-signature`), consulta a API, e atualiza
  `payment_intents`/`orders` com idempotência e lock.
- **Testes**: simulador oficial de webhooks do Mercado Pago (existe, achado na pesquisa — "Simulador
  de notificações Webhooks"); replay do mesmo evento (idempotência); webhook forjado sem assinatura
  válida (deve ser rejeitado, 401, zero escrita); pagamento de pedido/tenant cruzado (deve ser
  rejeitado); concorrência (2 webhooks quase simultâneos pro mesmo pagamento).
- **Critério de aceite**: todos os cenários de ataque do threat model (§11) cobertos por teste real,
  não suposição — mesmo rigor já usado na Onda 16 da REF-MESA-02.
- **Riscos**: alto se malfeito (é o ponto que decide "pagamento aprovado" de verdade) — por isso é a
  onda com MAIS peso de teste adversarial proposto.
- **Dependências**: Onda 2.
- **Requer decisão humana**: nenhuma nova, só validação de que os testes cobrem o threat model.

### Onda 4 — Frontend (Payment Brick OU redirect Checkout Pro, conforme §1)
- **Objetivo**: `CheckoutPage.jsx` ganha o novo método de pagamento; `SuccessPage.jsx` passa a
  aguardar confirmação (polling ou realtime do Supabase) em vez de assumir sucesso imediato como
  hoje faz pro WhatsApp.
- **Escopo**: novo componente de pagamento; COD continua 100% disponível e é o default (nunca
  removido nem escondido).
- **Testes**: E2E Playwright cobrindo o novo fluxo completo, regressão de TODO o checkout COD
  existente (garantir zero quebra do fluxo hoje 100% funcional).
- **Critério de aceite**: pedido pago online chega em `orders.status='recebido'` só depois da
  confirmação real do webhook — nunca antes.
- **Riscos**: médio — é a onda de maior mudança de UX visível ao cliente.
- **Dependências**: Ondas 1-3.
- **Requer decisão humana**: nenhuma nova além da já registrada em §1.

### Onda 5 — Regressão completa + documentação de fechamento
- **Objetivo**: rodar TODAS as suítes já existentes do projeto (mesmo padrão de disciplina da
  REF-MESA-02 Onda 17) + as novas desta REF, gerar relatório final.
- **Critério de aceite**: zero regressão em qualquer suíte pré-existente.
- **Dependências**: Ondas 1-4.

### Onda 6 — Piloto controlado (FORA do escopo de qualquer automação futura sem aprovação explícita)
- **Objetivo**: 1 loja, ambiente de PRODUÇÃO real, credenciais de produção reais, valor baixo,
  janela curta, monitorado de perto.
- **Esta onda NUNCA deve ser um efeito automático de terminar a Onda 5.** Rollout de produção é,
  por definição, decisão do dono — ver bloqueio explícito abaixo.

**Fase E2E/teste (Ondas 1-5) é claramente separada de PRODUÇÃO (Onda 6) — nenhuma onda anterior
avança pra produção sozinha.**

## 15. Critérios de aceite gerais (para a implementação completa, quando/se autorizada)

- COD continua funcionando 100% como hoje, é o default, nunca é removido nem obrigatório de trocar.
- Nenhum pedido é marcado `recebido`/pago sem webhook validado por assinatura (ou consulta direta à
  API confirmando).
- `_resolve_delivery_fee()`/tabela comercial continuam sendo a única fonte de taxa — a única mudança
  prevista ali é adicionar os 2 métodos online à lista que NUNCA aciona maquininha/adicional (§9),
  nada além disso.
- Zero regressão em qualquer suíte hoje verde (checkout.golden, deliveryFee.golden, comanda.golden,
  delivery-fee-04, money-scale-01, mesa-01/02, dashboard01, etc.).
- Threat model (§11) coberto por teste real antes de qualquer produção.

## 16. Rollback

- **Nesta etapa (arquitetura)**: nada a reverter — nenhum código/schema tocado, só este documento.
- **Onda 1 (schema)**: rollback padrão do projeto (migration aditiva pura — `DROP TABLE
  payment_intents`, `ALTER TABLE orders DROP COLUMN payment_status`, reverter chaves de
  `store_settings`) — mesmo rigor de sempre (testado apply→rollback→reapply antes de qualquer
  commit, disciplina de toda REF anterior).
- **Ondas 2-5 (RPC/Edge Function/frontend)**: reversível por natureza — nenhuma altera dado
  existente, só adiciona um caminho novo opt-in.
- **Onda 6 (piloto produção, se/quando autorizada)**: mecanismo de rollback de PRODUTO é o próprio
  COD permanecer sempre disponível — nunca uma migration "desligando" pagamento online precisa ser
  emergencial, é só apagar a capability (`pagamento_online_habilitada=false`) e a loja volta a se
  comportar exatamente como hoje.

## 17. Decisões ainda pendentes (lista consolidada — nada disto foi decidido aqui)

1. **Checkout Pro vs Payment Brick** (§1) — recomendação técnica dada (Payment Brick), decisão final
   é do dono.
2. **Geração de API do Mercado Pago** — `/v1/payments` (clássica) vs Orders API (mais nova,
   unificada) — a doc oficial atual empurra pra Orders API em vários pontos consultados, mas a
   escolha final e suas implicações de payload/status precisam ser confirmadas na Onda 2, não
   travadas aqui.
3. **Nomes finais de tabela/coluna** (`payment_intents`, `payment_status`, etc.) — provisórios,
   revisáveis na Onda 1.
4. **Se/quando avançar pra Split 1:1/marketplace** — schema já nasce compatível (§10), mas
   NENHUMA implementação de OAuth/onboarding de seller foi feita ou está proposta pra breve.
5. **Modelo de monetização da VALION sobre isso** — depende de REF-BILLING-01 (não iniciada).
6. **Política de expiração de pedido não pago** (§5) — quanto tempo um `aguardando_pagamento` fica
   "vivo" antes de considerar abandonado/cancelado — não definida aqui.
7. **Pagamento de Mesa** (§8) — se/quando avançar, precisa de decisão de produto sobre pagamento
   parcial vs conta completa, e um ajuste de schema (`mesa_session_id` como FK alternativo).
8. **Nível de avaliação PCI DSS/compliance formal** (§12) — decisão jurídica/empresarial do dono.
9. **Ambiente/credenciais de teste do Mercado Pago** — precisa que o dono crie a aplicação no painel
   oficial (fora do meu alcance) antes da Onda 2 poder começar de fato.

## Fontes consultadas (documentação oficial, pt-BR, `developers.mercadopago.com.br`)

- [Checkout Bricks — Introdução](https://www.mercadopago.com.br/developers/pt/docs/checkout-bricks/introduction)
- [Webhooks — Split Payments](https://www.mercadopago.com.br/developers/pt/docs/split-payments/additional-content/your-integrations/notifications/webhooks)
- [Split de Pagamentos 1:1 — Overview](https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/overview)
- [Integrar checkout em marketplace — Checkout Pro](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/how-tos/integrate-marketplace)
- [Transaction status — Orders API](https://www.mercadopago.com.ar/developers/en/docs/checkout-api-orders/payment-management/status/transaction-status)
- [Pix — Payment integration](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/payment-integration/pix.md)
- [Create refund — API Reference](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api-payments/create-refund/post)
- [Idempotency key usage will be mandatory](https://www.mercadopago.com.ar/developers/en/news/2023/01/04/Idempotency-key-usage-will-be-mandatory)
- [Credentials — Resources](https://www.mercadopago.com.co/developers/en/docs/credentials)
- [Simulador de notificações Webhooks e assinatura secreta](https://www.mercadopago.com.br/developers/pt/news/2024/01/11/Webhooks-Notifications-Simulator-and-Secret-Signature)

---

## GATE DE APROVAÇÃO

**Esta REF NÃO está concluída** — a descoberta (`459bd8c`) foi concluída; esta etapa deixa a
implementação futura tecnicamente especificada, não a executa. Nenhuma migration, RPC, componente
ou Edge Function de pagamento foi criada. Parando aqui conforme mandato — aguardando decisão do
dono sobre §17 antes de qualquer Onda 1 real.
