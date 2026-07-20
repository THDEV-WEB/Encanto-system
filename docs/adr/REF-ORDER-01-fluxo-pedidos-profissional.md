# ADR REF-ORDER-01 — Fluxo profissional de pedidos (Comanda + Histórico + Notificações + Métricas)

**Status:** Implementado (frontend LIVE via Vercel; camada de banco entregue como migration para aplicar; envio WhatsApp preparado, pendente de credenciais Meta).
**Data:** 2026-07-20
**Escopo:** exclusivamente o domínio **Pedidos/Admin**. NÃO altera Checkout, Catálogo, Loja, Busca, Header.
**Frentes paralelas:** REF-DELIVERY-01 / REF-UI-HERO-03 / REF-IMG-01 rodavam em paralelo (working tree compartilhado) — commit fez staging **explícito** só dos arquivos desta referência.

---

## 1. Contexto / arquitetura anterior

O módulo operacional era mínimo:

- **Comanda:** inexistente. O admin via os pedidos numa tabela (`AdminPedidos.jsx`) e mudava o status por um `<select>`. Não havia documento para a cozinha nem impressão.
- **Status:** 5 estados (`recebido`, `preparo`, `entrega`, `entregue`, `cancelado`) — **sem `pronto`**. `DS.setStatus` fazia um `orders.update({status})` cru: **sem registro de histórico e sem ator**. O único evento gravado era o de criação (`create_order`). A timeline do cliente (`PedidoTimeline`) lia `order_events`, mas os passos `preparo/entrega/entregue` nunca ganhavam timestamp porque ninguém os registrava.
- **Notificações:** nenhuma automação. O checkout montava uma mensagem de WhatsApp manual (`buildWhatsAppMessage`) que o cliente enviava — dependente de ação humana, não é notificação de status.
- **Métricas:** impossíveis (sem histórico de transições).

### Limitações encontradas na auditoria

- `orders` persiste apenas `{total, status, payment_method, address, observacoes}`. **Não há** `tipo` (entrega/retirada), `troco`, `subtotal`, `taxa de entrega` nem `desconto`. `order_items` guarda os adicionais como **um único array `adicionais[]`** com `grupo` em cada item — **não** há campos separados de proteína/acompanhamento, e o tamanho está embutido em `preco_unitario` (não é campo).
- Preencher esses campos exigiria alterar o **Checkout** — **proibido** nesta referência. Portanto a Comanda renderiza fielmente o que existe e **nunca fabrica** dado ausente (ver §5, gaps honestos).
- Acesso ao banco só pela **chave anon** → esta referência **não aplica migrations**; entrega SQL idempotente/reversível para aplicação manual (mesmo modelo com que `order_events`/`create_order` foram criados fora do repo).

**Sinal de tipo (achado-chave):** o checkout persiste `order.address = "Retirada na loja — ..."` na retirada ([CheckoutPage.jsx:29]) e o label do cliente na entrega. Isso dá um **discriminador determinístico** sem tocar no checkout.

---

## 2. Decisão / arquitetura nova

Quatro pilares, cada um com baixo acoplamento e camadas puras testáveis.

### Parte 1 — Comanda profissional (100% frontend, LIVE)

Pipeline de **camadas puras** (roda em Node, golden test) + **um** ponto impuro isolado:

```
order (snapshot) ─▶ comandaModel.buildComanda() ─▶ view-model
                                                     │
                        comandaHtml.comandaHTML() ─▶ HTML térmico autocontido (mesmo p/ preview E impressão)
                                                     │
             ComandaModal (iframe srcDoc = preview WYSIWYG)   printComanda (iframe oculto → window.print)
```

