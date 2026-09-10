# REF-PAYMENT-SEC-02 — HARDENING PÓS-AUDITORIA (Pagamentos/Fidelidade)

**Status: 6 ondas de correção (0-6) CONCLUÍDAS, testadas, commitadas, pushadas e APLICADAS EM
PRODUÇÃO (2026-09-10)** — migrations + Edge Functions (`mp-webhook`, `mp-criar-cobranca`) deployadas
e validadas por introspecção direta do banco real. Onda 6 é um achado adicional (fora dos 5 originais
da auditoria SEC-01), sinalizado pela sessão paralela `projetos-f4` durante a REF-LOYALTY-02.

Segue diretamente a auditoria `docs/ref/REF-PAYMENT-SEC-01-auditoria.md` — corrige os 5 achados
autorizados ali (2 HIGH + 3 MEDIUM) mais 1 achado adicional (Onda 6, ver seção própria).

## Coordenação com a sessão paralela (projetos-f4, REF-LOYALTY-02)

Ondas 1 e 2 tocam `create_order()`, área diretamente sobreposta ao trabalho da sessão `projetos-f4`
(REF-LOYALTY-02, commits locais `88a19f1`/`f2528c6`, integração de resgate). Antes de tocar qualquer
arquivo dessa área: mensagem enviada avisando a sobreposição: peer confirmou que tinha planejado o
mesmo fix mas parou antes de começar, e foi consultar o usuário dele. Trabalho pausado nessa parte
específica (Ondas 3/5, independentes, seguiram sem bloqueio) até o dono confirmar explicitamente que
`projetos-f4` estava pausada e autorizar esta sessão a prosseguir com HIGH-01/HIGH-02. Antes de
retomar, o estado real do repositório/E2E foi re-verificado do zero (não assumido) — `create_order()`
já incluía o corpo completo da Onda 2 do peer (`usar_recompensa_fidelidade`/`_redeem_loyalty_for_order`,
já aplicado no E2E), e toda a correção foi construída EM CIMA desse corpo, nunca da versão anterior.
`loyalty_grant`/`loyalty_void_on_cancel` (as duas funções centrais do peer) **não foram alteradas em
nenhuma linha** — só o *momento* em que `loyalty_grant` é chamado mudou.

## Onda 0 — Baseline

- HEAD antes de começar: `492a27a` (doc do checkpoint da REF-PAGAMENTO-01).
- `git status`: limpo, sem alterações pendentes.
- Commits locais do peer (`88a19f1`, `f2528c6`) confirmados intactos, nunca tocados/revertidos/
  cherry-picked.
- Ambiente confirmado em toda operação mutável: `PGHOST` termina em `pooler.supabase.com` e o
  arquivo de conexão é sempre `db.e2e.env` — nunca `db.env` (produção). Os scripts de teste desta
  REF abortam explicitamente se chamados com `--prod`.

## Achados corrigidos

| ID | Severidade | Onda | Commit | Achado |
|---|---|---|---|---|
| MEDIUM-01 | MEDIUM | 3 | `d48ff05` | `iniciar_pagamento_pedido` sem checagem de posse do pedido |
| MEDIUM-03 | MEDIUM | 5 | `f82af03` | Admin podia gravar `payment_status='aprovado'` direto via REST |
| MEDIUM-02 | MEDIUM | 4 | `3aabcc9` | Transição `expirado→aprovado` ausente (já causou incidente real) |
| HIGH-01 | HIGH | 1 | `80ca72c` | Selo de fidelidade concedido antes da confirmação de pagamento |
| HIGH-02 | HIGH | 2 | `5d00c83` | `refunded`/`charged_back` não revertiam o selo |
| (adicional) | MEDIUM | 6 | `cd21646` | Pagamento `recusado` sem retry deixava o pedido preso pra sempre |

(Implementadas fora de ordem numérica — 3/4/5 primeiro, por serem independentes e não exigirem
coordenação; 1/2 por último, após a liberação da sessão paralela; 6 por último de todas, achado
encontrado só depois, durante a REF-LOYALTY-02 Onda 5 da sessão paralela.)

