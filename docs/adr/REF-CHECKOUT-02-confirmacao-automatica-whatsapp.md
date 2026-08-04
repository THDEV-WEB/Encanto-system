# ADR REF-CHECKOUT-02 — Confirmação automática via WhatsApp (fim da escolha manual)

**Status:** Implementado (frontend LIVE via Vercel; persistência do pedido intocada).
**Data:** 2026-08-04
**Escopo:** exclusivamente o **pós-persistência** do checkout (mensagem do WhatsApp + tela de sucesso). NÃO altera `create_order`, RPCs, Admin, regras de negócio, nem a persistência do pedido.

---

## 1. Contexto / comportamento anterior

Fluxo antigo:

```
Finalizar Pedido → pedido salvo → tela de sucesso → CLIENTE ESCOLHE:
                                                        • "Enviar pedido pelo WhatsApp" (window.open manual)
                                                        • "← Voltar ao cardápio" (sai sem nunca abrir o WhatsApp)
```

A operação deixou de aceitar esse comportamento: pedidos ficavam sem confirmação porque o cliente
simplesmente voltava ao cardápio sem tocar no botão do WhatsApp.

### Duplicação encontrada na auditoria

A mensagem do WhatsApp (`buildWhatsAppMessage`, em `utils/orderPayload.js`) e a comanda do Admin
(`buildComanda` + `comandaTexto`, em `components/admin/comanda/`) eram **duas implementações
independentes** do mesmo problema — "renderizar um pedido como texto":

| | `buildWhatsAppMessage` (antiga) | `buildComanda`/`comandaTexto` (Admin) |
|---|---|---|
| Fonte dos dados | `cart`/`form` (antes de persistir) | pedido já persistido (`orders`+`order_items`+`customers`) |
| Nº do pedido | ❌ | ✅ (`#XXXXX`, últimos 5 do uuid — fallback já usado hoje, nunca há `numero` sequencial real) |
| Data/hora | ❌ | ✅ |
| Tipo entrega/retirada | ❌ (implícito no texto do endereço) | ✅ explícito |
| Adicionais agrupados | lista simples | agrupados por categoria |
| Subtotal / taxa / desconto | ❌ (só total) | ✅ (delta total−subtotal, rotulado por sinal) |
| Testada (golden) | sim | sim |

A comanda já resolvia praticamente tudo que a nova mensagem do cliente precisava — só faltava dois
dados que **só o checkout tem** (nunca persistidos, gap já documentado em
[[REF-ORDER-01-fluxo-pedidos-profissional]] §5): troco, e o fato de rodar antes de haver um "pedido
do banco" para ler de volta.

---

## 2. Decisão / arquitetura nova

### 2.1 Camada compartilhada (elimina a duplicação)

`utils/orderPayload.js` ganhou `buildOrderConfirmationMessage(customer, order, items, orderId, opts)`,
que **substitui** `buildWhatsAppMessage`. Em vez de montar a string por conta própria, ela:

1. monta um **snapshot** do pedido no mesmo formato que `buildComanda` já consome — usando os dados
   que `buildOrderArgs` **já calculou** para a persistência (`customer`/`order`/`items`) + o `orderId`
   que `create_order` acabou de confirmar + o instante atual (`new Date()`, testável via
   `opts.createdAt`) — **sem nenhuma query adicional** ao banco;
2. delega a `buildComanda(snapshot, { companyInfo, troco })` + `comandaTexto(vm, { contexto: 'cliente' })`
   — a **mesma** função pura que o Admin usa para a comanda impressa.

```
buildOrderArgs(cart, form, …) ──┐
                                 ├─▶ orderSnapshot ──▶ buildComanda() ──▶ view-model ──▶ comandaTexto(contexto:'cliente')
create_order() → orderId ───────┘                                                              │
                                                                                    mensagem pronta p/ wa.me
```

`comandaModel.js`/`comandaTexto.js` ganharam 2 parâmetros **opcionais**, sem alterar nenhum caso
existente do Admin (golden tests provam isso — ver §4):

