# REF-PAYMENT-SEC-01 — AUDITORIA DE SEGURANÇA (Pagamentos)

**Status: AUDITORIA — nada foi alterado, commitado, enviado ou aplicado em produção.** Toda evidência
abaixo vem de leitura direta do código-fonte real (`pg_get_functiondef` contra o banco de PRODUÇÃO,
`information_schema`/`pg_policies`/`pg_class` para RLS e grants, leitura dos arquivos `.ts`/`.jsx` reais)
e de testes **read-only** (SELECT dentro de `BEGIN...ROLLBACK`, simulando roles/JWT reais via
`SET LOCAL role` + `request.jwt.claims`, exatamente como o PostgREST faz). Nenhum INSERT/UPDATE/DELETE/
DDL foi executado. Data: 2026-09-10.

**Nota sobre "código real" vs migrations**: várias migrations recentes (ex.: `REF-LOYALTY-02-onda2-
integracao-pedido.sql`, aplicada só em E2E) ainda não estão em produção. Todo achado abaixo foi
verificado contra o `pg_get_functiondef`/`pg_policies` **live de produção**, nunca assumido a partir de
arquivos de migration — quando um achado depende dessa distinção, isso é dito explicitamente.

---

## 1. Executive Summary

A área de pagamentos do ENCANTO (Mercado Pago via Payment Brick, `payment_intents`, webhook HMAC,
`create_order` como fonte única de verdade financeira) está **bem desenhada no núcleo autoritativo**:
total do pedido, taxa de entrega, taxa de maquininha e valor cobrado no Mercado Pago são **100%
recalculados no servidor** em todos os pontos testados — nenhum caminho encontrado permite que o
cliente pague menos do que deve (amount tampering, seção 6, não comprovado como explorável em nenhum
ponto verificado).

O achado de maior severidade confirmado é um problema **já conhecido e documentado por uma auditoria
anterior (REF-LOYALTY-02)**, aqui reproduzido com prova de código nova e mais precisa: o selo de
fidelidade é concedido na **criação** do pedido, não na confirmação do pagamento, e não é revertido
quando um pagamento online é **recusado** (só quando expira ou é cancelado) — abre uma via de "obter
recompensa sem ter direito" (seção 7/38, severidade HIGH).

Um segundo achado, também já corrigido nesta mesma sessão (não é mais um risco ativo, mas registrado
por completude): o `MP_WEBHOOK_SECRET` de produção esteve configurado com o mesmo valor do
`MP_ACCESS_TOKEN` durante boa parte do piloto de hoje, fazendo TODO webhook real do Mercado Pago ser
rejeitado (401) antes de tocar no banco — nenhum pagamento online se confirmava sozinho. Já corrigido e
validado com 2 Pix reais end-to-end antes desta auditoria começar.

Nenhuma credencial real foi vista, vazada ou exposta em código/bundle/histórico do Git nas checagens
feitas. `payment_intents` é `deny-all` por RLS pra qualquer client role. As RPCs internas de webhook
(`_processar_webhook_payment_intent`, `_registrar_criacao_pagamento`, `_webhook_mercadopago_recebido`)
só são executáveis por `service_role`/`postgres`.

## 2. Escopo

Todo o caminho de pagamento do ENCANTO: checkout (frontend), `create_order`, `_resolve_delivery_fee`,
`iniciar_pagamento_pedido`, Edge Functions `mp-criar-cobranca`/`mp-webhook`, `payment_intents`, máquina
de estados, RLS/grants de todas as tabelas tocadas, fidelidade (REF-LOYALTY-01/02) como superfície de
"benefício financeiro obtido sem pagar", e mesa/divisão de conta (REF-MESA-01/02) como segunda fonte de
autoridade financeira no mesmo banco. Fora do escopo desta rodada (não auditado a fundo por tempo, ver
seção "Não comprovado"): testes de concorrência REAIS (só revisão de código dos locks), Vercel/CI/CD,
GitHub Actions secrets.

## 3. Arquitetura auditada (confirmada no código real, não no que a documentação histórica descreve)

- `create_order(p_customer, p_order, p_items, p_request_id, p_store_id)` — `SECURITY DEFINER`,
  `search_path` fixado, é o ÚNICO ponto de escrita em `orders`/`order_items` no fluxo de storefront.
  Resolve tenant via `auth.jwt()->>'tenant_id'` (cliente logado) ou `resolve_store_from_origin()`
  (guest). Recalcula preço de item via `_resolve_item_pricing` (nunca lê `price`/`preco_unitario` do
  client para o total), recalcula `delivery_fee`/`maquininha_fee`/`adicional_pagamento_fee` via
  `_resolve_delivery_fee`, e **rejeita** (não corrige silenciosamente) qualquer valor declarado pelo
  client que não bata com o autoritativo.
- `iniciar_pagamento_pedido(p_order_id, p_store_id)` — cria/reaproveita um `payment_intents` com
  `amount = orders.total` (lido do banco, nunca do client).
- `mp-criar-cobranca` (Edge Function) — único lugar que fala com `/v1/payments` do Mercado Pago.
  `transaction_amount` vem de `payment_intents.amount` (service_role, RLS bypassada por design — leitura
  segura porque é sempre o PRÓPRIO dado gravado por `iniciar_pagamento_pedido`, nunca o corpo da
  requisição).
- `mp-webhook` (Edge Function) — valida `x-signature` (HMAC) ANTES de qualquer leitura no banco, refaz
  GET `/v1/payments/{id}` pra pegar o status REAL (nunca confia no body do webhook), delega pra
  `_processar_webhook_payment_intent` (máquina de estados).
- `_transicao_payment_status_valida` — máquina de estados fechada em SQL puro (`IN`, lista fixa de
  pares válidos).