---

## MEDIUM-01 — Onda 3 — `iniciar_pagamento_pedido` sem ownership

**Causa raiz**: a função só validava `id = p_order_id AND store_id = p_store_id` — nenhuma checagem
de que o CHAMADOR fosse dono do pedido. Grantada tanto pra `anon` quanto `authenticated`.

**Correção**: cliente logado precisa ser dono do pedido (`customers.auth_user_id = auth.uid()`);
guest só pode tocar pedido de OUTRO guest (sem `auth_user_id` vinculado) — bloqueia o caso de maior
risco (anônimo contra conta real). Mensagem de erro idêntica em ambos os casos de negação (nunca
revela se o pedido existe). Risco residual documentado: guest ainda pode iniciar pagamento de outro
pedido guest se souber o `order_id` (sem infraestrutura de sessão de guest pra fechar sem reescrever
arquitetura).

**Arquivos**: `migrations/REF-PAYMENT-SEC-02-onda3-ownership-pagamento.sql` (+rollback),
`scripts/payment-sec-02-onda3-ownership-test.mjs`.

**Testes**: 9/9 — prova o achado antes (3 falhas exatas) e a correção depois (9/9), incluindo cliente
A× pedido de B, store errada, anon×conta autenticada, e regressão (idempotência de payment_intent,
capability desligada).

---

## MEDIUM-03 — Onda 5 — guard de `payment_status`

**Causa raiz**: RLS `Admin all orders` (`cmd=ALL`, `is_admin_of`) permitia UPDATE irrestrito em
`orders`, incluindo `payment_status='aprovado'` sem nenhum `payment_intent` aprovado por trás.

**Correção**: trigger `BEFORE UPDATE` (`_orders_payment_status_guard`) que só age quando
`payment_status` REALMENTE muda de valor, e nesse caso exige `current_user IN ('postgres',
'service_role')` — exatamente os roles com que as escritas legítimas acontecem hoje
(`_processar_webhook_payment_intent`/`_registrar_criacao_pagamento` via `service_role` nas Edge
Functions, `_expirar_payment_intents_pendentes` via `pg_cron` como `postgres`). Nenhuma policy de RLS
mudou — admin continua editando status operacional/observações normalmente.

**Arquivos**: `migrations/REF-PAYMENT-SEC-02-onda5-guard-payment-status.sql` (+rollback),
`scripts/payment-sec-02-onda5-payment-status-guard-test.mjs`.

**Testes**: 6/6 — prova que um admin com `is_admin_of=true` confirmado (RLS permitiria) tinha o
UPDATE bloqueado só pelo trigger; edição operacional normal intacta; ambos os fluxos legítimos
(`service_role`, `postgres`) continuam funcionando.

---

## MEDIUM-02 — Onda 4 — `expirado → aprovado`

**Causa raiz**: `_transicao_payment_status_valida` não tinha essa transição — já causou 1 incidente
REAL em produção nesta mesma sessão (pedido `a9c06490...`, R$2,00, dinheiro confirmado na conta
Mercado Pago do dono, mas o `payment_intent` já expirado quando o webhook de aprovação chegou).

**Reconstrução do incidente** (exigida antes de implementar): a única forma de chegar em `'aprovado'`
é via `_processar_webhook_payment_intent`, chamada só após validar a assinatura HMAC E refazer um GET
real na API do Mercado Pago — a transição sempre depende de evidência revalidada do provedor, por
construção, nunca do frontend.

**Correção**: liberada a transição `('expirado', 'aprovado')`. Decisão explícita de escopo (a única
fatia que envolvia escolha de comportamento): o pedido NÃO é reaberto automaticamente
(`orders.status` permanece como estava) — reabrir tem efeito colateral operacional (cozinha,
WhatsApp, fidelidade) fora da autoridade desta correção. Em vez disso, o FATO financeiro é registrado
(`orders.payment_status='aprovado'`) e um log WARN "RECONCILIACAO NECESSARIA" é gravado.

