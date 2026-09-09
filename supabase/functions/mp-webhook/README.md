# mp-webhook — Receptor de notificações do Mercado Pago (REF-PAGAMENTO-01 · Onda 4)

Endpoint público que o Mercado Pago chama quando o status de um pagamento muda. Zero migration
nova nesta onda — toda a lógica de validação/máquina de estados já existe e foi testada na Onda 2
(`_validar_assinatura_webhook_mp`, `_transicao_payment_status_valida`,
`_processar_webhook_payment_intent`, `_webhook_mercadopago_recebido`); esta função é só o
transporte real que os alimenta.

## Fluxo

```
Mercado Pago ──POST──▶ mp-webhook?data.id=123&type=payment (headers x-signature, x-request-id)
        │
        ▼
  1) valida assinatura EM TS (Web Crypto, sem tocar o banco) — invalida? 401, fim.
        │ valida
        ▼
  2) GET /v1/payments/{id} na API real do MP (nunca confia no status do corpo da notificação)
        │
        ▼
  3) resolve store_id lendo payment_intents pelo mp_payment_id (service_role)
        │ não encontrado? 200 {ignorado:true}, fim (nunca gera retry do MP por evento irrelevante)
        ▼
  4) _webhook_mercadopago_recebido (RPC, revalida assinatura de novo — defesa em profundidade,
     depois delega pra _processar_webhook_payment_intent, Onda 2: máquina de estados/idempotência)
```

## Pré-requisitos

- `MP_ACCESS_TOKEN` já configurado (Onda 3) — reaproveitado aqui para o passo 2.
- `MP_WEBHOOK_SECRET`: **AINDA NÃO é o valor real do Mercado Pago.** Para testar o mecanismo sem
  depender do painel do MP, foi configurado um valor de teste (gerado localmente, nunca uma
  credencial do Mercado Pago — mesmo princípio já usado nos testes de assinatura da Onda 2).

## Como obter o secret REAL (pendência do dono)

1. Painel de Desenvolvedores do Mercado Pago → aplicação → **Webhooks**.
2. Adicionar a URL desta função como endpoint de notificações:
   `https://bgzcrovskjbktdxkhemd.supabase.co/functions/v1/mp-webhook`
3. O Mercado Pago mostra uma **"Assinatura secreta"** — é o valor real do `MP_WEBHOOK_SECRET`.
4. `npx supabase secrets set MP_WEBHOOK_SECRET="<valor real>"` (substitui o de teste).

## Deploy

```bash
npx supabase functions deploy mp-webhook --no-verify-jwt
```

`--no-verify-jwt` é obrigatório aqui — diferente de `mp-criar-cobranca` (chamada pelo nosso
próprio frontend, que envia a `anon key`), o Mercado Pago chama este endpoint diretamente e nunca
envia um JWT do Supabase. Sem essa flag, o gateway da plataforma rejeitaria toda notificação real
do MP com 401 antes mesmo do código desta função rodar.

## Respostas HTTP

| Código | Motivo |
|---|---|
| 401 | assinatura inválida — nada foi tocado no banco |
| 400 | `data.id` ausente na notificação |
| 200 `{ignorado:true}` | assinatura válida, mas não existe `payment_intent` para este `mp_payment_id` (evento de outro produto/id antigo) — intencional, nunca provoca retry |
| 200 `{ok:false,...}` | falha ao consultar o pagamento real na API (erro do lado do MP/rede) — **200 proposital**, evita retry agressivo por um id que talvez nem exista mais |
| 502 | timeout/erro de rede falando com o Mercado Pago — aqui SIM deve gerar retry do MP |
| 200 `{ok:true, resultado:{...}}` | processado — `resultado` é o retorno bruto de `_processar_webhook_payment_intent` |

## O que este script de teste NÃO prova

`scripts/pagamento-01-onda4-webhook-real-test.mjs` cria uma cobrança Pix **real** no sandbox
(reaproveitando `mp-criar-cobranca`) e envia uma notificação **assinada por nós mesmos** com o
secret de teste. Prova que toda a função deployada funciona de ponta a ponta contra dados reais —
não prova que o Mercado Pago realmente envia notificações nesse formato/timing em produção, nem
que o secret real funciona. Isso só se confirma depois do passo "Como obter o secret REAL" acima.
