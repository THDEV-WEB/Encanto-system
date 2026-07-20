# whatsapp-notify — Notificações automáticas por WhatsApp (REF-ORDER-01 · Parte 3)

Envio **100% automático, 24/7**, pela **WhatsApp Cloud API oficial da Meta** — sem WhatsApp Web, sem
depender de navegador/PC ligado. Esta Edge Function é o **único** ponto do sistema que fala com a Meta e
o **único** lugar onde as credenciais (segredos) vivem.

## Arquitetura do fluxo

```
troca de status (Admin) ──▶ trigger no banco ──▶ notification_outbox (state='pending')
                                                        │
                            Scheduled Function / Webhook ▼
                                              whatsapp-notify (esta função)
                                       renderiza template ▶ Cloud API ▶ marca sent/failed/skipped
```

- Enfileiramento: `trg_enc_order_status_change` / `trg_enc_order_created` (migration `REF-ORDER-01-order-ops.sql`).
- Templates: espelho de `src/services/notifications/messageTemplates.js` em `./templates.ts` (manter em sync;
  snapshot travado em `tests/whatsapp-templates.golden.mjs`).
- Contrato Cloud API: idêntico ao de `src/services/notifications/WhatsAppService.js` (`buildCloudApiRequest`).

## Pré-requisitos (Meta / WhatsApp Business)

1. App no Meta for Developers + produto **WhatsApp**.
2. Um **Phone Number ID** (número do WhatsApp Business) e um **Access Token** (permanente/System User).
3. **Templates aprovados** na Meta se for enviar fora da janela de 24h de atendimento (mensagens de
   utilidade/transacionais). Dentro da janela de sessão, mensagens de texto livre funcionam.

## Deploy (quando as credenciais existirem — nada de código muda)

```bash
# 1) segredos (ÚNICO ponto de credenciais)
supabase secrets set WHATSAPP_TOKEN="EAAG..." WHATSAPP_PHONE_NUMBER_ID="1234567890" WHATSAPP_API_VERSION="v21.0"

# 2) deploy da função
supabase functions deploy whatsapp-notify
```

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são injetados automaticamente no runtime das Edge Functions.

## Agendamento (escolha um)

**A) Scheduled Function (recomendado)** — drena a fila periodicamente (ex.: a cada 1 min):

```sql
select cron.schedule('whatsapp-notify-drain', '* * * * *', $$
  select net.http_post(
    url:='https://<PROJECT_REF>.functions.supabase.co/whatsapp-notify',
    headers:=jsonb_build_object('Authorization','Bearer <SERVICE_ROLE_KEY>')
  );
$$);
```

**B) Database Webhook** — dispara no `INSERT` de `public.notification_outbox` (near-real-time).

## Comportamento sem credenciais

Se os segredos da Meta não existirem, a função **retorna cedo sem tocar na fila** — as linhas ficam
`pending` e são enviadas automaticamente assim que os segredos forem configurados. A infra fica pronta;
**nada é perdido**. (Só `phone_missing` vira `skipped` terminal — não há como enviar sem telefone.)

## Concorrência (sem envio duplicado)

O drain usa o RPC `enc_claim_notifications(p_limit)` — um `UPDATE ... FOR UPDATE SKIP LOCKED` que marca as
linhas `pending` como `sending` e as devolve. Duas invocações concorrentes (cron + webhook) **nunca**
reivindicam a mesma linha. Linhas presas em `sending` por mais de 15 min (crash no meio do envio) são
reivindicadas de novo automaticamente.

## Teste manual

```bash
supabase functions serve whatsapp-notify --no-verify-jwt
curl -X POST http://localhost:54321/functions/v1/whatsapp-notify
# -> { ok:true, processados, sent, failed, skipped }
```