- `buildComanda(order, { …, troco })` → popula `pagamento.troco` (default `null`, igual a sempre — só o
  checkout passa esse dado, nunca persistido);
- `comandaTexto(vm, { contexto: 'cliente' | 'interna' (default) })` → no contexto `'cliente'`: omite
  `COBRAR DO CLIENTE` (instrução operacional da cozinha, sem sentido na mensagem que o próprio cliente
  envia à loja) e rotula o ajuste como `Taxa de entrega`/`Desconto` (sem o sufixo interno `/ ajuste`).

Se amanhã um campo novo entrar na comanda (`buildComanda`), ele aparece automaticamente na mensagem do
cliente também — não há mais 2 lugares para manter em sincronia.

`comandaModel.js`/`comandaTexto.js` continuam fisicamente em `components/admin/comanda/` (não foram
movidos — mudança de arquitetura fora do pedido); `utils/orderPayload.js` passou a importá-los. Provado
seguro pelo `test:deps` (§4): são módulos puros (só compõem `utils/format`), sem React/IO/Supabase, e a
regra estrutural G-CK3 (order-domain permanece puro) continua verde.

### 2.2 Fluxo de UI (fim da escolha manual)

```
Finalizar Pedido → pedido salvo → SuccessPage monta:
                                     └─▶ useEffect (1x): window.open(wa.me/…) AUTOMÁTICO
                                            ├─ abriu  → tela de sucesso (com botão "Abrir novamente" + "Voltar ao cardápio")
                                            └─ bloqueado → tela de CONTINGÊNCIA (só o botão "Abrir WhatsApp novamente")
```

Não existe mais "Enviar pelo WhatsApp" como decisão do cliente — a abertura acontece sozinha. O botão
"Voltar ao cardápio" só aparece **depois** da tentativa (automática ou manual), nunca como alternativa a
ela.

**Risco técnico conhecido, e por isso a contingência existe:** navegadores bloqueiam `window.open()``
quando ele não é resultado direto e síncrono de um gesto do usuário. A abertura automática roda dentro
de um `useEffect`, depois dos `await`s de rede do `submit` — não há garantia de que todo navegador
preserve a "sticky activation" até ali. Detecção: `window.open()` bloqueado devolve `null` (ou uma
janela já fechada); nesse caso cai na contingência. Um clique manual no botão (gesto direto) nunca é
bloqueado — por isso a contingência nunca deixa o cliente sem saída.

`SuccessPage` guarda uma `ref` (`tentouRef`) para nunca disparar o `window.open` duas vezes (StrictMode
do React roda efeitos 2x em dev).

**Ambiente nativo (Capacitor/Android):** o mecanismo de abertura (`window.open` para `wa.me`) é o
**mesmo** que o botão manual já usava antes desta mudança — e que já foi homologado fisicamente em
[[REF-CAP-01]]. Só o *gatilho* virou automático. Risco residual não verificável sem o dispositivo físico:
se o WebView do Capacitor devolver sempre `null` para `window.open` (mesmo quando a abertura funciona via
Intent do sistema), o cliente veria a contingência mesmo em caso de sucesso — não é bloqueante (o botão
manual da contingência sempre funciona), mas recomienda-se validar no próximo QA físico do app.

### 2.3 O que NÃO mudou

- `create_order` / RPC / persistência do pedido — intocados.
- `DS.savePedido` — intocado.
- Regras de negócio (gate de horário, idempotência, endereço) — intocadas.
- Comanda do Admin (`ComandaModal.jsx`) — comportamento idêntico (golden tests provam: nenhum caso sem
  os novos `opts` muda de resultado).
- Sentry/observabilidade (`registrarBreadcrumb`/`marcarPedido`) — intocados.

---

## 3. Mensagem do WhatsApp — conteúdo

Reaproveitando a estrutura da comanda (contexto `'cliente'`):

```
*<NOME DA LOJA> DELIVERY*
<linha 2 institucional>

*<TIPO>* — Pedido #XXXXX
Ref. cliente: #XXXXXXXX
Realizado: dd/mm/aaaa, HH:mm
Previsão: <texto>

