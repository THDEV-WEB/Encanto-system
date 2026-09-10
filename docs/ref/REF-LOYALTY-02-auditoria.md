# REF-LOYALTY-02 — AUDITORIA (recompensa, resgate e ciclo do Programa de Fidelidade)

**Status: AUDITORIA CONCLUÍDA. Nenhum código, migration, RPC ou dado de produção foi alterado.**

**Metodologia:** leitura de 100% do código-fonte relevante (migrations em ordem cronológica real via
`git log`, frontend, services, hooks, testes) + leitura da auditoria anterior
(`docs/ref/REF-LOYALTY-AUDIT-01-auditoria.md`, ENCERRADA). **Nenhuma consulta ao banco de produção foi
feita nesta sessão** — esta auditoria é 100% estática (código/migrations), mais restrita ainda do que
pedido na regra 13 (que permitiria leitura). Onde um valor "ao vivo" é citado (ex.: `discount=30`),
está explicitamente atribuído à REF-LOYALTY-AUDIT-01 (27/08+), não reverificado agora.

---

## 1. Estado atual do REF-LOYALTY-01

**FATO.** O programa nasceu em 13/07/2026 (REF-LOYALTY-01, commit `32bd362`) e passou por 3 rodadas de
evolução até hoje, todas fechadas/em produção:

1. **REF-LOYALTY-01** — fundação: fidelidade por `customers.id` no Supabase (não mais localStorage
   global por navegador), selo concedido dentro de `create_order`, reversão em cancelamento, RLS,
   `redeem_reward`/`admin_*`.
2. **REF-LOYALTY-01a** — hardening de `link_customer_to_auth` (impede um convidado com histórico ser
   reivindicado sem verificação — protege fidelidade/histórico contra roubo de conta).
3. **REF-SAAS-01 (Ondas 3/4.1/4.2)** — isolamento multi-tenant: `store_id` adicionado a
   `loyalty_accounts`/`loyalty_events`, RLS trocada de `is_admin()` para `is_admin_of(store_id)`.
4. **REF-LOYALTY-AUDIT-01 (Ondas 0-4 + 3 addendums, ENCERRADA)** — a config do programa
   (`enabled`/`required`/`discount`) migrou de `settings` (global) para `store_settings` (por loja);
   corrigida uma race condition real no Admin (2 saves concorrentes); corrigido um chip do storefront
   que nunca esteve conectado ao sistema real (`onLoyalty` sempre abria um teaser estático "em breve",
   mesmo com recompensa disponível); corrigido "50%" hardcoded em 3 lugares que ignoravam o `discount`
   real configurado.

**Conclusão herdada da auditoria anterior, reconfirmada por esta:** o **núcleo de contabilização**
(conceder, idempotência, reverter em cancelamento, isolar por cliente/loja) está correto, testado e
validado em produção. **O que aquela auditoria NÃO cobriu — e é o objeto desta REF-LOYALTY-02 — é o
que acontece DEPOIS de "recompensa disponível": como o desconto de fato chega a um pedido.** Essa
pergunta nunca foi feita nem respondida em nenhuma das ondas anteriores.

---

## 2. Arquivos envolvidos

**Frontend:**
- [src/services/loyalty/loyalty.js](src/services/loyalty/loyalty.js) — núcleo puro (normalização/derivação, sem I/O).
- [src/services/loyalty/loyaltyService.js](src/services/loyalty/loyaltyService.js) — chamadas RPC (cliente via `dbCliente`, admin via `db`).
- [src/services/loyalty/index.js](src/services/loyalty/index.js) — barrel.
- [src/hooks/useLoyalty.js](src/hooks/useLoyalty.js) — estado reativo do cliente logado.
- [src/pages/StoreApp.jsx](src/pages/StoreApp.jsx) — contador, banner de recompensa, modal de progresso/resgate, teaser (linhas ~380-770).
- `StoreHighlights.jsx` — chip "Programa Fidelidade" (renderizado por `StoreApp`).
- [src/components/menu/FidelidadeScreen.jsx](src/components/menu/FidelidadeScreen.jsx) — tela descritiva (regulamento) no menu ☰.
- [src/components/admin/AdminFidelidade.jsx](src/components/admin/AdminFidelidade.jsx) — painel admin (config + busca/ajuste/resgate por cliente).
- [src/components/checkout/CheckoutPage.jsx](src/components/checkout/CheckoutPage.jsx) — dispara `LOYALTY_EVENT` pós-pedido (linha 264); **não envia nem lê nada de fidelidade no payload do pedido**.
- [src/constants/storage.js](src/constants/storage.js) — `STORAGE_KEYS.LOYALTY_CACHE` (único uso de localStorage, é cache).

Falsos positivos do grep por "desconto" (não são de fidelidade): `comandaTexto.js` (desconto do
troco/ajuste de comanda) e `StickyBar.jsx` (comentário sobre offset de scroll, não sobre dinheiro).