**Arquivos**: `migrations/REF-PAYMENT-SEC-02-onda4-expirado-aprovado.sql` (+rollback),
`scripts/payment-sec-02-onda4-expirado-aprovado-test.mjs`, mais o fix de um teste pré-existente
(`pagamento-01-onda2-webhook-test.mjs`) que tinha essa transição hardcoded como inválida.

**Testes**: 18/18 — reconstrói o incidente real antes do fix (5 falhas exatas) e confirma depois:
transição aceita, pedido não reaberto, fato registrado, log gravado, idempotência contra webhook
duplicado, e regressão completa de todas as transições já existentes.

---

## HIGH-01 — Onda 1 — selo só após pagamento confirmado

**Causa raiz**: `create_order()` chamava `loyalty_grant` incondicionalmente NA CRIAÇÃO do pedido —
inclusive online, ainda em `'aguardando_pagamento'`. Pagamento recusado nunca revertia o selo
(`_processar_webhook_payment_intent` no branch `'recusado'` só muda `payment_status`, nunca
`orders.status`, de propósito — permite retry — então `loyalty_void_on_cancel`, que só reage a
`status='cancelado'`, nunca disparava). Guest sem autenticação conseguia lotar a cartela de
fidelidade criando pedidos abandonados/recusados — 60 pedidos/10min (rate limit de `create_order`) já
bastavam.

**Correção** (zero mudança em `loyalty_grant`/`loyalty_void_on_cancel` — nenhum dos dois foi tocado):
`create_order()` só concede o selo na criação quando `v_status <> 'aguardando_pagamento'` (cobre
dinheiro/PIX físico/cartão físico/retirada/mesa). Pedido online tem a concessão DEFERIDA pra
`_processar_webhook_payment_intent`/`_registrar_criacao_pagamento`, exatamente quando o pedido
REALMENTE transiciona pra `'recebido'` (nunca no ramo "reconciliação" da Onda 4). Como o selo nunca é
concedido enquanto o pagamento não é aprovado, recusado/expirado simplesmente nunca geram selo — sem
precisar de nenhuma reversão nova.

**Arquivos**: `migrations/REF-PAYMENT-SEC-02-onda1-fidelidade-pagamento-confirmado.sql` (+rollback,
inclui `create_order`, `_processar_webhook_payment_intent`, `_registrar_criacao_pagamento`),
`scripts/payment-sec-02-onda1-fidelidade-pagamento-confirmado-test.mjs`.

**Testes**: 12/12 — prova o achado antes (4 falhas exatas, incluindo o cenário de abuso original: 6
pedidos não pagos = 6 selos) e a correção depois: recusado/expirado não geram selo, aprovado gera
exatamente 1 (mesmo com webhook duplicado 2x, retry na 1ª associação, e **concorrência real com 2
conexões pg simultâneas**), abuso zerado, regressão completa (métodos físicos continuam ganhando na
hora, cancelamento físico continua revertendo, resgate de recompensa continua mutuamente exclusivo).

---

## HIGH-02 — Onda 2 — `refunded`/`charged_back`

**Causa raiz**: `mapearStatusMp` (nos 2 `.ts` das Edge Functions) nunca mapeava
`refunded`/`charged_back`/`in_mediation` — caíam no `default: 'pendente'`, uma transição INVÁLIDA
vinda de `'aprovado'`. O webhook de estorno real era descartado em silêncio total (a Edge Function
ainda respondia 200 pro Mercado Pago, que então nunca reenviava — nem log, já que o INSERT em
`application_logs` só acontece depois da transição ser aceita).