- **`comandaModel.js`** — PURO (importa só `utils/format`). Deriva tipo (entrega/retirada), agrupa adicionais por grupo/subgrupo preservando ordem, calcula subtotal/total/delta, monta cliente/endereço/pagamento. Contrato de retorno estável (nunca `undefined`).
- **`comandaHtml.js`** — PURO. View-model → string HTML **autocontida** (estilo embutido, `@page` térmico 80mm/58mm, alto contraste). **Escapa** todo conteúdo dinâmico (XSS-safe). É a **fonte única** de layout: preview e impressão usam exatamente o mesmo HTML.
- **`printComanda.js`** — único ponto impuro (iframe oculto + `print()`, imune a pop-up blocker; no-op fora do browser).
- **`ComandaModal.jsx`** — chrome do modal em estilo inline (**não** depende do `index.css`, que está sob outra frente); preview via `<iframe srcDoc>`.

Preparado para futuras impressoras (ESC/POS): o mesmo view-model alimenta outro encoder sem tocar nas outras camadas. Sem QR Code, sem nome de entregador (conforme spec).

### Parte 2 — Histórico de status (frontend LIVE + trigger na migration)

- Inserido o estado **`pronto`**: `Recebido → Em preparo → Pronto → Saiu para entrega → Entregue`. Atualizado em `AdminPedidos` (badge + opções) e em `pedidoStatus.js` (`STATUS_INFO` + `TIMELINE`) para o cliente não regredir.
- **Fonte única = TRIGGER no banco** (`trg_enc_order_status_change`): toda troca de status grava `order_events` (`status_anterior`, `status_novo`, `ator`) — cobre qualquer canal, não só a UI. O ator é rótulo amigável (`admin`/`cliente`/`sistema`) derivado de `is_admin()`/`auth.uid()`.
- **`PedidoHistorico.jsx`** — no admin, expande a trilha do pedido (`DS.getEventos`, `select('*')` para sobreviver à coluna `ator` antes/depois da migration).
- **Segurança operacional:** o log é `BEGIN/EXCEPTION` best-effort — **nunca bloqueia a troca de status** mesmo se um pressuposto de schema estiver errado.

### Parte 3 — Notificações automáticas (WhatsApp Cloud API oficial)

Padrão **OUTBOX** com envio **server-side** (24/7, sem WhatsApp Web, sem PC ligado):

```
troca/criação de status → trigger → notification_outbox(pending)
                                          │  (Scheduled Function / Webhook)
                                          ▼
                              Edge Function whatsapp-notify (Deno, service_role)
                          renderiza template → WhatsApp Cloud API → sent/failed/skipped
```

- **`messageTemplates.js`** — fonte **canônica** das 5 mensagens (spec verbatim) + `renderTemplate`. PURA/testada. "Não quero textos espalhados": toda copy vive aqui.
- **`WhatsAppService.js`** — serviço dedicado que **isola** a Cloud API: `buildCloudApiRequest` (contrato exato, puro/testável), `normalizePhoneBR`, `sendViaCloudApi(cfg, msg, fetchImpl)` (runtime-agnóstico, fetch/config **injetados**). **Nunca** lê token de `import.meta.env` → nada sensível vaza para o bundle.
- **Edge Function `whatsapp-notify`** — **único** ponto onde as credenciais vivem (segredos do servidor). Drena a fila, renderiza (espelho TS de `messageTemplates`, paridade travada em golden), envia, marca estado com retry até 5 tentativas.
- **Ponto de credenciais isolado:** `supabase secrets set WHATSAPP_TOKEN=… WHATSAPP_PHONE_NUMBER_ID=…`. Sem credenciais, a fila acumula `skipped` (`whatsapp_not_configured`) — infra pronta, nada perdido.

### Parte 4 — Preparação para métricas

View `order_status_durations` (`security_invoker=true` → respeita RLS): por pedido, o timestamp de cada transição e a **duração** até a próxima (janela `LEAD`). Métricas de tempo (recebido→preparo→pronto→saiu→entregue) já ficam possíveis sem UI ainda.

---

## 3. Componentes / serviços / arquivos novos