**Backend (migrations, ordem cronológica real via `git log`):**
- `migrations/REF-LOYALTY-01-loyalty.sql` (13/07) — fundação: tabelas, RLS inicial, RPCs, trigger, `create_order` reaberto.
- `migrations/REF-LOYALTY-01a-link-hardening.sql` — hardening de vínculo customer↔auth.
- `migrations/REF-SAAS-01-onda0-schema.sql` + `onda3-identidade-cliente.sql` + `onda4-1-pedidos-fidelidade-escrita.sql` — `store_id` + RLS por loja.
- `migrations/REF-LOYALTY-AUDIT-01-onda1-config-por-loja.sql` — **define as 7 RPCs de fidelidade tal como existem HOJE** (config por `store_settings`).
- `migrations/REF-LOYALTY-AUDIT-01-fidelidade-texto-em-breve.sql` — texto institucional (`get_company_info`).
- `migrations/REF-MESA-02-onda6-abertura-implicita.sql` (05/09, a mais recente a tocar `create_order`) — **define `create_order` tal como existe HOJE**; carrega a chamada a `loyalty_grant` sem alteração.

**Testes:**
- `tests/loyalty.golden.mjs` (núcleo puro), `tests/loyalty.guard.mjs` (guarda estrutural "fonte única = Supabase").
- `scripts/loyalty-audit-01-onda1-test.mjs`, `scripts/saas01-onda4-2-fidelidade-test.mjs` (comportamental, contra produção, `BEGIN...ROLLBACK`).
- `e2e/tests/cliente/fidelidade.spec.js`, `e2e/tests/admin/admin-fidelidade.spec.js` (Playwright, projeto E2E dedicado).

**Documentação:** `docs/ref/REF-LOYALTY-AUDIT-01-auditoria.md` (ENCERRADA — auditoria + config por loja + UX).

---

## 3. Tabelas / RPCs / Functions

**Tabelas** (`migrations/REF-LOYALTY-01-loyalty.sql` + `store_id` acrescentado por REF-SAAS-01):

| Tabela | Colunas-chave | Papel |
|---|---|---|
| `loyalty_accounts` | `customer_id` (PK), `stamps`, `earned_total`, `rewards_redeemed`, `store_id`, `updated_at` | resumo 1 linha/cliente (progresso do ciclo atual) |
| `loyalty_events` | `id`, `customer_id`, `order_id` (nullable), `tipo` (`earned`\|`revoked`\|`redeemed`\|`adjustment`), `delta`, `stamps_after`, `origem`, `note`, `store_id`, `created_at` | ledger imutável |

Índice único parcial `loyalty_events_earned_order_uq` em `(order_id) WHERE tipo='earned'` — backstop
duro de idempotência (no máximo 1 `earned` por pedido).

**RPCs ativas hoje** (definições atuais em `migrations/REF-LOYALTY-AUDIT-01-onda1-config-por-loja.sql`
— nenhuma migration posterior as tocou):

| RPC | Quem chama | Faz o quê |
|---|---|---|
| `loyalty_grant(p_customer_id, p_order_id)` | só `create_order` (EXECUTE revogado de anon/authenticated) | concede 1 selo, cap em `required`, idempotente |
| `loyalty_void_on_cancel()` | trigger `AFTER UPDATE OF status ON orders` | reverte/restaura ao entrar/sair de `'cancelado'` |
| `get_my_loyalty(p_store_id)` | anon + authenticated (self) | leitura do próprio estado + config da loja |
| `redeem_reward(p_customer_id, p_store_id)` | authenticated (dono OU admin da loja do cliente) | consome 1 recompensa, `stamps -= required` |
| `admin_find_loyalty(p_query, p_store_id)` | authenticated, `is_admin_of` por dentro | busca cliente por telefone/nome |
| `admin_adjust_loyalty(p_customer_id, p_delta, p_note)` | authenticated, `is_admin_of` por dentro | ajuste manual de selo (sem cap) |
| `get_loyalty_config(p_store_id)` | anon + authenticated (pública) | lê `required`/`discount`/`enabled` da loja |
| `set_loyalty_config(p_required, p_discount, p_enabled, p_store_id)` | authenticated, `is_admin_of` por dentro | grava config da loja (`store_settings`) |

Todas `SECURITY DEFINER`. Config vive em `store_settings` (chave/valor por `store_id`), RLS trancada
sem nenhuma policy — só as RPCs `SECURITY DEFINER` acessam.

**`create_order`** (definição atual: `migrations/REF-MESA-02-onda6-abertura-implicita.sql:149-380`) —
função crítica/compartilhada com REF-MESA/REF-PRICE-SOURCE/REF-DELIVERY-FEE/REF-PAGAMENTO. Chama
`loyalty_grant` em sub-bloco best-effort, **depois** de inserir `orders`/`order_items`, **antes** de
retornar (linhas 356-360). Não lida com fidelidade além dessa única chamada.

---

## 4. Fluxo atual

```
checkout (CheckoutPage.jsx)
  → create_order(p_customer, p_order, p_items, p_request_id, p_store_id)
      [1 única transação atômica]
      → resolve store_id (JWT tenant_id OU resolve_store_from_origin)
      → valida mesa/canal, resolve preço de item via _resolve_item_pricing (server-side)
      → v_total = Σ(preço×qtd) + delivery_fee + maquininha_fee + adicional_pagamento_fee
        (ZERO conceito de desconto neste cálculo — nenhuma coluna de desconto em orders)
      → INSERT customers / orders / order_items
      → sub-bloco best-effort: perform loyalty_grant(customer_id, order_id)
      → retorna {ok:true, order_id}
  → CheckoutPage dispara window.dispatchEvent(LOYALTY_EVENT)
      [SÓ avisa a UI a re-buscar o estado — nenhum dado de fidelidade viajou no payload do pedido]
  → useLoyalty → sincronizar() → get_my_loyalty() → pinta o estado real do servidor
```