- Fidelidade (`loyalty_grant`/`loyalty_void_on_cancel`) e Mesa (`admin_dividir_conta_mesa`/
  `admin_fechar_conta_mesa`/`mesa_session_payment_allocations`) são autoridades financeiras SEPARADAS
  que também tocam `orders`/pagamento — auditadas juntas por estarem no mesmo raio de risco.

## 4. Threat Model (resumido — só atores com achado real ou relevante)

| Ator | Objetivo | Superfície | Achado |
|---|---|---|---|
| A2 — cliente autenticado malicioso | Farmar selo de fidelidade sem pagar | `create_order` (guest ou logado) | **HIGH confirmado** (seção 7) |
| A3 — não autenticado (guest) | Iniciar pagamento de pedido alheio | `iniciar_pagamento_pedido` | **MEDIUM confirmado** (seção 9) |
| A4/A7 — atacante externo | Forjar/repetir webhook | `mp-webhook` | Verificado seguro (seção 12) — mas achado histórico real desta sessão (secret trocado) registrado |
| A6 — manipula requests | Alterar amount/total/fee | `create_order`, `mp-criar-cobranca` | Verificado seguro (seção 6) |
| A9 — atravessa tenant | Ler pedido/config de outra loja | RLS de `orders`/`store_settings`/views | Verificado seguro (seção 18) — grants largos demais, mas RLS barra |
| A10 — admin comprometido/malicioso | Marcar pedido como pago sem pagamento real | RLS `orders` (`Admin all orders`, ALL) | **MEDIUM, arquitetural** (seção 10) |

## 5. Trust Boundaries

```
CLIENTE (browser) ──não confiável──> FRONTEND (React) ──não confiável──> SUPABASE (PostgREST/RPC)
  │ trust boundary 1: JWT anon/authenticated + RLS + SECURITY DEFINER com validação própria dentro
  ↓
DATABASE (create_order, _resolve_delivery_fee, _resolve_item_pricing) ── AUTORIDADE FINANCEIRA REAL
  │ trust boundary 2: payment_intents.amount só é gravado aqui, nunca no client
  ↓
EDGE FUNCTION mp-criar-cobranca ── relê amount do banco (service_role), NUNCA do body
  │ trust boundary 3: MP_ACCESS_TOKEN só existe aqui
  ↓
MERCADO PAGO ── processa o pagamento real
  │ trust boundary 4: webhook chega de fora, x-signature validada ANTES de tocar o banco
  ↓
mp-webhook ── refaz GET /v1/payments/{id} (nunca confia no body do webhook)
  │ trust boundary 5: _processar_webhook_payment_intent, SECURITY DEFINER, só service_role chama
  ↓
DATABASE (orders.status/payment_status) ── único lugar que marca um pedido como pago de verdade
```
Cada fronteira tem uma checagem própria (não confia na anterior "porque já validou lá atrás") —
padrão de defesa em profundidade consistente em todo o caminho principal.

## 6. Autoridade financeira / Amount tampering — VERIFICADO SEGURO

**Prova**: `create_order` (linhas do corpo lido de produção, ver seção 3) — `v_total` é somado
EXCLUSIVAMENTE de `v_items_resolved` (preço vindo de `_resolve_item_pricing`, por `product_id`, nunca
do client) + `v_delivery_fee`/`v_maquininha_fee`/`v_adicional_pagamento_fee` (de `_resolve_delivery_fee`).
`p_order->>'total'` só é lido para dentro de `v_log` (log de diagnóstico), **nunca** atribuído a
`v_total`. Testado e confirmado nesta mesma sessão contra produção (teste "16. total mentiroso" da
REF-DELIVERY-FEE-04, rodado hoje): payload declara `total: 1.00`, servidor grava `20.00` — client
nunca controla o total.

`mp-criar-cobranca`: `transaction_amount: Number(pi.amount)` — `pi` vem de
`serviceClient.from('payment_intents').select(...).eq('id', paymentIntentId)`, nunca do `body` da
requisição HTTP (que só contém `payment_intent_id`/`token`/`payment_method_id`/`issuer_id`/
`installments`/`payer`, nenhum campo de valor).

**Resposta à seção 47 (C): Existe possibilidade de alterar amount? NÃO, em nenhum ponto verificado.**

## 7. Discount/loyalty abuse — CONFIRMADO, HIGH

**Fato**: `create_order` chama `perform public.loyalty_grant(v_customer_id, v_order_id);`
incondicionalmente, logo após inserir `orders`/`order_items` — **antes de qualquer confirmação de
pagamento**, para QUALQUER `payment_method` (online ou físico) e QUALQUER `v_status` inicial
(`'aguardando_pagamento'` para online, `'recebido'` para físico).

**Cadeia de evidência**:
1. `loyalty_grant`: idempotente por pedido (`loyalty_events WHERE order_id=... AND tipo='earned'`), mas
   não checa `orders.status` nem `payment_status` — só existência do pedido.
2. `loyalty_void_on_cancel` (trigger em `orders`): só reverte o selo quando `status` transiciona **PARA**
   `'cancelado'`.
3. `_processar_webhook_payment_intent`, branch `p_novo_status = 'recusado'`:
   `UPDATE orders SET payment_status = 'recusado' WHERE id = v_pi.order_id;` — **nunca** muda
   `orders.status`. O pedido continua `'aguardando_pagamento'` (por design, permite nova tentativa) —
   mas isso significa que o trigger de reversão **nunca dispara** para um pagamento online recusado.
4. `_expirar_payment_intents_pendentes()` (cron, 15min) SIM muda `status` para `'cancelado'` — então um
   pagamento que fica pendente e nunca é retomado eventualmente reverte o selo. Mas um pagamento
   **explicitamente recusado** (cartão de teste `OTHE`/recusa imediata) fica com o selo creditado por
   até 15 minutos, ou indefinidamente se o cliente nunca mais tocar naquele pedido e o cron falhar/não
   rodar.