**Correção**: mapeamento corrigido nos 2 arquivos (mirrorados, como sempre) —
`in_mediation→em_contestacao`, `refunded`/`charged_back→estornado`. **Nenhuma mudança na máquina de
estados foi necessária** — essas transições já eram válidas desde `'aprovado'`/`'em_contestacao'`, só
o mapeamento estava quebrado. Novo branch em `_processar_webhook_payment_intent` para
`'estornado'`: registra o fato (`payment_status='estornado'`, nunca mexe em `orders.status`) e reverte
o evento de fidelidade específico do pedido usando a MESMA mecânica já aprovada de
`loyalty_void_on_cancel`. Recompensa já resgatada nesse pedido: **não é restaurada** — mesmo
precedente já aprovado pela própria REF-LOYALTY-02 para "resgate + cancelamento posterior" (não foi
uma decisão nova inventada aqui, é a mesma regra já existente espelhada pro caso de estorno).

**Arquivos**: `migrations/REF-PAYMENT-SEC-02-onda2-refund-chargeback.sql` (+rollback),
`scripts/payment-sec-02-onda2-refund-chargeback-test.mjs`, `supabase/functions/mp-webhook/index.ts`,
`supabase/functions/mp-criar-cobranca/index.ts`.

**Testes**: 8/8 — prova o achado antes (4 falhas exatas) e a correção depois: refund reverte,
chargeback reverte (mesma mecânica), refund repetido é idempotente (1 único evento `revoked`),
resgate já usado não é restaurado, pedido sem selo é no-op seguro, disputa aberta sozinha não reverte
nada, mapeamento dos 2 `.ts` confirmado por leitura de código.

---

## (Achado adicional) Onda 6 — pagamento recusado abandonado

**Causa raiz**: `_processar_webhook_payment_intent` (branch `'recusado'`, Onda 2) deliberadamente
preserva `orders.status='aguardando_pagamento'` quando um pagamento é recusado — pra permitir retry
com o mesmo pedido. Mas se o cliente nunca reenvia, o pedido fica preso pra sempre: `'recusado'` é
estado TERMINAL na máquina de `payment_intents` (nenhuma transição sai dele), então o cron
`_expirar_payment_intents_pendentes` (a cada 5min) nunca o alcança — esse cron só cobre
`status='pendente'`.

**Como foi encontrado**: não fazia parte dos 5 achados da auditoria SEC-01. Sinalizado pela sessão
paralela `projetos-f4`, ao revisar a interação entre a Onda 2 desta REF e a REF-LOYALTY-02 Onda 5
deles (que também lida com estados terminais de pedido).

**Correção**: estende o MESMO cron já em produção (mesmo espírito do branch `'expirado'` já
existente) — pedidos em `aguardando_pagamento` cujo `payment_intent` MAIS RECENTE está `'recusado'`
há mais de 15 minutos (mesma janela) são cancelados. `payment_status` não é reescrito (já reflete
`'recusado'` corretamente, gravado pelo webhook quando a recusa aconteceu). Se o cliente retentar
antes dos 15min, o `payment_intent` mais novo passa a ser o considerado (join lateral por
`created_at DESC`), então o pedido fica automaticamente fora do escopo da limpeza.

**Arquivos**: `migrations/REF-PAYMENT-SEC-02-onda6-recusado-abandonado.sql` (+rollback),
`scripts/payment-sec-02-onda6-recusado-abandonado-test.mjs`.

**Testes**: 9/9 — prova o achado antes (versão antiga do cron não cancela), confirma a correção
depois, e regressão: janela ainda não vencida, cliente retentou (pendente novo), cliente retentou e
foi aprovado, múltiplos `recusado` (só o mais recente importa), e o caso `'expirado'` pré-existente
continua intacto.

## (Incidente real, não um achado de auditoria) Bug de frontend exposto pela Onda 3

Depois da Onda 3 (ownership) ir para produção, todo cliente **logado** tentando pagar online passou a
receber `"pedido nao encontrado"` — bloqueado pelo próprio guard de posse que a Onda 3 introduziu.
Causa raiz: `src/pagamento/services/pagamentoService.js` chamava as 3 RPCs/Edge Function de pagamento
via `db` (cliente Supabase da sessão do **Admin**) em vez de `dbCliente` (sessão real do cliente
logado) — bug pré-existente desde a criação do arquivo (REF-PAGAMENTO-01 Onda 5), inofensivo até a
Onda 3 checar posse pela primeira vez (sem checagem, não importava qual client chamava). Mesma classe
de bug já corrigida antes só pra `create_order` (commit `0ab4107`).