**Condição que credita o selo:** o pedido **existir** (INSERT em `orders` bem-sucedido) —
independente de status de pagamento. Não há checagem de aprovação/entrega.

**Caminho de resgate (hoje), totalmente separado do checkout:**

```
StoreApp.jsx (modal "Programa de Fidelidade", aberto fora do fluxo de checkout)
  → cliente vê "Você ganhou X% de desconto! [...] Informe ao atendente no momento
    da finalização do pedido." (texto literal, StoreApp.jsx:640-641)
  → clica "✅ Usar desconto agora" → redeem_reward() (RPC)
      → stamps -= required, rewards_redeemed += 1, insere evento 'redeemed' (order_id = NULL)
  → modal fecha. NADA mais acontece no sistema.
  → cliente faz um pedido NORMAL, sem desconto nenhum aplicado, e "informa ao atendente"
    por fora (WhatsApp/verbal) — o atendente aplica manualmente onde quer que cobre o pedido.
```

**FATO CONFIRMADO (evidência direta, não hipótese):** `redeem_reward` nunca recebe nem grava
`order_id`. O `INSERT INTO loyalty_events` do evento `'redeemed'`
(`REF-LOYALTY-AUDIT-01-onda1-config-por-loja.sql:245-247`) não inclui `order_id` — fica `NULL`. **Não
existe, em nenhum lugar do sistema, um mecanismo que ligue "esta recompensa resgatada" a "este pedido
específico"**, nem que subtraia qualquer valor de `orders.total`. O botão "Usar desconto agora" no
cliente e "✅ Resgatar recompensa" no Admin fazem exatamente a mesma coisa: debitam o ledger. A
aplicação real do desconto ao valor cobrado é **100% manual/humana**, fora do sistema.

---

## 5. Modelo atual de progresso

**FATO.** `stamps` (em `loyalty_accounts`) é a única fonte de progresso. Incrementado por
`loyalty_grant` (automático, 1 por pedido, cap em `required` — não acumula além) ou por
`admin_adjust_loyalty` (manual, **sem cap**, pode empurrar `stamps` acima de `required`). Revertido
por `loyalty_void_on_cancel` ao cancelar (soma a contribuição líquida real do pedido, não assume
"-1" fixo). Todo movimento é ledger em `loyalty_events`.

Não existe expiração de selo nem reset automático por tempo — só reset via resgate ou reversão por
cancelamento (confirmado por `docs/ref/REF-LOYALTY-AUDIT-01-auditoria.md §11`, coerente com a
ausência de qualquer job/cron de expiração no código lido).

---

## 6. Modelo atual de recompensa

**FATO.** Não existe uma **entidade "recompensa"** no banco — nenhuma tabela/linha representando "esta
recompensa específica, com este ID, neste estado". "Recompensa disponível" é **inteiramente
derivada em tempo real**: `reward_available = enabled AND stamps >= required` (calculado a cada
chamada de `get_my_loyalty`/`admin_find_loyalty`, nunca persistido). "Resgatar" é um único RPC que
debita o ledger — não existe um objeto que transite por estados (criado → elegível → resgatado); existe
apenas um contador e uma comparação.

**Isso significa:** os 3 estados que a REF-LOYALTY-02 pede para investigar (`IN_PROGRESS`,
`ELIGIBLE`, `REDEEMED`) **já são semanticamente cobertos hoje**, mas de forma **implícita/derivada**,
nunca como um registro com identidade própria:

| Estado pedido | Equivalente hoje | Persistido? |
|---|---|---|
| `IN_PROGRESS` | `stamps < required` | não (comparação em tempo real) |
| `ELIGIBLE` | `stamps >= required` (`reward_available`) | não (comparação em tempo real) |
| `REDEEMED` | evento `tipo='redeemed'` em `loyalty_events`, `stamps -= required` já aplicado | sim, mas **sem vínculo a nenhum pedido** (`order_id` sempre NULL neste tipo) |

---

## 7. Lacunas encontradas

1. **CRÍTICA — nenhuma aplicação automática do benefício.** Como detalhado no §4/§6: resgatar não
   aplica desconto a nenhum pedido. É a lacuna central que motivou esta REF.
2. **ALTA — desconto/resgate não é rastreável a um pedido.** `loyalty_events.order_id` fica `NULL`
   em todo evento `'redeemed'`. Impossível responder hoje, por consulta, "em qual pedido esta
   recompensa foi usada" (pedido explícito do §9 do enunciado).
3. **ALTA — inconsistência confirmada entre pagamento e fidelidade** (detalhe completo no §14):
   pagamento **recusado** ou **estornado** não reverte o selo concedido na criação do pedido.
4. **MÉDIA — texto exibido ao cliente contradiz o comportamento real do backend.**
   `StoreApp.jsx:756`: *"O pedido só contabiliza após ser aprovado ou finalizado pela loja."* — mas
   o selo é concedido na **criação** do pedido (`create_order`), antes de qualquer aprovação
   (confirmado também pela REF-LOYALTY-AUDIT-01 §4 como comportamento, só que sem notar esta
   contradição textual específica).
5. **BAIXA — texto "zerada" impreciso.** `StoreApp.jsx:758`: *"Após o resgate, a pontuação é
   zerada"* — o código faz `stamps -= required` (carryover), não zera. Diverge apenas no caso raro de
   `stamps > required` (possível só via `admin_adjust_loyalty`, que não tem cap).
