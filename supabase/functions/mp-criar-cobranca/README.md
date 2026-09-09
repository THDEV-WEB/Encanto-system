# mp-criar-cobranca — Criação de cobrança real no Mercado Pago (REF-PAGAMENTO-01 · Onda 3)

Único ponto do sistema que fala com a API `/v1/payments` do Mercado Pago para **criar** um
pagamento. Recebe o resultado da tokenização do Payment Brick (acontece no navegador do cliente,
nunca passa por aqui) + `payment_intent_id` (criado antes via a RPC `iniciar_pagamento_pedido`).

## Por que uma Edge Function

`MP_ACCESS_TOKEN` é o segredo mais sensível desta REF — nunca pode chegar ao navegador. Diferente
do WhatsApp (que fala com a API de dentro do Postgres via `pg_net`), aqui a chamada precisa ser
síncrona (o Payment Brick espera um retorno imediato de aprovado/pendente/recusado para renderizar
na tela do cliente) — isso é o formato natural de uma Edge Function `fetch`, não de `pg_net`.

## Fluxo

```
Payment Brick (navegador, usa mp_public_key) ──▶ token + payment_method_id + installments + payer
                    │
                    ▼
      mp-criar-cobranca (esta função)
        1) relê store_id/order_id/amount/idempotency_key de payment_intents (service_role,
           NUNCA confia no que o cliente mandou sobre valor/loja)
        2) POST /v1/payments no Mercado Pago (Authorization: Bearer MP_ACCESS_TOKEN,
           X-Idempotency-Key: idempotency_key do payment_intent)
        3) _registrar_criacao_pagamento (RPC interna) grava mp_payment_id/status/raw_payload
```

## Pré-requisito: credencial de teste do Mercado Pago

Aplicação criada no painel de Desenvolvedores do Mercado Pago (Checkout Bricks), Access Token de
teste (`TEST-...`) já obtido.

## Deploy

```bash
npx supabase login                                    # uma vez por máquina
npx supabase link --project-ref bgzcrovskjbktdxkhemd   # projeto E2E -- NUNCA produção nesta fase
npx supabase secrets set MP_ACCESS_TOKEN="<access token de teste>"
npx supabase functions deploy mp-criar-cobranca
```

## Comportamento sem credencial

Se `MP_ACCESS_TOKEN` não existir, responde `503 {ok:false, error:"not_configured"}` para toda
requisição — mesmo princípio já usado em `route-distance`/`whatsapp-notify`.

## Status HTTP usados

| Código | Motivo |
|---|---|
| 400 | corpo inválido / campos obrigatórios ausentes |
| 404 | `payment_intent_id` não encontrado |
| 409 | `payment_intent` já não está `pendente` (já processado antes) |
| 402 | Mercado Pago rejeitou a criação (cartão inválido, token expirado, etc.) |
| 429 | rate limit (10 requisições/min por IP) |
| 502 | erro de rede/timeout falando com o Mercado Pago (nada foi gravado, retry seguro) |
| 503 | secret não configurado |
| 200 | cobrança criada — corpo traz `status` já no vocabulário interno (`pendente`/`aprovado`/`recusado`) |

## Teste manual (produção da função, após deploy — ainda sandbox do Mercado Pago)

Requer um `token` real de cartão de teste, gerado via `/v1/card_tokens` do Mercado Pago com a
Public Key de teste (documentado no `scripts/pagamento-01-onda3-edge-function-real-test.mjs`, que
faz esse passo automaticamente).