**Correção**: trocado `db` por `dbCliente` nas 3 chamadas (`iniciarPagamento`, `criarCobranca`,
`consultarStatusPagamento`). Commit `fd0ecb4`. Reproduzido e confirmado corrigido via E2E real (login
real de cliente fixture + duas chamadas a `iniciar_pagamento_pedido`, uma por client anônimo —
reproduz o bug — e uma pelo client autenticado — confirma o fix). Validado em produção pelo próprio
dono depois do deploy: pagamento voltou a funcionar.

## Testes obrigatórios (seção 12 da REF) — mapa de cobertura

| # | Requisito | Onde foi provado |
|---|---|---|
| 1 | Pagamento recusado não gera selo | Onda 1, teste "1." |
| 2 | Pagamento expirado não gera selo | Onda 1, teste "2." |
| 3 | Pagamento aprovado gera selo | Onda 1, teste "3." |
| 4 | Aprovado repetido gera só um selo | Onda 1, teste "4/5." |
| 5 | Webhook repetido não duplica efeito | Onda 1, teste "4/5." + Onda 4, teste de replay |
| 6 | Refund reverte corretamente | Onda 2, teste "6." |
| 7 | Chargeback reverte corretamente | Onda 2, teste "7." |
| 8 | Refund repetido não duplica reversão | Onda 2, teste "8." |
| 9 | Retry não gera duplicidade | Onda 1, teste "9." |
| 10 | Concorrência não gera duplicidade | Onda 1, teste "10." (2 conexões pg reais) |
| 11 | REF-LOYALTY-01 continua verde | `test:loyalty`/`test:loyalty-guard` — verde |
| 12 | REF-LOYALTY-02 continua verde | `loyalty-02-onda1-test.mjs` 14/14, `onda2` 12/12 |
| 13 | REF-PAGAMENTO-01 continua verde | `onda2-webhook` 29/29, `onda3-criacao-cobranca` 19/19, `onda5-config-status` 7/7, `onda6-payment-method-real` 7/7 |
| 14 | Regressão geral verde | `test:domain` (exit 0), `build` limpo, `mesa-02-onda6`/`onda16` 12/12+34/34, `delivery-fee-05-onda5` 9/9 |

## Produção

**PRODUÇÃO ALTERADA: SIM (2026-09-10).** As 6 migrations (Ondas 1-6) foram aplicadas em produção
(`hvbcdxsagkjtfjwvnslo`) uma a uma, na ordem de dependência real (3→5→4→1→2, depois 6 separadamente),
cada uma validada por introspecção direta (`pg_get_functiondef`) contra o "antes" salvo num preflight
antes de começar. As 2 Edge Functions (`mp-webhook`, `mp-criar-cobranca`) foram deployadas e
confirmadas por download direto do bundle real (não só o log do CLI). O incidente de frontend
(`pagamentoService.js`, ver seção própria acima) foi corrigido, deployado via Vercel e validado pelo
dono com um pagamento real depois do deploy. Nenhum dado de pagamento (`payment_intents`) foi alterado
por nenhuma dessas operações — só estrutura/funções/lógica.

## Riscos residuais (documentados, não escondidos)

1. **Guest × guest** (Onda 3): um guest ainda pode iniciar pagamento de outro pedido guest se souber
   o `order_id` — sem infraestrutura de sessão de guest pra fechar sem reescrever arquitetura.
   *Continua em aberto, aceito.*
2. **Reconciliação manual** (Onda 4): pagamentos aprovados tardiamente pra um pedido já
   expirado/cancelado ficam registrados (`payment_status`) mas não reabrem o pedido sozinhos — depende
   de alguém ler o log WARN "RECONCILIACAO NECESSARIA". Nenhum canal de alerta automático (e-mail/
   WhatsApp pro dono) foi criado — fora do escopo autorizado. *Continua em aberto, aceito.*