6. **BAIXA — nenhum teste cobre o (não-)vínculo resgate↔pedido**, porque o vínculo não existe.
7. Lacunas já registradas e não resolvidas pela auditoria anterior (herdadas, não desta REF):
   isolamento explícito entre 2 clientes da mesma loja sem teste dedicado; reativação real fora de
   `BEGIN...ROLLBACK` nunca exercitada.

---

## 8. Riscos técnicos

- **Financeiro operacional (o mais sério):** como a "aplicação" é 100% manual, **não há nenhuma
  auditoria de que o desconto prometido foi de fato concedido, nem de quanto**. Um atendente pode
  esquecer de aplicar (cliente perde o benefício que já pagou com 10 pedidos) ou aplicar errado
  (percentual, base de cálculo) sem que o sistema perceba — porque o sistema não participa da
  aplicação.
- **Duplo uso por canal indireto:** como resgatar não trava nenhum pedido específico, nada impede um
  cliente resgatar e o atendente aplicar o desconto **duas vezes** em pedidos diferentes por engano
  (não é um bug de concorrência — é ausência de qualquer registro que o atendente possa conferir além
  de "o cliente disse que tem direito").
- **Selo sobrevive a pagamento recusado/estornado** — ver §14, é o achado técnico mais concreto desta
  auditoria.
- **Sem teto de desconto em R$:** `set_loyalty_config` valida só 1-100 (percentual). Não há conceito de
  valor máximo de desconto em reais nem de percentual sobre uma base específica — porque a aplicação
  em si não existe ainda.

---

## 9. Riscos de concorrência

**Núcleo atual (grant/void/redeem) já é seguro** — reconfirma REF-LOYALTY-AUDIT-01 §8: índice único
parcial (backstop duro) + checagem macia + `create_order` idempotente por `request_id` + `FOR UPDATE`
em `loyalty_accounts` dentro de `loyalty_grant`/`redeem_reward`. Nenhum problema de concorrência
encontrado no que já existe.

**Risco NOVO, específico da funcionalidade que esta REF quer construir** (hipótese de arquitetura, não
bug hoje — porque a funcionalidade não existe ainda): se "resgatar" e "aplicar no pedido" continuarem
sendo **2 chamadas separadas** (ex.: cliente clica "resgatar" numa tela, depois finaliza o checkout em
outra chamada), abre-se uma janela real de:
- **resgate consumido, pedido nunca criado** (cliente fecha o app no meio) → recompensa perdida sem
  nunca ter sido usada, sem forma de estornar;
- **2 abas/dispositivos resgatando quase ao mesmo tempo** → ambas passam pela checagem de
  elegibilidade antes de qualquer uma debitar, se a checagem e o débito não forem a mesma operação
  atômica (não é o caso do `redeem_reward` atual, que já é atômico em si — o risco é **entre** duas
  chamadas RPC diferentes, não dentro de uma).

**RECOMENDAÇÃO** (não implementada): se a aplicação do desconto for costurada a `create_order`, fazer
resgate + desconto + reset **dentro da MESMA transação/RPC** que cria o pedido (mesmo padrão que
`loyalty_grant` já usa hoje) elimina esta classe de risco por construção — não é preciso reinventar
mecanismo, é reaplicar o que o projeto já sabe fazer.

---

## 10. Riscos de segurança

**Nenhum risco novo de RLS/grants encontrado** — a superfície atual (grants explícitos por função,
RLS `is_admin_of(store_id)`, resolução de identidade sempre via `auth.uid()`, `EXECUTE` revogado de
`loyalty_grant`/`loyalty_void_on_cancel` para clientes) está correta e não muda com o escopo desta
auditoria, porque nada foi alterado.

**Risco que SURGIRÁ se a implementação futura não seguir o padrão já usado no projeto:** qualquer
RPC nova que aplique desconto a um pedido **precisa** recalcular elegibilidade/percentual no servidor
(nunca aceitar `discount`/`stamps`/`reward_id` vindo do frontend como verdade) — exatameante o mesmo
princípio que `_resolve_item_pricing`/`_resolve_delivery_fee` já aplicam dentro de `create_order` para
preço de item e taxa de entrega. **Recomendação: reaproveitar esse padrão, não inventar um novo.**

**Bypass do admin no kill switch** (achado antigo, não desta REF): `redeem_reward` ramo administrativo
e `admin_adjust_loyalty` não checam `enabled` — decisão explícita do dono, documentada na
REF-LOYALTY-AUDIT-01 Onda 1 (27/08). Não reaberta aqui.

---

## 11. Integração com checkout/pedidos

**FATO.** `CheckoutPage.jsx` não envia, nem lê, nada relacionado a fidelidade no payload de
`create_order` (confirmado por leitura completa do fluxo de submit, linhas ~168-306). O único ponto de
contato é o disparo do evento `LOYALTY_EVENT` **depois** que o pedido já foi criado, só para
re-sincronizar a UI.

`create_order` (§3/§4) calcula `v_total` inteiramente a partir de preço de item (server-resolved) +
3 taxas (entrega/maquininha/adicional) — **não existe nenhuma coluna de desconto em `orders`** e
nenhuma leitura de estado de fidelidade dentro da função.

**NÃO fui instruído a reescrever `create_order`, e não fiz isso.** Este item é só o mapeamento do
estado atual, para informar a decisão de arquitetura do §16.