*ITENS*
<qty>x <produto>
  <grupo adicional>: <itens>
  OBS: <observação do item>

*OBSERVAÇÕES*
<observações gerais>

*CLIENTE*
<nome>
<telefone>

[*ENDEREÇO*      ← só entrega
<linhas>]

*PAGAMENTO*
<forma>
Troco para: <valor>   ← só se informado

Subtotal: <valor>
Taxa de entrega: <valor>   ← só se total > subtotal
Desconto: <valor>          ← só se total < subtotal
*TOTAL: <valor>*

<rodapé>
<nome da loja>
```

**Gap honesto herdado** (mesmo do Admin, [[REF-ORDER-01-fluxo-pedidos-profissional]] §5): taxa de
entrega e desconto não são campos persistidos separadamente — só `orders.total`. A mensagem deriva um
único delta (`total − subtotal dos itens`) e rotula pelo sinal; nunca aparecem os dois ao mesmo tempo
porque matematicamente é a mesma diferença. Alterar isso exigiria mudar o schema/persistência do pedido
— fora do escopo desta referência (persistência preservada por instrução explícita).

---

## 4. Testes

- `tests/comanda.golden.mjs` — 10 casos novos: `opts.troco` (presente/ausente/vazio), `contexto:'cliente'`
  vs `'interna'` (COBRAR DO CLIENTE, rótulo do ajuste, troco em ambos os contextos), prova de que o
  comportamento sem os novos `opts` é **byte-idêntico** ao anterior.
- `tests/checkout.golden.mjs` — seção (C) nova: `buildOrderConfirmationMessage` é **exatamente**
  equivalente a montar o snapshot manualmente e chamar `buildComanda`+`comandaTexto` (prova de que não há
  lógica própria escondida, e sim reuso real); conteúdo obrigatório presente; troco; retirada vs entrega.
  Removido o golden antigo (`GOLDEN_MSG`) de `buildWhatsAppMessage` (função removida).
- `tests/company-name.guard.mjs` — item (5) atualizado: antes travava a interpolação hardcoded em
  `buildWhatsAppMessage`; agora trava que `orderPayload.js` delega o nome da loja a `buildComanda` (sem
  "Encanto" hardcoded em lugar nenhum do arquivo).
- `tests/deps.audit.mjs` — verde: `utils/orderPayload.js → components/admin/comanda/{comandaModel,comandaTexto}.js`
  não viola nenhuma regra estrutural (módulos puros, sem ciclo).
- **e2e novo** (`e2e/tests/checkout/checkout-whatsapp.spec.js`, 2 specs):
  1. `window.open` automático dispara sem nenhum clique do cliente além de "Finalizar Pedido"
     (`page.waitForEvent('popup')` em paralelo com o submit); URL real `wa.me`→`api.whatsapp.com`
     (redirect de produção, não mockado); mensagem decodificada contém nº do pedido, tipo, cliente,
     telefone, observação, subtotal, total; **não** contém "COBRAR DO CLIENTE".
  2. `window.open` mockado para bloquear a 1ª chamada (simula popup-blocker) → tela de contingência
     aparece → clique manual no botão (2ª chamada do mock, sempre permitida) → volta para a tela de
     sucesso.
- **e2e existentes** (`checkout-guest.spec.js`, `checkout-logado.spec.js`, 5 specs) — rodados sem
  nenhuma alteração, todos verdes (a abertura automática não interfere no heading "sucesso" nem no
  restante do fluxo).
- `npm run build` — verde (591 módulos).
- Compatibilidade entrega vs retirada: coberta a nível de golden (`checkout.golden.mjs` C6, `mkCart`
  padrão já usa endereço de entrega); o e2e real de entrega depende de geocoding, deliberadamente fora
  do escopo dos specs de checkout (decisão pré-existente do projeto, ver `StorePage.js`).

Relaciona: [[REF-ORDER-01-fluxo-pedidos-profissional]] (comanda/gaps honestos reaproveitados),
[[REF-CAP-01]] (mecanismo de abertura já homologado no app nativo), [[REF-COMPANY-02]] (nomeCurto sem
hardcode).