3. ~~Deploy pendente~~ — **FECHADO**: Edge Functions deployadas em produção, confirmadas por download.
4. **Constraints de banco** (achado da própria SEC-01, não coberto aqui por estar fora do escopo dos
   5 achados autorizados): `total`/`amount` ainda não têm `CHECK` explícito no banco, só na aplicação.
   *Continua em aberto, aceito.*

## Veredito Final

| # | Pergunta | Resposta | Evidência |
|---|---|---|---|
| A | HIGH-01 corrigido? | **SIM** | Onda 1, 12/12, commit `80ca72c` |
| B | HIGH-02 corrigido? | **SIM** | Onda 2, 8/8, commit `5d00c83` |
| C | MEDIUM-01 corrigido? | **SIM** | Onda 3, 9/9, commit `d48ff05` |
| D | MEDIUM-02 corrigido? | **SIM** | Onda 4, 18/18, commit `3aabcc9` |
| E | MEDIUM-03 corrigido? | **SIM** | Onda 5, 6/6, commit `f82af03` |
| F | Existe novo vetor de fraude? | **NÃO COMPROVADO** (nenhum encontrado nos testes adversariais desta REF, não houve rodada de auditoria completa nova) | Testes de regressão + adversariais de cada onda |
| G | Existe nova possibilidade de double spend? | **NÃO** | Onda 1 teste 10 (concorrência real, 2 conexões), Onda 2 teste 8 (refund repetido) |
| H | Existe nova possibilidade de cross-tenant? | **NÃO** | Nenhuma alteração tocou RLS/tenant scoping; Onda 3 reforça isolamento, não afrouxa |
| I | Existe nova exposição sensível? | **NÃO** | Nenhum log/mensagem de erro novo expõe segredo ou dado sensível além do já existente |
| J | Existe regressão? | **NÃO** | 14/14 itens da tabela de cobertura acima verdes |
| K | Existem riscos residuais? | **SIM** | Ver seção "Riscos residuais" acima (3 itens em aberto, 1 fechado) |
| L | Produção foi alterada? | **SIM** (2026-09-10) | Ver seção "Produção" acima |
| M | Onda 6 (achado adicional) corrigida? | **SIM** | 9/9, commit `cd21646` |
| N | Incidente de frontend (pagamentoService.js) corrigido? | **SIM** | Commit `fd0ecb4`, validado em produção pelo dono |

Os vetores auditados foram mitigados conforme as evidências obtidas nos testes realizados, e as 6
correções + o fix de frontend estão ao vivo em produção.

## Commits (ordem cronológica de implementação)

```
d48ff05 fix(payment-sec-02): Onda 3 -- ownership em iniciar_pagamento_pedido (MEDIUM-01)
f82af03 fix(payment-sec-02): Onda 5 -- guard de orders.payment_status (MEDIUM-03)
3aabcc9 fix(payment-sec-02): Onda 4 -- transicao expirado->aprovado sem reabrir pedido (MEDIUM-02)
80ca72c fix(payment-sec-02): Onda 1 -- selo de fidelidade so apos pagamento confirmado (HIGH-01)
5d00c83 fix(payment-sec-02): Onda 2 -- refunded/charged_back revertem fidelidade (HIGH-02)
fd0ecb4 fix(pagamento): iniciarPagamento/criarCobranca/consultarStatus usam dbCliente, nao db
cd21646 fix(payment-sec-02): Onda 6 -- pedido recusado abandonado deixa de ficar preso pra sempre
```

Mais `e5c9372` (doc da auditoria SEC-01, commitada antes da Onda 3). Todos pushados pra `origin/main`
(via merge `ceb79e1` + pushes subsequentes) e aplicados em produção em 2026-09-10. Nenhum
rebase/cherry-pick/reset destrutivo em nenhum momento. Todos os commits de correção contêm migration +
rollback + script de teste dedicado (exceto Onda 2, que também inclui os 2 arquivos `.ts` das Edge
Functions, e `fd0ecb4`, que é frontend puro sem migration).