---

## 12. Integração futura com PAYMENT-01

**FATO.** `create_payment_intent` (`migrations/REF-PAGAMENTO-01-onda3-criacao-cobranca.sql:75-100`) lê
o valor a cobrar diretamente de `orders.total` (`SELECT ... total INTO v_order`, depois
`INSERT INTO payment_intents (..., amount) VALUES (..., v_order.total)`). **Nenhuma menção a desconto
de fidelidade em nenhuma migration da REF-PAGAMENTO-01** (confirmado por grep).

**Ponto de integração real (não implementado, só identificado):** se o desconto de fidelidade reduzir
`orders.total` (ou um novo campo `orders.discount_amount`) **dentro da mesma transação de
`create_order`**, o Mercado Pago automaticamente cobraria o valor certo, porque
`create_payment_intent` já lê `orders.total` como fonte única — **nenhuma mudança seria necessária em
PAYMENT-01** para isso funcionar, desde que o desconto já esteja refletido em `orders.total` no
momento em que o pedido é criado. Essa é a razão arquitetural mais forte para resolver o desconto
**dentro de `create_order`**, não depois dele.

Confirmado: nenhuma mudança em PAYMENT-01 foi cogitada, proposta ou necessária nesta auditoria.

---

## 13. Regra 10ª vs 11ª compra

**FATO, não hipótese — a pergunta não tem a resposta que as 2 opções do enunciado pressupõem.** Hoje
**nenhuma das duas opções acontece**, porque **nenhum pedido jamais recebe desconto automaticamente**
(§4/§6). O que de fato ocorre:

- A 10ª compra (que atinge `stamps == required`) grava `earned_total`/`stamps=10` e passa a exibir
  `reward_available=true` — mas ela mesma **não recebe desconto nenhum** (é só a compra que faz o
  contador bater a meta).
- Qualquer compra posterior (11ª, 12ª, ou nenhuma) **também não recebe desconto automaticamente** —
  porque a aplicação do desconto não existe como mecanismo, só como instrução textual para o cliente
  "informar ao atendente".

**DECISÃO PENDENTE (não posso decidir por conta própria):** quando a aplicação automática for
construída, qual das opções abaixo o dono quer?

- **Opção A** — a compra que completa a meta NÃO leva desconto; a **próxima** compra leva.
- **Opção B** — a própria compra que completa a meta JÁ leva o desconto (calculado antes de somar a
  fidelidade, ou a fidelidade é concedida só se a compra NÃO usar desconto — mutuamente exclusivos
  dentro do mesmo pedido, evita "ganhar e gastar" no mesmo clique).
- **Opção C** (não estava no enunciado, mas é o que o texto atual do produto sugere, `StoreApp.jsx:640`
  — "informe ao atendente **no momento da finalização do pedido**"): o cliente decide **durante o
  checkout de um pedido futuro qualquer** (não precisa ser o imediatamente seguinte) se quer usar a
  recompensa disponível — modelo "saldo utilizável a qualquer momento", não "só na próxima compra".

A Opção C é a que mais se aproxima do comportamento **hoje**, mas hoje ela não é automática (é
manual). Qualquer uma das 3 é implementável com a arquitetura atual; nenhuma foi escolhida no código.

---

## 14. Regras de cancelamento/estorno

**FATO CONFIRMADO por leitura direta de código — o achado mais concreto desta auditoria.**

`loyalty_void_on_cancel` (trigger) só reage a `orders.status` mudando **de/para `'cancelado'`**
(`AFTER UPDATE OF status`). O ciclo de vida de pagamento online (REF-PAGAMENTO-01,
`_processar_webhook_payment_intent`, `migrations/REF-PAGAMENTO-01-onda2-webhook-fundacao.sql:187-210`)
trata 4 desfechos de pagamento, mas só **1 deles** toca `orders.status`:

| Desfecho do pagamento | O que acontece em `orders` | Reverte o selo? |
|---|---|---|
| `aprovado` | `status='recebido'` | (n/a — selo já tinha sido concedido na criação) |
| `expirado` (timeout 15min) | `status='cancelado'` | **SIM** — trigger dispara corretamente |
| `recusado` | **só `payment_status='recusado'`**, `status` **não muda** (permanece `'aguardando_pagamento'`) — comportamento **deliberado** ("permite nova tentativa com o MESMO order_id", comentário na linha 205-206 do arquivo) | **NÃO** |
| `estornado` / `em_contestacao` (chargeback pós-aprovação) | **nenhum branch trata isso** no `IF/ELSIF` — só `payment_intents.status` muda | **NÃO** |

**Consequência confirmada:** como `create_order` chama `loyalty_grant` **incondicionalmente**, na
criação do pedido — inclusive quando `status='aguardando_pagamento'` (pagamento online ainda não
confirmado) — **um pedido cujo pagamento é recusado (e nunca reenviado) ou estornado depois de
aprovado mantém o selo de fidelidade para sempre**, porque a única coisa que reverte selo
(`loyalty_void_on_cancel`) nunca é acionada nesses 2 casos.

Isso **não é um bug introduzido por má-fé nem por uma REF específica** — é uma lacuna de integração:
REF-PAGAMENTO-01 (focada em pagamento) preservou `status='aguardando_pagamento'` de propósito, para
permitir nova tentativa sem duplicar pedido; REF-LOYALTY-01/AUDIT-01 (focadas em fidelidade) nunca
foram re-auditadas depois que REF-PAGAMENTO-01 introduziu esses novos status. Cada REF, isoladamente,
está correta em seu próprio escopo — **a interseção nunca foi auditada até agora.**