5. Para métodos **físicos** (dinheiro/PIX na entrega/cartão na entrega), `v_status` já nasce
   `'recebido'` — o selo é concedido instantaneamente na criação, sem qualquer verificação de que o
   valor foi de fato recebido (modelo de confiança tradicional de COD, mas sem barreira alguma contra
   um script criando pedidos guest fake).

**Ataque plausível**: guest cria N pedidos (telefone real ou reaproveitado — `loyalty_grant` idempotente
só por `order_id`, não por telefone) com `payment_method='dinheiro'`, nunca entregues/pagos de verdade.
Cada pedido concede 1 selo (até o teto `loyalty_required`, default 10). `create_order` só tem
`_rate_limit_hit('create_order', 60, interval '10 minutes')` (por IP, ver REF-SEC-02) — **60 pedidos em
10 minutos é suficiente para lotar a cartela de fidelidade padrão (10 selos) várias vezes**, sem
autenticação, sem pagamento real, sem qualquer verificação de posse do telefone usado.

**Mitigação existente**: resgate da recompensa (REF-LOYALTY-02, já documentado como "100% desconectado
de pedido") exige ação MANUAL do admin (`admin_find_loyalty` + aplicação manual do desconto) — não há
caminho de auto-resgate remoto/automatizado. Isso reduz o dano de "roubo direto de dinheiro" mas não
elimina "obter recompensa sem ter direito" (o cliente pode se apresentar fisicamente e reivindicar um
desconto que não fez jus).

**Severidade: HIGH** (attacker goal #2, confirmado por código; explorabilidade real limitada pela etapa
manual de resgate, por isso não CRITICAL). **Recomendação (não implementada nesta auditoria)**: conceder
o selo só quando `payment_status IN ('aprovado', NULL com payment_method físico E status enviado por
admin como recebido de fato)`, ou popular `loyalty_grant` a partir de `_processar_webhook_payment_intent`
(status aprovado) em vez de `create_order`, com fallback explícito pra métodos físicos gated por alguma
confirmação (ex.: só ao marcar pedido como "entregue", se esse status existir).

## 8. Delivery Fee — VERIFICADO SEGURO (nenhuma alteração à regra comercial, só auditoria)

Já coberto por REF-DELIVERY-FEE-04/05 (testado extensivamente nesta mesma sessão): `_resolve_delivery_fee`
é `SECURITY DEFINER` mas sem `EXECUTE` para `anon`/`authenticated` (só acessível via `create_order`,
que já valida store/endereço/distância 100% a partir de dados já persistidos no banco — o client nunca
envia coordenada, distância ou faixa, só `payment_method`/`endereco_id`/`retirada`). `create_order`
rejeita (não aceita silenciosamente) qualquer `delivery_fee`/`maquininha_fee`/`adicional_pagamento_fee`
declarado pelo client que não bata com o valor recalculado. Bounding box (`v_raio_bbox_km`) e distância
via `delivery_route_cache`/Haversine, ambos derivados só de coordenadas já gravadas — cliente não pode
inflar/deflacionar a taxa manipulando distância porque a distância nunca vem do client.

## 9. Payment Intents — `iniciar_pagamento_pedido` sem checagem de posse — CONFIRMADO, MEDIUM

**Fato**: `iniciar_pagamento_pedido(p_order_id, p_store_id)` — `SECURITY DEFINER`, grantado para
`anon` E `authenticated` — busca `orders WHERE id = p_order_id AND store_id = p_store_id FOR UPDATE`
**sem nenhuma checagem de `auth.uid()`/ownership do pedido**. Qualquer chamador que soubesse (ou
adivinhasse) um `order_id` + seu `store_id` corretos poderia:
- criar/reaproveitar um `payment_intent` para um pedido que **não é seu**;
- ver o `amount` (valor) desse pedido alheio na resposta.

**Impacto real**: não permite fraude financeira direta (o atacante só consegue **pagar** o pedido de
outra pessoa, não roubar nem alterar valor) — mas viola o princípio de posse (o pedido não é dele) e
vaza o valor do pedido. `order_id` é UUID v4 (não sequencial, não enumerável por brute-force realista),
mas a auditoria não aceita "UUID é difícil de adivinhar" como barreira suficiente — e não há NENHUMA
outra barreira aqui além do UUID. Vetor de exposição de `order_id` a terceiros (compartilhamento
acidental de link, admin compartilhando print, etc.) não foi mapeado nesta rodada.

**Severidade: MEDIUM.** **Recomendação**: adicionar checagem de posse quando `auth.uid()` não é nulo
(mesmo padrão já usado em `create_order` para `endereco_id`), ou pelo menos confirmar telefone/nome do
pedido como segundo fator antes de permitir iniciar pagamento.

## 10. State Machine

Tabela de transições reais (`_transicao_payment_status_valida`, fonte única):

| De | Para | Permitido? |
|---|---|---|
| pendente | aprovado | ✅ |
| pendente | recusado | ✅ |
| pendente | expirado | ✅ |
| aprovado | em_contestacao | ✅ |
| aprovado | estornado | ✅ |
| em_contestacao | estornado | ✅ |
| em_contestacao | aprovado | ✅ |
| **expirado** | **aprovado** | **❌ (achado, ver abaixo)** |
| qualquer outra | qualquer outra | ❌ (fechada por padrão — `IN` explícito, sem fallback permissivo) |

Máquina é **fechada** (nenhum wildcard, nenhum "else permite") — boa propriedade de design.

**Achado confirmado com incidente REAL desta sessão**: pedido `a9c06490...` — Pix aprovado pelo
Mercado Pago (dinheiro creditado, confirmado pelo dono na própria conta MP) **depois** que
`_expirar_payment_intents_pendentes()` já tinha marcado o `payment_intent` como `'expirado'` (rodou
antes do fix do `MP_WEBHOOK_SECRET` chegar a tempo). Quando o webhook real da aprovação chegasse (MP
pode reenviar), `_transicao_payment_status_valida('expirado', 'aprovado')` retornaria `false`, e
`_processar_webhook_payment_intent` recusaria aplicar — pagamento aprovado fica **permanentemente**
sem refletir no pedido, sem alerta automático. Não é uma falha de segurança explorável por um atacante
(não dá vantagem a ninguém), é uma falha de **consistência financeira operacional**: dinheiro recebido,
pedido não reflete.

**Severidade: MEDIUM (não é vulnerabilidade de segurança clássica, é gap de reconciliação).**
**Recomendação**: permitir `('expirado', 'aprovado')` como transição válida (reabre o pedido), ou no
mínimo gerar um alerta/log de alta visibilidade quando isso ocorrer (hoje: `_processar_webhook_payment_
intent` simplesmente retorna `ok:false` sem qualquer notificação além do log padrão).

## 11-12. Webhook Security / Replay — VERIFICADO SEGURO (hoje) + achado histórico

**Assinatura**: `_validar_assinatura_webhook_mp` — HMAC-SHA256 sobre o manifest EXATO documentado pelo
MP (`id:{data.id};request-id:{x-request-id};ts:{timestamp};`), comparação com `v1` do header
`x-signature`. Janela de frescor: `ts` entre `now()-10min` e `now()+2min` (defesa adicional, não exigida
pela doc do MP). Reimplementada em TS (`mp-webhook/index.ts`) e SQL (`_validar_assinatura_webhook_mp`) —
comentário no código diz que as duas foram testadas par-a-par (`_webhook_mercadopago_recebido` REVALIDA
a assinatura mesmo depois da validação em TS — defesa em profundidade deliberada).

**Body do webhook nunca é autoridade**: confirmado — `mp-webhook/index.ts` refaz
`GET /v1/payments/{dataId}` com o `MP_ACCESS_TOKEN` e usa `mpJson.status`/`status_detail` **daquela
resposta**, nunca do corpo da notificação recebida. **Resposta à seção 47 (D): Existe possibilidade de
falsificar aprovação via body do webhook? NÃO — o body do webhook não carrega status nenhum que seja
usado; o status vem sempre de uma consulta própria à API real.**

**Replay**: não há tabela de deduplicação por `event_id`, mas a proteção efetiva vem da máquina de
estados: `_processar_webhook_payment_intent` faz `IF v_pi.status = p_novo_status THEN RETURN
idempotente:true` **antes** de qualquer `UPDATE` — reprocessar o mesmo evento (ou reenviar
manualmente) nunca reexecuta o efeito colateral (nunca credita 2x). **Resposta (E): Existe replay
explorável financeiramente? NÃO comprovado como explorável — idempotência por estado, não por
event-id, mas fecha o mesmo risco.**

**Achado histórico (já corrigido, registrado por completude)**: `MP_WEBHOOK_SECRET` de produção esteve
configurado com o MESMO valor de `MP_ACCESS_TOKEN` durante a maior parte do piloto de hoje (descoberto
comparando hashes do `supabase secrets list`, nunca o valor em si) — toda notificação real do Mercado
Pago era rejeitada (401, assinatura inválida) antes de tocar no banco. Corrigido e validado com 2
pagamentos Pix reais depois da correção (ver `docs/ref/REF-PAGAMENTO-01-checkpoint.md`, Onda 8, item
"c" para o relato completo). Durante a janela em que esteve quebrado, o sistema **falhava fechado**
(nenhum pagamento era aprovado automaticamente, não havia risco de aprovação indevida) — o modo de
falha foi seguro, só não funcional.

## 13. Double Spend / concorrência — NÃO COMPROVADO POR TESTE DIRETO (revisão de código: defesas presentes)

Não executei um teste de concorrência real (2 requisições simultâneas) por escopo de tempo desta
rodada. Por revisão de código: `_processar_webhook_payment_intent`, `iniciar_pagamento_pedido`,
`admin_dividir_conta_mesa`, `admin_fechar_conta_mesa`, `_get_or_open_mesa_session` todos usam
`SELECT ... FOR UPDATE` antes de decidir/gravar — padrão correto para serializar contra race condition
no mesmo pedido/sessão. `mp-criar-cobranca` usa `X-Idempotency-Key` (persistida no `payment_intent`,
nunca gerada de novo em retry) — 2 chamadas simultâneas para o MESMO `payment_intent_id` deveriam
resultar no MESMO `mp_payment_id` (garantia da própria API do Mercado Pago desde 2024, exigida pelo
comentário no código). **Marcado como NÃO COMPROVADO por teste direto — defesas de código presentes e
corretas por inspeção, recomendo teste de concorrência real numa rodada futura antes de declarar
fechado.**

## 14. Idempotência (create_order) — VERIFICADO SEGURO

`create_order`: se `p_request_id` já existe em `orders.request_id`, retorna o pedido existente
(`idempotent:true`) sem reprocessar — checado ANTES até do rate limit. Também tratado no `EXCEPTION WHEN
unique_violation` (race entre o SELECT inicial e o INSERT concorrente cai no mesmo caminho idempotente).
Testado exaustivamente pelos scripts desta e de sessões anteriores (idempotência com mesmo request_id
após sucesso → 1 pedido só, confirmado hoje em `delivery-fee-04-onda2-test.mjs` caso 15).

## 15-16. Authentication / Authorization

`auth.uid()`/`auth.jwt()->>'tenant_id'` nunca confiados do client (vêm do JWT assinado pelo Supabase
Auth, não de payload arbitrário). `create_order` valida `v_tenant <> p_store_id → erro` quando o JWT
tem `tenant_id` — impede um cliente logado na Loja A de criar pedido "como se fosse" da Loja B mesmo
que tente passar `p_store_id` diferente. Matriz de operação × role (verificada nos GRANTs reais):

| Operação | anon | authenticated | admin (is_admin_of) | service_role |
|---|---|---|---|---|
| `create_order` | ✅ (guest) | ✅ | — | — |
| `iniciar_pagamento_pedido` | ✅ **(sem checar posse, seção 9)** | ✅ **(idem)** | — | — |
| `consultar_status_pagamento` | ✅ | ✅ | — | — |
| `_processar_webhook_payment_intent` | ❌ | ❌ | ❌ | ✅ |
| `_registrar_criacao_pagamento` | ❌ | ❌ | ❌ | ✅ |
| `set_pagamento_config`/`set_loyalty_config` | ❌ (bloqueado dentro da função) | ❌ (idem) | ✅ | ✅ |
| `admin_orders_search` | ✅ (grant existe) mas `RAISE EXCEPTION` se `!is_admin_of` dentro | ✅ (idem) | ✅ | ✅ |
| `reconcile_orders` | ❌ | ❌ | ❌ | ✅ |
| `loyalty_accounts` (tabela, direto) | ❌ (RLS: 0 policy p/ anon) | SELECT só própria conta; escrita só admin | ALL | ALL (bypassa RLS) |
| `payment_intents` (tabela, direto) | ❌ (RLS: 0 policy) | ❌ (idem) | ❌ (idem) | ALL (bypassa RLS) |
| `orders` (tabela, direto) | ❌ (RLS: 0 policy p/ anon) | SELECT só próprios pedidos | **ALL (ver seção 10/A10)** | ALL |

`admin_orders_search`/`admin_order_endereco` têm `GRANT EXECUTE` para `PUBLIC`/`anon`/`authenticated`
mas fazem `RAISE EXCEPTION ... USING ERRCODE='42501'` internamente se `NOT is_admin_of(p_store_id)` —
padrão correto (grant amplo + gate de autorização DENTRO da função, não delega só pro RLS/grant). Um
não-admin chamando essas RPCs recebe erro, não dado.

## 17-18. Multi-Tenant Isolation / RLS

Policies revisadas em `orders`, `order_items`, `customers`, `addresses`, `loyalty_events`,
`loyalty_accounts`, `application_logs`, `notification_outbox`, `store_settings`, `payment_intents`:
todas as policies de cliente comum usam `customer_id IN (SELECT c.id FROM customers c WHERE
c.auth_user_id = auth.uid() AND c.store_id = <tabela>.store_id)` — escopo correto por identidade real
(nunca por campo enviável pelo client). Policies de admin usam `is_admin_of(store_id)` (SECURITY
DEFINER, verifica `admins` de verdade, não um claim solto). `payment_intents` e `store_settings` têm
RLS **habilitado com ZERO policies** — deny-all confirmado empiricamente (testado como `authenticated`
genérico, 0 linhas). **IDOR/BOLA testado diretamente**: troquei `order_id`/identidade em `orders` e na
view `v_order_reconciliation` usando um cliente real com 12 pedidos reais — em ambos os casos, exatamente
12 linhas retornadas (nunca as 13 totais do banco inteiro) — **RLS propaga corretamente através da view,
apesar de grants excessivos** (ver seção 22, achado de hardening).

## 19-20. SECURITY DEFINER / RPC

Todas as funções `SECURITY DEFINER` revisadas (`create_order`, `_resolve_delivery_fee`,
`iniciar_pagamento_pedido`, `consultar_status_pagamento`, `get_my_loyalty`, `get_pagamento_config`,
`set_pagamento_config`, `set_loyalty_config`, `_processar_webhook_payment_intent`,
`_webhook_mercadopago_recebido`, `_registrar_criacao_pagamento`, `is_admin_of`, `is_admin_anywhere`,
`resolve_store_from_origin`, `admin_*`) têm `SET search_path TO 'pg_catalog', 'public'` fixado —
protege contra object shadowing/search_path hijacking. Nenhum SQL dinâmico (`EXECUTE`/`format(...)`
usado como comando, só como string de log/mensagem) encontrado nas funções financeiras — sem vetor de
SQL injection nelas.

**Achado MEDIUM já coberto na seção 10 (A10)**: `orders` tem policy `Admin all orders` (`cmd=ALL`,
`is_admin_of(store_id)`) — um admin (legítimo, da própria loja) pode fazer `UPDATE orders SET
payment_status='aprovado', status='recebido' WHERE ...` **diretamente via REST**, contornando 100% da
máquina de estados/webhook/verificação real do Mercado Pago. Não é escalação de privilégio (o admin já
é admin daquela loja, por definição já tem controle operacional amplo), mas é uma lacuna de integridade:
não existe CHECK/trigger que exija um `payment_intents` aprovado correspondente antes de `orders.
payment_status` virar `'aprovado'`. Relevante especificamente para o ator A10 do threat model
("operador/admin comprometido"): se uma sessão de admin for sequestrada (XSS, token roubado, etc.), o
atacante pode marcar qualquer pedido daquela loja como "pago" sem nenhum pagamento real ter ocorrido —
afeta a integridade dos relatórios financeiros da própria loja, não rouba dinheiro de terceiros.

## 21. Edge Functions

`mp-criar-cobranca`: rate limit em memória (10/min por IP, `Map` local ao isolate — limite nominal, não
garantido sob múltiplos isolates da borda, ver seção 31), CORS `Access-Control-Allow-Origin: *`,
`verify_jwt: true` (gateway Supabase exige JWT/apikey válido antes de a função rodar — barra scanners
genéricos sem a anon key, que é pública por design mesmo assim). `mp-webhook`: `verify_jwt: false`
(correto — o Mercado Pago não manda JWT do Supabase, a autenticidade vem 100% da assinatura HMAC
própria) — validação de assinatura é a ÚNICA linha de defesa antes de tocar o banco, e ela é robusta
(seção 11). Nenhuma das duas aceita `store_id`/`amount` do body como autoritativo.

## 22. Secrets

Grep no working tree (padrões de `APP_USR-`, `service_role...eyJ`, `sk_live`, etc.) — **0 ocorrências
reais** (o único hit em `git log -S"APP_USR-"` foi a própria regex de validação em
`set_pagamento_config`, não um valor real). `.env.example`/`.env.e2e.example` contêm só placeholders.
Bundle `dist/` (buildado nesta mesma sessão, hoje) — grep por `service_role`/`MP_ACCESS_TOKEN`/
`MP_WEBHOOK_SECRET` — **0 ocorrências**. `supabase secrets list` mostra apenas hashes SHA-256 (nunca o
valor real) — usados nesta sessão só pra comparar e detectar o achado da seção 11/12, nunca pra ler o
segredo em si.

## 23-24. Git History / Frontend Bundle

Coberto na seção 22 — nenhum segredo real encontrado no histórico ou no bundle. `VITE_SUPABASE_KEY`
(anon/publishable) e `VITE_SENTRY_DSN`/`VITE_MAPBOX_TOKEN` são públicos por design (documentado no
próprio `.env.example`) — não são segredos de servidor.

## 25. Logs

`application_logs` grava `raw_payload` (resposta crua do Mercado Pago, inclui e-mail do pagador quando
fornecido) — mas a tabela é `SELECT`-restrita a `is_admin_of(store_id)` (RLS), nunca pública. Não
encontrei log de token/Authorization header/PAN de cartão/CVV em nenhuma das funções financeiras
revisadas — `mp-criar-cobranca`/`mp-webhook` só logam mensagens de erro genéricas via `console.error`
(vão pro runtime log da Edge Function, não pra `application_logs`).

## 26. PCI / Dados de cartão

`mp-criar-cobranca` só recebe `token` (tokenização feita no NAVEGADOR pelo SDK do Mercado Pago, usando
a Public Key — nunca PAN/CVV chegam à Edge Function). Nenhum campo de número de cartão/CVV/validade
encontrado em nenhuma tabela (`payment_intents.raw_payload` guarda a resposta da API, que o Mercado Pago
já retorna mascarada/tokenizada por padrão da própria API deles). **Não declaro conformidade PCI
completa** (não é o objetivo desta auditoria) — só confirmo que a arquitetura evita armazenar/transmitir
dados brutos de cartão pelos nossos servidores, pelo desenho observado.

## 27-28. PII / IDOR

`admin_order_endereco`/`admin_orders_search` expõem PII (endereço, nome, telefone) mas são gated por
`is_admin_of(p_store_id)` com `RAISE EXCEPTION` — não-admin recebe erro, não dado (testável, não testado
nesta rodada por tempo — marcado **não comprovado por execução direta**, mas o código faz a checagem
ANTES de qualquer SELECT, então a inspeção de código dá alta confiança). IDOR em `order_id`/
`payment_intent_id` coberto nas seções 9 (achado real) e 18 (view, verificado seguro).

## 29. Error Handling

`create_order` devolve `sqlerrm`/`sqlstate` crus pro client em caso de erro (`RAISE EXCEPTION`
capturado no bloco `EXCEPTION WHEN others`). Isso inclui mensagens como `'item "%" sem produto
valido'` — não vaza schema/stack trace do Postgres, só a mensagem de validação de negócio (mensagens
são escritas à mão no próprio código, nunca `sqlerrm` de um erro interno inesperado é composto com dado
sensível). `mp-criar-cobranca` devolve `mpJson?.message` (mensagem de erro do Mercado Pago) pro client —
aceitável, é a mesma mensagem que o MP já mostraria no seu próprio checkout.

## 30-32. CORS/CSRF, Rate Limiting, Enumeration

CORS `*` nas Edge Functions financeiras — ver seção 21 (INFO, não CRITICAL, sem uso de cookie/sessão).
CSRF: não aplicável da forma clássica — autenticação é via Bearer JWT/apikey (não cookie), então não há
superfície CSRF tradicional nesses endpoints. Rate limiting: presente em `create_order` (60/10min),
`iniciar_pagamento_pedido` (30/10min), `consultar_status_pagamento` (120/10min),
`resolver_mesa_por_token` (60/10min), `mp-criar-cobranca` (10/min, in-memory) — nenhuma rota financeira
sem throttle algum, mas os limites (especialmente `create_order` 60/10min) são o vetor habilitante do
achado da seção 7. Enumeration: `order_id`/`payment_intent_id`/`customer_id` são UUID v4 — não
sequenciais, não enumeráveis por iteração simples; risco real está em posse (seção 9), não em
enumeração por força bruta.

## 33. Cancelamento/Estorno

`_transicao_payment_status_valida` permite `aprovado→estornado`/`em_contestacao→estornado` — mas não
encontrei nenhuma RPC/trigger que efetivamente CHAME essas transições a partir de um estorno real do
Mercado Pago (o webhook mapeia `approved`/`rejected`/`cancelled`/`pending`/`in_process`/`authorized`,
mas não há mapeamento explícito pra `refunded`/`charged_back`/`in_mediation` em `mapearStatusMp` —
caem no `default: 'pendente'`, nunca em `'estornado'`/`'em_contestacao'`). **Achado: estorno/chargeback
real do Mercado Pago provavelmente não reflete corretamente no `payment_intents.status`** (ficaria
`'pendente'` em vez de `'estornado'`), e por consequência **`loyalty_void_on_cancel` também não seria
acionado para um estorno** (só reage a `orders.status='cancelado'`, que nada aqui dispara para
estorno). Isso bate diretamente com o attacker goal #38 ("estorno → benefício permanece") — **HIGH,
não comprovado por teste real com evento de estorno (não tenho como simular um chargeback real do MP
nesta auditoria), mas comprovado por leitura de código: o mapeamento de status simplesmente não cobre
esses dois valores.**

## 34. TOCTOU

`_calcular_total_sessao_mesa` é chamada 2x em `admin_dividir_conta_mesa` (uma vez pra validar soma,
implícito) e de novo em `admin_fechar_conta_mesa` — mas ambas rodam sob `FOR UPDATE` da sessão, e o
total é `STABLE` mas recalculado a cada chamada (nunca cacheado) — não vi janela TOCTOU real aqui.

## 35. Database Constraints

`audit-constraints.json` (34 constraints coletadas) confirma PKs/FKs padrão em `payment_intents`/
`orders`/`order_items` mas **nenhum CHECK `amount >= 0`/`total >= 0` explícito encontrado nas tabelas
financeiras centrais** (a proteção contra valor negativo/zero está só em `create_order`:
`if v_total <= 0 then raise exception`, aplicação, não banco) — recomendo `CHECK (total >= 0)` e
`CHECK (amount > 0)` como defesa em profundidade (hoje dependem 100% da lógica de aplicação nunca
falhar).

## 36-37. Trust Boundaries / Attack Paths

Trust boundaries: seção 5. Attack paths construídos com achado real:

1. **Farming de selo de fidelidade** (seção 7): guest → `create_order` (dinheiro, guest) × N → selo
   creditado sem pagamento real → resgate manual em loja física. Pré-condição: nenhuma. Defesa: resgate
   manual (reduz mas não elimina). **HIGH**.
2. **Pagar pedido alheio / vazar valor** (seção 9): atacante descobre `order_id`+`store_id` de outro
   cliente → `iniciar_pagamento_pedido` → vê `amount`, pode pagar em nome de outro. Pré-condição:
   conhecer/vazar um `order_id` real. **MEDIUM**.
3. **Estorno não reverte fidelidade** (seção 33): cliente paga online, ganha selo, contesta/estorna no
   Mercado Pago → `payment_intents.status` não reflete `estornado` corretamente → selo nunca revertido.
   Pré-condição: capacidade de estornar um pagamento real (custo real pro atacante, mas troca dinheiro
   estornado por selo mantido). **HIGH**.
4. **Admin comprometido marca pedido como pago** (seção 10/20): sessão de admin sequestrada → `UPDATE
   orders SET payment_status='aprovado'` direto via REST → relatórios financeiros da loja mentem.
   Pré-condição: comprometer uma sessão de admin (barra alta). **MEDIUM**.
5. **Webhook forjado/repetido**: bloqueado — assinatura HMAC + revalidação dupla + idempotência por
   estado. **Não explorável, verificado**.
6. **Amount tampering direto**: bloqueado — total/amount sempre recalculados server-side em todos os
   pontos verificados. **Não explorável, verificado**.
7. **Cross-tenant via view de reconciliação**: hipótese testada e refutada — RLS propaga corretamente.
   **Não explorável, verificado com prova direta**.
8. **SQL injection em RPC financeira**: nenhum SQL dinâmico usado como comando nas funções revisadas.
   **Não explorável, verificado por leitura**.
9. **Double-spend por concorrência**: defesas de código presentes (`FOR UPDATE` + idempotency-key), não
   testado ao vivo. **Não comprovado**.
10. **Vazamento de segredo em bundle/git**: nenhum encontrado. **Não explorável, verificado**.

## 38-40. Severidade / Matriz Final

| ID | Severidade | Área | Achado | Explorável? | Status |
|---|---|---|---|---|---|
| PAY-SEC-001 | **HIGH** | Fidelidade | Selo concedido na criação do pedido, não revertido em pagamento recusado | Sim, com barreira de resgate manual | Não corrigido |
| PAY-SEC-002 | **HIGH** | Fidelidade/Estorno | Mapeamento de status do webhook não cobre `refunded`/`charged_back` → selo sobrevive a estorno | Provável, não testado com evento real | Não corrigido |
| PAY-SEC-003 | **MEDIUM** | Payment Intents | `iniciar_pagamento_pedido` sem checagem de posse do pedido | Sim, vaza `amount` + permite pagar pedido alheio | Não corrigido |
| PAY-SEC-004 | **MEDIUM** | State Machine | `expirado → aprovado` não é transição válida — pagamento aprovado tarde fica órfão | Não é ataque, é gap operacional (já ocorreu de verdade hoje) | Não corrigido |
| PAY-SEC-005 | **MEDIUM** | RLS/Autorização | Admin pode gravar `payment_status='aprovado'` direto via REST, sem payment_intent real | Requer já ser/comprometer um admin daquela loja | Não corrigido, arquitetural |
| PAY-SEC-006 | LOW | Constraints | Sem `CHECK (total>=0)`/`CHECK(amount>0)` no banco (só na aplicação) | Não explorável hoje (app sempre valida) | Hardening |
| PAY-SEC-007 | LOW | Grants | `payment_intents`/`store_settings`/`loyalty_accounts` com GRANT amplo pra anon/authenticated, salvos só pela ausência/estreiteza de policy | Não explorável hoje (RLS cobre) | Hardening |
| PAY-SEC-008 | INFO | Edge Functions | Rate limit em memória, não distribuído entre isolates | Abuso limitado, não financeiro | Hardening |
| PAY-SEC-009 | INFO | CORS | `Access-Control-Allow-Origin: *` nas Edge Functions de pagamento | Baixo risco (sem sessão via cookie) | Hardening |
| — | Corrigido nesta sessão | Webhook | `MP_WEBHOOK_SECRET` = `MP_ACCESS_TOKEN` (mesmo valor) | Sim, mas já corrigido e validado antes desta auditoria | Fechado |

## 41. Score de Postura

| Dimensão | Nota | Justificativa |
|---|---|---|
| Autoridade financeira | **ROBUSTO** | Total/amount/fee 100% recalculados server-side em todo ponto verificado |
| Authentication | ADEQUADO | JWT real, `auth.uid()`/tenant nunca confiados do client |
| Authorization | ADEQUADO | Gates dentro das funções (não só RLS/grant); 1 gap real (seção 9) |
| Tenant isolation | ADEQUADO | RLS consistente; grants largos demais mas neutralizados |
| Webhook | ROBUSTO | HMAC + revalidação dupla + refetch da API real |
| Idempotency | ROBUSTO | `request_id`/`idempotency_key` cobrindo os pontos certos |
| Anti-replay | ADEQUADO | Por estado, não por event-id, mas efetivo |
| Anti-fraud (fidelidade) | **FRÁGIL** | Seções 7/33 — 2 achados HIGH reais |
| RLS | ADEQUADO | Consistente onde existe; 2 tabelas dependem só de "zero policy" |
| RPC | ADEQUADO | `search_path` fixo, sem SQL dinâmico, gates internos |
| Edge Functions | ADEQUADO | CORS/rate-limit fracos mas não financeiramente exploráveis |
| Secrets | ROBUSTO | Nada encontrado em código/bundle/histórico |
| PCI exposure | ADEQUADO | Tokenização no navegador, sem PAN/CVV no servidor |
| PII exposure | ADEQUADO | Gated por `is_admin_of` nos pontos revisados |
| Logging | ADEQUADO | Sem segredo/PAN em log; acesso restrito a admin |
| State machine | ATENÇÃO | Fechada e correta, mas falta `expirado→aprovado` e estorno |
| Concurrency | **ATENÇÃO (não comprovado)** | Defesas de código presentes, sem teste ao vivo |

## 42. Prioridade de correção

- **P0** (antes de mais uso real com dinheiro, dado que já está em piloto real): PAY-SEC-001 e
  PAY-SEC-002 (fidelidade sobrevivendo a recusa/estorno) — é o achado com caminho de exploração mais
  direto e já documentado como conhecido desde REF-LOYALTY-02.
- **P1**: PAY-SEC-003 (posse em `iniciar_pagamento_pedido`), PAY-SEC-004 (transição
  `expirado→aprovado`, já causou 1 incidente real hoje).
- **P2**: PAY-SEC-005 (admin write direto), PAY-SEC-006/007 (constraints/grants, defesa em
  profundidade).
- **P3**: PAY-SEC-008/009 (rate limit distribuído, CORS restritivo).

## 43. Regressão arquitetural

Nenhuma recomendação acima propõe reescrever `create_order()`, trocar a máquina de estados por outra
coisa, ou mexer em REF-DELIVERY-FEE-05/REF-MESA-01/02 além do já documentado. Onde `create_order()`
aparece (seção 7, 9), é porque ELE é o único lugar que chama `loyalty_grant`/resolve posse de
`endereco_id` — qualquer fix precisa passar por ele por construção, não por escolha de reescrita.

## 44-45. Produção / Git

Nenhum INSERT/UPDATE/DELETE/DDL executado em produção. Nenhum commit, push, rebase, cherry-pick ou
alteração de histórico feito. Todas as consultas usadas `pg_get_functiondef`/`information_schema`/
`pg_policies`/`pg_class` (leitura de catálogo) ou `SELECT` dentro de `BEGIN...ROLLBACK`.

## 46. (este documento)

## 47. Veredito Final

| # | Pergunta | Resposta | Evidência |
|---|---|---|---|
| A | Existe fraude financeira explorável? | **NÃO COMPROVADO diretamente, mas SIM para "obter benefício sem pagar" via fidelidade** | Seções 7, 33 |
| B | Existe bypass de pagamento? | NÃO (pra completar um PEDIDO como pago sem pagar) — mas SIM pra "ganhar selo" sem pagar | Seção 7 |
| C | Existe possibilidade de alterar amount? | **NÃO** | Seção 6 |
| D | Existe possibilidade de falsificar aprovação? | **NÃO** | Seção 11 |
| E | Existe replay? | NÃO explorável (idempotência por estado) | Seção 12 |
| F | Existe double spend? | NÃO COMPROVADO (defesas de código presentes, sem teste ao vivo) | Seção 13 |
| G | Existe cross-tenant? | **NÃO** (testado diretamente, inclusive a view suspeita) | Seções 17-18 |
| H | Existe vazamento de segredo? | **NÃO** | Seção 22-24 |
| I | Existe exposição de dados de cartão? | NÃO (tokenização no navegador) | Seção 26 |
| J | Existe exposição de PII? | NÃO COMPROVADO explorável (gates presentes, não testados ao vivo) | Seção 27-28 |
| K | Existe falha de RLS? | **NÃO** nos pontos testados (grants largos demais, mas RLS cobre) | Seções 17-18 |
| L | Existe RPC privilegiada explorável? | **SIM** — `iniciar_pagamento_pedido` sem checagem de posse | Seção 9 |
| M | Existe Edge Function exposta indevidamente? | NÃO (CORS/rate-limit fracos, não financeiramente explorável) | Seção 21 |
| N | Existe risco de race condition? | NÃO COMPROVADO (defesas presentes, sem teste ao vivo) | Seção 13 |
| O | Existe inconsistência MP ↔ payment_intents ↔ orders? | **SIM** — `expirado→aprovado` e estorno/chargeback | Seções 10, 33 |
| P | Existe risco relacionado à Fidelidade? | **SIM, o achado mais sério desta auditoria** | Seção 7, 33 |
| Q | Existe risco relacionado a Delivery Fee? | NÃO | Seção 8 |
| R | Existe risco relacionado a cancelamento/estorno? | **SIM** — estorno não reflete corretamente | Seção 33 |

## 48. Gate final

**Nada foi implementado, corrigido, commitado, enviado ou deployado nesta auditoria.** Este documento
foi criado (arquivo novo) mas não adicionado ao Git nem commitado — fica como arquivo local até
autorização explícita para uma próxima frente de correção.