| Camada | Arquivo |
|---|---|
| Comanda (puro) | `src/components/admin/comanda/comandaModel.js`, `comandaHtml.js` |
| Comanda (impuro/UI) | `src/components/admin/comanda/printComanda.js`, `ComandaModal.jsx` |
| Histórico (UI) | `src/components/admin/PedidoHistorico.jsx` |
| Notificações | `src/services/notifications/messageTemplates.js`, `WhatsAppService.js` |
| Edge Function | `supabase/functions/whatsapp-notify/index.ts`, `templates.ts`, `README.md` |
| Banco | `migrations/REF-ORDER-01-order-ops.sql` (+ `-rollback.sql`) |
| Testes | `tests/comanda.golden.mjs`, `order-status.guard.mjs`, `whatsapp-templates.golden.mjs` |

**Modificados (mínimo):** `AdminPedidos.jsx` (comanda + histórico + `pronto`), `pedidoStatus.js` (`pronto`), `DataService.js` (+`getEventos`, +`countPedidosByCustomer`), `package.json` (3 scripts).

**Intocados de propósito** (frente REF-DELIVERY-01, staging explícito): `AdminPanel.jsx`, `index.css`, `StoreApp.jsx`, `DeliveryBar.jsx`, `ProductCard.jsx`, `SuccessPage.jsx`, `render.smoke.mjs`. Por isso a Comanda ganhou tab de ação **dentro de `AdminPedidos`** (não um novo tab em `AdminPanel`) e trouxe seu CSS embutido (não em `index.css`).

---

## 4. Migration (aplicar 1x no SQL editor)

`REF-ORDER-01-order-ops.sql` — idempotente, reversível, 1 transação:

1. `orders.status` CHECK recriado com os 6 estados (remove qualquer CHECK de status pré-existente, sob qualquer nome).
2. `order_events.ator text` (ADD COLUMN IF NOT EXISTS).
3. `notification_outbox` (fila) + índice parcial de `pending` + RLS (só admin lê; escrita só trigger/service_role → protege PII).
4. Helpers `enc_actor_label()`, `enc_tempo_estimado()`, `enc_enqueue_notification()`.
5. Triggers `trg_enc_order_status_change` (AFTER UPDATE OF status) e `trg_enc_order_created` (AFTER INSERT → "Recebido").
6. View `order_status_durations` (`security_invoker`).

Traz queries de verificação e teste seguro (`BEGIN; UPDATE …; SELECT …; ROLLBACK;`).

---

## 5. Gaps honestos (dado que o checkout não pode ser tocado)

Registrados para não fabricar informação e como trabalho futuro (exigiriam mudança no Checkout):

- **Troco:** não é persistido (`form.troco` só ia para a mensagem de WhatsApp). A comanda omite; nunca inventa.
- **Tipo entrega/retirada:** inferido do prefixo `"Retirada na loja —"` do `address` (determinístico, mas não é campo). Futuro: `orders.tipo`.
- **Subtotal/taxa/desconto:** só `total` é persistido. A comanda calcula subtotal dos itens e mostra a diferença real como "Taxa de entrega / ajuste" (ou "Desconto") apenas quando ≠ 0. Futuro: campos próprios.
- **Proteína/acompanhamento separados:** o dado é um único `adicionais[]` com `grupo`. A comanda agrupa por grupo/subgrupo (escalável: grupo novo aparece sem código). Split real exigiria modelar a seleção no checkout/modal.
- **Combo:** sem expansão de componentes no snapshot; a comanda marca a linha com tag `COMBO` e mostra o que foi capturado.

---

## 6. Qualidade

- **Testes novos:** `comanda.golden` (view-model + HTML + XSS-safe), `order-status.guard` (timeline canônica + `pronto`), `whatsapp-templates.golden` (copy canônica + paridade JS↔TS da Edge Function). Todos verdes.
- **Regressão:** 15 suítes puras verdes; `test:deps` verde (serviços de notificação são folhas; sem violação de camada); `vite build` verde (224 módulos, junto com a frente paralela).
- **Revisão adversarial:** 4 lentes (correção/segurança/acoplamento/UX), achados corrigidos.

Relaciona: [[REF-CLIENTE-02]] (order_events/timeline do cliente), [[REF-BUSINESS-HOURS]], [[REF-CHECKOUT-ADDRESS-01]] (label de endereço = sinal de tipo).