**Perguntas obrigatórias do enunciado, respondidas:**

- *Uma compra cancelada conta para a meta?* **NÃO** (reversão funciona, confirmado por
  REF-LOYALTY-AUDIT-01 §9, prova real em produção).
- *Uma compra com pagamento recusado ou estornado conta para a meta?* **SIM, hoje conta — e não
  deveria, na leitura mais razoável do produto** (CONFIRMADO, não hipótese).
- *Uma recompensa usada em pedido depois cancelado deve voltar?* **DECISÃO PENDENTE** — não se aplica
  hoje porque resgate não está vinculado a nenhum pedido (§6), mas será uma pergunta real assim que a
  vinculação existir.
- *Como impedir inconsistência histórica?* Sem alteração de código: **nenhuma forma hoje.** Com a
  arquitetura futura: o mesmo padrão do trigger (reverter contribuição líquida) se generalizaria, desde
  que o gatilho de reversão passe a também observar os desfechos `recusado`/`estornado`, não só
  `status='cancelado'`.

**RECOMENDAÇÃO** (não implementada, decisão do dono se/quando autorizar): ou (a) o trigger de
fidelidade passa a também reverter quando `payment_status` chega em `'recusado'` (sem reversão
automática de `'estornado'` teria de decidir se o "revoked" é imediato ou após alguma janela de
contestação), ou (b) `loyalty_grant` deixa de ser chamado na criação e passa a ser chamado só quando o
pedido chega em `status='recebido'` de fato (mudança mais profunda, muda a regra de negócio "selo na
criação" documentada como INFORMATIVA/intencional pela auditoria anterior). **Marcado como DECISÃO
PENDENTE — não decidi por conta própria.**

---

## 15. Proposta de modelo de estados

**Não implementado — só avaliação, conforme pedido.**

**Resposta às 5 perguntas do enunciado:**

- **A) Como sabemos que o cliente atingiu a meta?** Hoje: `stamps >= required`, calculado em tempo
  real. **Não precisa de estado novo no banco** — continua sendo uma comparação, não um evento a
  persistir por si.
- **B) Como sabemos que existe uma recompensa disponível?** Mesma comparação (`reward_available`).
  **Também não precisa de coluna nova.**
- **C) Como sabemos que ela ainda não foi utilizada?** Hoje: implícito — `stamps` já foi decrementado
  quando é usada, então "disponível" e "não utilizada" são a mesma condição. **Isso só quebra quando
  quisermos que o resgate NÃO seja instantâneo** (ex.: reservar a recompensa para aplicar num pedido
  específico que ainda está sendo montado no carrinho) — aí sim precisaríamos de um estado
  intermediário.
