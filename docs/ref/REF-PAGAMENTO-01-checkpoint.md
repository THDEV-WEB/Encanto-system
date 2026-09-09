# REF-PAGAMENTO-01 — CHECKPOINT (ler primeiro numa nova sessão/retomada)

**STATUS: Onda 0 (auditoria) + Onda 1 (schema) + Onda 2 (fundação do webhook) + Onda 3 (criação de
cobrança REAL) + Onda 4 (webhook receiver REAL, Edge Function pública) CONCLUÍDAS e commitadas.
Onda 5 (Payment Brick no frontend) ainda não iniciada.**

**Atualizado:** 2026-09-09, após commit `1e8b438` (Onda 4). Execução autônoma autorizada pelo dono.
Hard constraints seguem valendo: nunca produção, nunca push sem autorização explícita do gate, 1
commit por onda com `git add` explícito, nunca tocar arquivo de outra sessão.

## Pendência nova: secret REAL do webhook

`MP_WEBHOOK_SECRET` hoje tem um valor de **TESTE** (gerado localmente por mim, nunca uma credencial
do Mercado Pago — configurado só pra provar o mecanismo de ponta a ponta, ver Onda 4 abaixo). O
valor REAL só existe depois que o dono registrar a URL `https://bgzcrovskjbktdxkhemd.supabase.co/
functions/v1/mp-webhook` no painel "Webhooks" da aplicação do Mercado Pago — passo manual dele,
documentado em `supabase/functions/mp-webhook/README.md`.

## Credenciais de teste do Mercado Pago — DESBLOQUEADO

- **Public Key de teste**: fornecida pelo dono, anotada (não é segredo, é pública por design do MP).
- **Access Token de teste**: primeiro colocado no Vault do Postgres (erro, corrigido na Onda 3),
  agora vive como secret de Edge Function no projeto E2E (`bgzcrovskjbktdxkhemd`):
  `supabase secrets set MP_ACCESS_TOKEN=...`. **Nunca visto por mim em texto — só o hash que o CLI
  mostra.**
- CLI do Supabase logada e linkada ao projeto **E2E** (confirmado por `project-ref` local e por
  `supabase secrets list` mostrando só o projeto correto).

## Reconciliação de histórico (fora do escopo desta REF, mas afetou a `main`)

