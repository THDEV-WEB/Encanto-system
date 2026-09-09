# REF-PAGAMENTO-01 — CHECKPOINT (ler primeiro numa nova sessão/retomada)

**STATUS: Onda 0 (auditoria) + Onda 1 (schema) + Onda 2 (fundação do webhook,
credential-independent) CONCLUÍDAS e commitadas. Onda 2-REAL/3 em diante BLOQUEADA por
credencial — não é algo que autonomia resolve.**

**Atualizado:** 2026-09-09, após commit `985200e` (Onda 2). Execução autônoma autorizada pelo dono.
Hard constraints seguem valendo: nunca produção, nunca push, 1 commit por onda com `git add`
explícito, nunca tocar arquivo de outra sessão (`src/constants/privacyPolicy.js`,
`supabase/functions/route-distance/index.ts` — REF-DELIVERY-FEE-05 ativa agora —,
`scripts/loadtest-e2e.mjs`).

## Estado do git
```
985200e feat(pagamento-01): Onda 2 -- fundacao do webhook (credential-independent)
7f4d771 docs(pagamento-01): checkpoint apos Onda 1 -- bloqueio de credencial documentado
20e29be feat(pagamento-01): Onda 1 -- fundacao de schema (payment_intents + divisao de conta de Mesa)
282d449 docs(pagamento-01): Onda 0 -- auditoria pre-implementacao
2b5015e docs(pagamento-01): arquitetura tecnica -- integracao Mercado Pago
459bd8c docs(pagamento-01): descoberta completa -- gateway de pagamento online
```
Todos LOCAIS, `origin/main` não avançou (nota: outra sessão fez um rebase+reset temporário no
`main` compartilhado durante a Onda 1 desta REF, verificado independentemente como neutro — ver
transcript, hash de `main` nunca mudou no resultado final). Working tree só tem os 3 arquivos de
outras sessões acima (nunca tocados por mim).

## Arquivos alterados/criados nesta etapa (Onda 2)
- `migrations/REF-PAGAMENTO-01-onda2-webhook-fundacao.sql` (novo)
- `migrations/REF-PAGAMENTO-01-onda2-webhook-fundacao-rollback.sql` (novo)
- `scripts/pagamento-01-onda2-webhook-test.mjs` (novo)
- `docs/ref/REF-PAGAMENTO-01-checkpoint.md` (este arquivo, atualizado)

## Migrations/objetos criados (Onda 2)
- `_hmac_sha256_hex(text, text)` — wrapper puro sobre `extensions.hmac()` (pgcrypto vive no schema
  `extensions` no Supabase, não em `public`/`pg_catalog` — achado real, chamada schema-qualificada).
- `_validar_assinatura_webhook_mp(data_id, x_request_id, x_signature, secret)` — HMAC-SHA256 do
  manifest EXATO documentado oficialmente pelo Mercado Pago
  (`id:{data.id};request-id:{x-request-id};ts:{ts};`), mais uma janela de frescor de 10min
  (passado)/2min (futuro) — **essa janela é decisão nossa, documentada como tal, não exigida pela
  doc oficial**.
- `_transicao_payment_status_valida(de, para)` — máquina de estados fechada (7 transições válidas,
  todo o resto rejeitado, incluindo qualquer regressão de estado terminal).
- `_processar_webhook_payment_intent(...)` — idempotente (mesmo status 2x = no-op), valida tenant
  antes de qualquer escrita, promove `orders.status` (aguardando_pagamento→recebido) ou fatia de
  mesa (pendente→pago) só em aprovação.
- `_webhook_mercadopago_recebido(...)` — entry point único: assinatura inválida nunca toca o banco.
- `_expirar_payment_intents_pendentes()` — job de expiração de 15min, agendado via `pg_cron`
  (`encanto-pagamento-expira-intents`, a cada 5min — mesmo mecanismo de REF-ORDER-01/
  REF-DELIVERY-FEE-05).
- **Achado real corrigido**: `orders.status` tem um CHECK (`orders_status_valid`) que as Ondas 0/1
  não tinham detectado — lista fechada (recebido/preparo/pronto/entrega/entregue/cancelado), sem
  `aguardando_pagamento`. Corrigido de forma aditiva (`ALTER TABLE ... ADD CONSTRAINT` com a lista
  + o valor novo) — `create_order()` continua intocado, ele nunca grava esse valor hoje.
- Todas as 6 funções são **internas** (prefixo `_`), zero GRANT a ninguém.

## Testes executados e resultados
- `scripts/pagamento-01-onda2-webhook-test.mjs`: **29/29** — HMAC (SQL bate com `crypto` nativo do
  Node), assinatura válida/inválida/adulterada (data_id/request_id/secret)/malformada/maiúscula/
  fora da janela de frescor (passado e futuro), máquina de estados (7 válidas + 6 inválidas),
  processamento (aprovar delivery, idempotência de replay, bloqueio de regressão via replay
  antigo), cross-tenant, não encontrado, entry point (assinatura forjada nunca toca o banco),
  aprovação de fatia de mesa online, job de expiração (expira só quem passou de 15min, nunca toca
  quem já está aprovado).