- **D) Como sabemos que foi efetivamente utilizada?** Hoje: evento `tipo='redeemed'` no ledger — mas
  **sem saber em qual pedido** (§6/§7, lacuna #2). Se o objetivo é responder "usada EM QUAL PEDIDO",
  isso exige uma mudança mínima: `loyalty_events.order_id` passa a ser preenchido também para
  `'redeemed'` (a coluna já existe, é nullable, hoje só não é usada nesse tipo de evento).
- **E) Como o sistema inicia um novo ciclo?** Hoje: automaticamente, no mesmo instante do resgate
  (`stamps -= required`). **Já satisfaz o requisito central do enunciado** ("reset só no resgate
  efetivo, não na meta atingida") — não é uma lacuna, é um acerto já existente que vale reconhecer.

**Avaliação: precisa de estado explícito no banco, ou o mecanismo atual já é equivalente?**

- `IN_PROGRESS`/`ELIGIBLE` — **não precisam virar coluna/estado persistido.** São e continuam sendo
  derivações de `stamps` vs `required`. Introduzir uma tabela "rewards" com uma linha por
  ciclo/recompensa só se justificaria se o produto precisar de **histórico de recompensas como
  entidade** (ex.: "mostrar todas as recompensas já ganhas, com data de elegibilidade e data de
  resgate separadas") — hoje isso já é parcialmente respondido pelo ledger (`loyalty_events`), só
  falta a coluna `order_id` no evento `'redeemed'`.
- `REDEEMED` — **já existe como evento de ledger.** O que falta não é o estado em si, é o **vínculo**
  com o pedido em que foi usado (lacuna #2, §7) — e, se o produto quiser suportar "reservar antes de
  finalizar o pedido" (em vez de resgate instantâneo), aí sim seria necessário um estado intermediário
  novo (`RESERVADO`/`PENDENTE_DE_APLICACAO`, com expiração), que **não existe hoje**.

**DECISÃO PENDENTE:** o modelo de resgate deve continuar **instantâneo e atômico** (resgatar já
consome, e a aplicação ao pedido acontece na mesma operação que cria o pedido — recomendado, ver §16),
ou deve existir uma etapa de **reserva** (resgatar reserva o desconto por um tempo, aplicável a
qualquer pedido futuro dentro de uma janela)? A primeira opção é estruturalmente mais simples e mais
segura contra concorrência (§9); a segunda dá mais flexibilidade de UX mas reabre os riscos do §9
(recompensa reservada e nunca usada, ou usada em duplicidade entre reserva e novo resgate).

---

## 16. Proposta de fluxo

```
compra (create_order)
  → progresso (loyalty_grant, JÁ EXISTE, intocado)
  → meta (stamps >= required, JÁ EXISTE, é comparação, não evento)
  → elegibilidade (reward_available, JÁ EXISTE, get_my_loyalty/admin_find_loyalty)
  → recompensa (HOJE: nenhuma entidade própria — é a mesma comparação acima)
  → resgate (redeem_reward, JÁ EXISTE, mas HOJE desconectado de qualquer pedido)
  → desconto (NÃO EXISTE — lacuna central desta REF)
  → reset (JÁ EXISTE, acontece junto do resgate, `stamps -= required`)
  → novo ciclo (JÁ EXISTE, é só o `stamps` residual continuando a contar)
```

**Proposta de arquitetura (recomendação, NÃO implementada, para avaliação do dono):**

Resolver a lacuna central (desconto/resgate/reset) **dentro da mesma transação de `create_order`**,
seguindo o padrão que o próprio projeto já usa para preço de item (`_resolve_item_pricing`) e taxa de
entrega (`_resolve_delivery_fee`) — nunca confiar em valor vindo do frontend, sempre recalcular
server-side dentro da mesma transação atômica:

1. `create_order` ganha um parâmetro opcional (ex.: `p_usar_recompensa_fidelidade boolean default
   false`) — o frontend só **manifesta a intenção** do cliente ("quero usar meu desconto neste
   pedido"), nunca informa o percentual nem confirma elegibilidade (isso é recalculado no servidor).
2. Dentro da transação, **depois** de resolver `v_store_id` e **antes** de gravar `orders`: se
   `p_usar_recompensa_fidelidade`, relê `stamps`/`required`/`discount`/`enabled` da loja **com `FOR
   UPDATE`** (mesmo lock que `redeem_reward` já usa hoje) e confirma elegibilidade real — se não
   elegível, ou o programa está desativado, o pedido segue **sem** desconto (fail-closed, nunca
   assume o que o frontend pediu).
3. Se elegível: aplica o desconto sobre a base decidida (§4, DECISÃO PENDENTE) ao `v_total`, grava o
   valor do desconto em `orders` (nova coluna, ex. `desconto_fidelidade`), e — na MESMA transação —
   debita `stamps -= required` e grava o evento `'redeemed'` **com `order_id = v_order_id`** (fecha a
   lacuna #2 do §7).
4. Se qualquer parte da transação falhar, tudo é revertido junto (mesma garantia que já existe hoje
   para pedido+itens) — elimina o risco do §9 ("resgatei e não finalizei o pedido") por construção.

Isso reaproveita: `FOR UPDATE` (já usado por `redeem_reward`), transação única (já usada por
`create_order`), validação server-side (já usada por `_resolve_item_pricing`/`_resolve_delivery_fee`).
**Nenhuma arquitetura nova precisa ser inventada** — é o mesmo padrão já validado 2x no projeto,
aplicado a uma 3ª fonte de valor que compõe o total do pedido.

**Isto é uma proposta para avaliação, não uma decisão tomada.** Pontos que dependem de decisão do
dono antes de qualquer implementação: §13 (10ª vs 11ª/quando o desconto pode ser usado), §4 (base de
cálculo do percentual), §14 (o que fazer com pagamento recusado/estornado).

---

## 17. Matriz de testes proposta

Cobertura **hoje** (herdada, reconfirmada, não desta REF): grant/idempotência/cap/cancelamento/
reversão/isolamento por cliente-loja — todos com teste real (`tests/loyalty.*`,
`scripts/loyalty-audit-01-onda1-test.mjs`, `e2e/tests/*/fidelidade*.spec.js`,
`e2e/tests/*/admin-fidelidade.spec.js`). Não repetido aqui.

Matriz **nova**, exigida pelo enunciado, para quando a aplicação automática for implementada (nenhum
destes existe hoje, porque a funcionalidade não existe):

| # | Cenário | Por quê importa |
|---|---|---|
| 1 | Cliente abaixo da meta não vê opção de usar desconto | fail-closed básico |
| 2 | Cliente atingindo a meta exatamente no pedido N | define comportamento da Opção A/B/C (§13) |
| 3 | Cliente elegível, escolhe usar → pedido reflete o desconto correto | caminho feliz |
| 4 | Percentual aplicado bate com o configurado pela loja (não hardcoded) | já houve bug real disso (Addendum 1 da auditoria anterior) |
| 5 | Recompensa usada 1 vez → 2ª tentativa no mesmo pedido/requisição é bloqueada | idempotência |
| 6 | Tentar reusar a mesma recompensa em um 2º pedido depois de já usada | double-redeem |
| 7 | Reset ocorre só no resgate efetivo, nunca só por atingir a meta | requisito central do enunciado |
| 8 | Novo ciclo conta corretamente após reset (`stamps` residual, se houver) | carryover, não zero absoluto |
| 9 | 2 pedidos/requisições concorrentes tentando usar a mesma recompensa | concorrência (§9) |
| 10 | Percentual configurado pela loja é respeitado (não fixo) | regressão do Addendum 1 |
| 11 | Percentual inválido (fora de 1-100) é rejeitado | já validado hoje em `set_loyalty_config`, reconfirmar |
| 12 | Pedido cancelado após usar desconto — o que acontece com a recompensa? | depende da DECISÃO PENDENTE do §14 |
| 13 | Pedido com pagamento recusado — hoje NÃO reverte o selo (achado §14) | regressão a corrigir OU aceitar como está, mas com teste que documenta a decisão |
| 14 | Cliente B tentando usar a recompensa do cliente A | segurança, mesmo padrão de `redeem_reward` hoje |
| 15 | Frontend enviando um percentual/valor de desconto manipulado | servidor deve ignorar e recalcular (§10) |
| 16 | Regressão do REF-LOYALTY-01 (grant/idempotência/cancelamento) | não quebrar o que já funciona |
| 17 | Regressão geral (`test:domain`, E2E completo) | mesmo gate de qualidade já usado em toda REF anterior |

---

## 18. Dependências

- **`create_order`** — função crítica/compartilhada com REF-MESA-01/02, REF-PRICE-SOURCE-01,
  REF-DELIVERY-FEE-01/04/05, REF-PAGAMENTO-01, REF-ORDER-TENANT-01. Qualquer mudança precisa ser
  compatível com todas.
- **REF-PAGAMENTO-01** — acoplamento real e já confirmado (não hipotético) via `orders.status`/
  `orders.total` (§12/§14). Bloqueada por credencial do Mercado Pago (memória do projeto), mas o
  código de pagamento já em produção já interage com fidelidade hoje (§14) independente disso.
- **REF-MESA-01/02** — pedidos de mesa passam pelo mesmo `create_order`/`loyalty_grant`, sem tratamento
  especial. Uma "conta" de mesa dividida em vários pedidos concede 1 selo por pedido — não avaliado a
  fundo nesta auditoria (fora do escopo explícito, "não misturar as REFs"), mas registrado como
  ponto a observar se a Onda de implementação tocar o cálculo de elegibilidade por "visita" em vez de
  "pedido".
- **REF-SAAS-01 / multi-tenant** — toda a config e todo o núcleo já são por loja; qualquer coisa nova
  deve seguir o mesmo padrão (`is_admin_of(p_store_id)`, `store_settings`), não reintroduzir global.

---

## 19. Decisões pendentes

Consolidando todas as marcadas ao longo do relatório:

1. **§4 — base de cálculo do desconto**: só produtos (excluindo `delivery_fee`/`maquininha_fee`/
   `adicional_pagamento_fee`) ou sobre o total cheio? O texto atual do regulamento já separa
   "produtos" de "frete" para fins de contagem de progresso — sugere (não decide) que o desconto
   também deveria incidir só sobre produtos.
2. **§4 — teto de desconto em R$**: deve existir, além do percentual (1-100 já validado)?
3. **§4 — interação com maquininha/adicional de pagamento**: o desconto reduz esses valores também,
   ou só o subtotal de produtos?
4. **§13 — Opção A, B ou C**: quando exatamente o cliente pode usar a recompensa (a própria compra que
   completa a meta, a próxima, ou qualquer compra futura enquanto elegível)?
5. **§14 — pagamento recusado/estornado**: o selo deve ser revertido nesses 2 casos (hoje não é)?
6. **§15 — resgate instantâneo vs. reserva**: a aplicação deve acontecer atomicamente dentro de
   `create_order` (recomendado, §16) ou deve existir uma etapa de reserva prévia?
7. **§14 — se um pedido com desconto aplicado for cancelado depois**: a recompensa consumida deve
   "voltar" para o cliente usar de novo?

Nenhuma destas foi decidida nesta auditoria — todas exigem decisão de produto do dono antes de
qualquer implementação.

---

## 20. Plano de implementação por ondas (proposto, não iniciado)

Só entra em vigor **após aprovação explícita** e com as decisões do §19 resolvidas (pelo menos as
#1/#4/#5/#6, que mudam a forma da migration).

- **Onda 0 (esta REF)** — auditoria. **CONCLUÍDA.**
- **Onda 1 (proposta)** — vincular resgate a pedido: `redeem_reward` (ou uma nova função que o
  substitua no fluxo de checkout) passa a gravar `order_id` no evento `'redeemed'`. Menor mudança
  possível que já fecha a lacuna #2 do §7, **sem** ainda automatizar a aplicação do desconto — só dá
  rastreabilidade ao que já existe.
- **Onda 2 (proposta, depende das decisões #1/#4/#6 do §19)** — `create_order` ganha o parâmetro
  opcional de uso de recompensa (§16), recalcula elegibilidade/percentual server-side, aplica ao
  total, debita o ledger na mesma transação. Maior mudança, em função crítica — exige o mesmo rigor já
  usado em toda REF anterior deste projeto (auditoria → migration → teste estrutural e comportamental
  incluindo concorrência → validação contra produção real, só leitura, antes de aplicar → aplicação →
  commit → documentação).
- **Onda 3 (proposta, depende da decisão #5)** — fechar a lacuna de pagamento recusado/estornado
  (§14): estender o gatilho de reversão para reagir a `payment_status`, não só `status='cancelado'`.
- **Onda 4 (opcional)** — matriz de testes do §17 completa, incluindo os cenários de concorrência e
  manipulação de frontend.

---

## Gate final

Auditoria concluída. Nenhuma alteração foi feita em código, migration, RPC, RLS, configuração ou dado
real. Nenhum commit, nenhum push, nenhuma consulta ao banco de produção foi realizada nesta sessão.
Aguardando avaliação e decisão explícita do dono sobre as pendências do §19 antes de qualquer
implementação.