Durante esta sessão, outra sessão fez o rollout de produção de REF-DELIVERY-FEE-05 (fix real do
bug de taxa de cartão dobrada, commit `80a55e4`, verificado independentemente) e, a pedido do dono
(com o dono no loop direto com as duas sessões), replantou os 7 commits desta REF por cima do
`origin/main` atualizado (cherry-pick puro, conteúdo verificado byte a byte via patch-id antes e
depois da sincronização — **um erro meu no meio do processo**: pedi o replantio de só 5 dos 7
commits na primeira tentativa, os 2 mais antigos [`459bd8c`/`2b5015e`, descoberta+arquitetura]
ficaram órfãos após meu `git reset --hard`, recuperados via `git cherry-pick` local + 2º replantio
pela outra sessão, ambos verificados por patch-id de novo. `main` local está hoje idêntica a
`origin/main`, nenhum trabalho foi perdido.

## Estado do git
```
1e8b438 feat(pagamento-01): Onda 4 -- webhook receiver real (Edge Function publica, sandbox MP)
14db132 feat(pagamento-01): Onda 3 -- criacao de cobranca real (E2E, sandbox Mercado Pago)
3592718 docs(pagamento-01): arquitetura tecnica -- integracao Mercado Pago
6d8b59b docs(pagamento-01): descoberta completa -- gateway de pagamento online
b403598 docs(pagamento-01): checkpoint apos Onda 2 -- webhook credential-independent concluido
6c2b339 feat(pagamento-01): Onda 2 -- fundacao do webhook (credential-independent)
15c66bf docs(pagamento-01): checkpoint apos Onda 1 -- bloqueio de credencial documentado
bac4591 feat(pagamento-01): Onda 1 -- fundacao de schema (payment_intents + divisao de conta de Mesa)
9b59123 docs(pagamento-01): Onda 0 -- auditoria pre-implementacao
```
Todos já em `origin/main` (reconciliados, ver seção acima) — não há mais divergência local/remoto
específica desta REF. Nenhum push adicional foi feito por mim; o replantio/push de `origin/main` foi
executado pela outra sessão, com autorização direta do dono, não por mim.

## Arquivos criados nesta etapa (Onda 4)
- `supabase/functions/mp-webhook/index.ts` + `README.md` (nova Edge Function, `--no-verify-jwt`)
- `scripts/pagamento-01-onda4-webhook-real-test.mjs` (chamada REAL, sandbox MP)

Zero migration nova nesta onda — reaproveita 100% das funções SQL já criadas/testadas na Onda 2.

## Arquivos criados na Onda 3 (referência)
- `migrations/REF-PAGAMENTO-01-onda3-criacao-cobranca.sql` + `-rollback.sql`
- `scripts/pagamento-01-onda3-criacao-cobranca-test.mjs` (RPC + função interna, credential-independent)
- `scripts/pagamento-01-onda3-edge-function-real-test.mjs` (chamada REAL, sandbox MP)
- `supabase/functions/mp-criar-cobranca/index.ts` + `README.md` (nova Edge Function)

## Migrations/objetos criados (Onda 3)
- `iniciar_pagamento_pedido(order_id, store_id)` — RPC client-facing (anon+authenticated, mesma
  exposição de `create_order`), gate por capability `pagamento_online_habilitada` em
  `store_settings` (padrão EAV já usado por `mesa_habilitada` etc. — ausente = desligado, opt-in por
  loja). Reaproveita tentativa `pendente` existente pro mesmo pedido em vez de duplicar.
- `_registrar_criacao_pagamento(...)` — função interna (Edge Function via `service_role`), grava a
  1ª resposta real da API de criação (distinta da idempotência de replay do webhook — todo
  `payment_intent` nasce `pendente`, e a 1ª resposta do MP também costuma vir `pendente`; não é
  replay, é a 1ª escrita). Delega pra `_processar_webhook_payment_intent` (Onda 2) só numa 2ª
  chamada com o MESMO `mp_payment_id`.
- Edge Function `mp-criar-cobranca`: único ponto que fala com `api.mercadopago.com/v1/payments`
  (decisão tomada nesta onda: API clássica, não a Orders API — é a integração oficialmente
  documentada pelo MP para uso com Payment Brick). Nunca confia em store_id/order_id/amount vindos
  do corpo da requisição — sempre relê de `payment_intents` via `service_role`.

## Testes executados e resultados (Onda 4)
- `pagamento-01-onda4-webhook-real-test.mjs`: **8/8 — CHAMADA REAL**, não simulada. Cria uma
  cobrança Pix real (reaproveita `mp-criar-cobranca`, Onda 3), envia uma notificação assinada com
  secret de TESTE pra função `mp-webhook` DEPLOYADA de verdade — assinatura inválida rejeitada (401,
  banco intocado), assinatura válida processada com **GET real** a `api.mercadopago.com/v1/payments/
  {id}`, resolução real de `store_id`, RPC real da Onda 2, replay idempotente, `payment_intent`
  inexistente ignorado (200, nunca gera retry do MP), `payment_intents` confirmado atualizado no
  banco com o status cru real do Mercado Pago.
- Regressão: Onda 1 (20/20), Onda 2 (29/29), Onda 3 A+B (19/19), `test:domain` limpo, lint 61
  warnings pré-existentes (0 novo, 0 erro), build limpo.

## O que foi REALMENTE validado (vs. simulado) — atualizado
- **Onda 3 e Onda 4 juntas fecham o ciclo real de ponta a ponta**: criar cobrança real → Mercado
  Pago processa → notificação chega (simulada com secret de teste, mas todo o resto do pipeline é
  real) → função pública valida/consulta/processa → banco atualizado. Não é mais só
  matemática/simulação em nenhuma das duas pontas.
- Ainda NÃO validado: que o Mercado Pago de fato envia webhooks nesse formato/timing quando chamado
  por ELE mesmo (depende do secret REAL, ver pendência no topo deste documento), Payment Brick
  tokenizando no navegador (frontend, Onda 5), split/OAuth (fora do escopo até segunda ordem).

## Próximo gate necessário

Duas coisas podem avançar em paralelo: (1) o dono registrar a URL do `mp-webhook` no painel de
Webhooks do Mercado Pago pra obter o secret REAL (destrava a validação 100% real do webhook), e/ou
(2) autorizar a Onda 5 (Payment Brick no frontend) — ainda em E2E/sandbox, produção continua
bloqueada até autorização explícita separada.