- Regressão: `pagamento-01-onda1-fundacao-test.mjs` 20/20, MESA-01 (7 suítes) 100%, MESA-02 (13
  suítes, incluindo Onda 16 segurança 34/34) 100%, `test:domain` limpo (**exceto 1 achado
  investigado, ver seção própria abaixo**), lint (61 warnings pré-existentes, 0 novo, 0 erro),
  build limpo.
- Apply→rollback→reapply testado 2x (antes e depois do fix da CHECK constraint), incluindo
  confirmação de que o rollback restaura `orders_status_valid` ao texto exato de antes.

## O que foi REALMENTE validado (vs. simulado)
- A **matemática** da validação HMAC está correta (2 implementações independentes — SQL e
  `crypto` nativo do Node — concordam) e seu comportamento contra manipulação está provado
  (rejeita qualquer adulteração de data_id/request_id/secret/timestamp).
- A **máquina de estados e idempotência** estão provadas contra replay real (mesmo webhook 2x,
  tentativa de regressão via webhook antigo).
- **NÃO validado** (e não pode ser, sem credencial): que o Mercado Pago realmente envia webhooks
  nesse formato exato em produção, que o simulador oficial de webhooks aceita nossa validação, que
  a API de criação de pagamento (Onda 2-real) funciona. Todo teste desta onda usa
  `payment_intents` **inseridos manualmente** (nunca criados pela API real) e webhooks **assinados
  por nós mesmos** com um secret de teste gerado localmente no processo Node — nunca uma credencial
  do Mercado Pago.

## Achado incidental — teste de outra REF conectou em produção (não é meu, não é novo)

Durante a regressão completa, `scripts/dashboard01-admin-reports-test.mjs` (pré-existente, de
REF-DASHBOARD-01, faz parte da bateria padrão de regressão desde a REF-MESA-02) **conecta em
produção por design** (`ENV_PATH` hardcoded pra `db.env`, linha 20 do próprio script — não é bug,
não é o padrão do INCIDENTE-01) — roda tudo dentro de `BEGIN...ROLLBACK`, com a própria suíte
confirmando `mutação líquida = 0` (lojas/admins/pedidos fictícios: 0 residuais). Isso sempre foi
assim, inclusive durante toda a execução da REF-MESA-02 — só notei agora porque parei pra ler a
linha de fingerprint do relatório. **Nenhuma escrita persistiu, mas registro aqui por
transparência** (o dono deve saber que esse script específico, entre os ~20 da bateria de
regressão, sempre leu de produção).

**Resultado do teste**: 12/13 — ITEM 3 (classificação entrega/retirada no `admin_reports_summary`)
falhou: um pedido de retirada fictício foi classificado como "entrega". Investigação preliminar
(só leitura do próprio script de teste, sem tocar produção de novo): o teste é anterior à
REF-MESA-01, que introduziu `orders.tipo_pedido`/`origem_pedido` como fonte estrutural — é
plausível que `admin_reports_summary` em produção já tenha migrado pra usar `tipo_pedido` como
autoritativo, e o teste (não atualizado) ainda dependa só do texto do endereço pra inferir
retirada. **Não investigado a fundo nem corrigido — fora do escopo desta REF** (mesmo padrão da
REF-MESA-02 Onda 17 com o achado de drift da REF-DELIVERY-FEE-05: documentado, não mascarado, não
consertado por quem não é dono daquela REF).

## BLOQUEIO REAL — Onda 2-real/3 em diante

**Não posso criar uma aplicação no painel do Mercado Pago Developers nem gerar credenciais de
teste.** Sem isso: nenhuma chamada real à API (criar cobrança, consultar pagamento), nenhum
Payment Brick renderizando/tokenizando de verdade, nenhum teste contra o simulador oficial de
webhooks do Mercado Pago.

**Classificação: BLOQUEADO POR CREDENCIAL.**

## Trabalho credential-independent que ainda resta (se o dono quiser mais antes de fornecer credencial)
- Testes de concorrência da divisão de conta de Mesa (2 admins tentando dividir a mesma sessão ao
  mesmo tempo — lock já existe via `FOR UPDATE`, mas sem teste de 2 conexões reais provando).
- Arredondamento de centavos ímpares na divisão de conta (ex.: R$100 dividido em 3 partes iguais).
- Revisão do achado do `dashboard01` (fora do escopo desta REF, mas vale reportar pro dono decidir
  quem investiga).

## Próximo gate necessário

Decisão do dono: (1) criar a aplicação de teste do Mercado Pago e fornecer credenciais via
Supabase Secrets (nunca chat) para destravar Onda 2-real/3, OU (2) autorizar mais trabalho
credential-independent da lista acima, OU (3) decidir quem investiga o achado do `dashboard01`
(não é desta REF).
