# REF-APP-01 · B2 — Golden de payload do checkout (PROPOSTA)

- **Status:** 🟢 **GOLDEN APLICADO E VERDE** (`tests/checkout.golden.mjs`) · ✅ **ONDA 5 CONCLUÍDA — Trilha B** (order-domain), subfases 5.0→5.4 executadas (2026-07-09; ver **"Decisão (2026-07-07)"** e a tabela de subfases abaixo). O habilitador **§3.1** (`utils/orderPayload.js`) foi **extraído** (5.2, `e5ae1a2`); `submit` e resumo passaram a consumir o order-domain, e `test:checkout` seguiu **verde** (moveu, não alterou).
- **Pertence a:** [REF-APP-01 (DESENHO congelado)](REF-APP-01-modularizacao-appjsx.md) · achado **B2** (validação do checkout era 100% manual).
- **Objetivo:** trocar a única garantia anti-regressão do fluxo sagrado (`create_order` + idempotência + mensagem WhatsApp) — hoje "1 pedido real" manual, não reproduzível — por um **teste automatizado sem dependência de banco real**.
- **Atualização (2026-07-06) — golden MATERIALIZADO (`tests/checkout.golden.mjs` · `npm run test:checkout`):** na etapa pré-Onda 2 o golden foi implementado **sem o habilitador do §3.1** (a extração de `buildOrderArgs` para `utils/orderPayload.js` segue **gated**, pois altera o `submit`). Em vez disso: **(A)** builders-espelho fiéis + domínio REAL (`pricing`/`ids`/`format`) congelam as 7 asserções da §3.2; **(B)** *pin de fonte* trava a montagem real do `submit`/`savePedido` em `App.jsx`. **VERDE.** Na Onda 5, ao extrair `orderPayload.js`, troca-se o espelho pelo import real (o pin de fonte garante que ambos coincidem). Ver `REF-APP-01-onda-2-plan.md` §9.3.

### Decisão (2026-07-07) — Onda 5 AUTORIZADA · **Trilha B (order-domain)**

Autorização formal do usuário: executar a **Onda 5 exclusivamente pela Trilha B**, honrando o **INV-CK**. O habilitador da **§3.1** (`utils/orderPayload.js`) está **desbloqueado**: extrair, por composição fiel (move da lógica, sem reescrever), as três funções puras **`buildOrderArgs`**, **`buildWhatsAppMessage`** e **`buildCheckoutView(cart)`** (esta última tira a formatação do resumo de dentro do componente → `components/checkout/**` deixa de importar `pricing/format` direto e satisfaz **G-CK2**). O order-domain vive em `utils/` (folha de domínio; entra na allowlist **D1**), nunca em `services/` (barrado pela D2).

**Subfases (nesta ordem, uma por commit — sem push, sem squash):**

| Sub | Objetivo | Arquivos-alvo | Gate |
|---|---|---|---|
| **5.0** ✅ (`5668e32`) | Registrar Trilha B (este bloco) | `docs/adr/REF-APP-01-B2-checkout-golden.md` | revisão humana |
| **5.0.5** ✅ (`b4f2b3d`) | Baseline — congelar estado inicial do checkout (evidência pré-mudança) | doc de baseline | evidência registrada |
| **5.1** ✅ (`3350ab3`) | Extrair `SuccessPage` | `components/checkout/SuccessPage.jsx` + `App.jsx` | build · suíte verdes |
| **5.2** ✅ (`e5ae1a2`) | Extrair order-domain; `submit` passa a consumi-lo | `utils/orderPayload.js` + `App.jsx` + `tests/checkout.golden.mjs` | test:checkout (espelho→import real + pins B) · test:deps (G-CK3) · suíte |
| **5.3** ✅ (`e4985e8`) | Extrair `CheckoutPage` consumindo o order-domain | `components/checkout/CheckoutPage.jsx` + `App.jsx` + testes | test:deps (D1 + G-CK2) · test:checkout (pins B) · comportamento preservado |
| **5.4** ✅ (`796098c` + este commit) | Limpeza de resíduo (19 imports órfãos) + reconciliação documental | `App.jsx` + docs | auditoria de resíduo · suíte 7/7 |

**Invariantes preservados (móvel, nunca alterado):** `DS.savePedido`, RPC `create_order`, `useCart`, regras de fidelidade e o **gate de persistência** permanecem **intocados**; **payload**, **mensagem WhatsApp** e **resumo** ficam **funcionalmente idênticos** (o `test:checkout` congela byte-a-byte). Bug incidental é **apenas registrado**, nunca corrigido nesta onda. Qualquer divergência estrutural, quebra de teste ou necessidade de mudar regra de negócio **interrompe a execução** e exige nova autorização. Cada subfase é aprovada individualmente antes da seguinte.

---

## 1. De onde vem o payload (fonte verificada)

O `CheckoutPage.submit` ([App.jsx:1075-1137](../../src/App.jsx#L1075-L1137)) monta **4 argumentos** e chama `DS.savePedido(cliente, order, itens, requestId)` ([App.jsx:1089-1106](../../src/App.jsx#L1089-L1106)), que repassa para a RPC `create_order(p_customer, p_order, p_items, p_request_id)` ([App.jsx:320-323](../../src/App.jsx#L320-L323)). A montagem é **pura** em função de `(cart, form, requestId)` — as partes impuras (`newRequestId`, `localStorage` do `encanto_req_id` e da fidelidade, `cart.clear()`, `onSuccess`) **não entram no payload** e ficam fora do golden.

| Arg | Forma | Fonte |
|---|---|---|
| `p_customer` | `{ name, phone }` | `form.nome`, `form.telefone` |
| `p_order` | `{ total, status:'recebido', payment_method, address, observacoes }` | `cart.total`, `form.pagamento`, `form.endereco`, `form.obs\|\|null` |
| `p_items[]` | `{ product_id, nome_produto, quantity, price, preco_unitario, adicionais, observacoes }` | `cart.items` + `precoUnitario(i)` (domínio); `product_id = isUuid(i.id) ? i.id : null` |
| `p_request_id` | uuid (idempotency key) | injetado (mock no golden; `newRequestId`/localStorage em produção) |

---

## 2. Payload mínimo proposto (números REAIS — gerados pelo PoC, domínio real)

Fixtures determinísticas: 1 item **uuid** com 2 adicionais pagos (qty 2) + 1 item **mock não-uuid** (qty 1).

```json
{
  "p_customer": { "name": "Maria Teste", "phone": "38999990000" },
  "p_order": { "total": 56, "status": "recebido", "payment_method": "pix",
               "address": "Rua A, 100, Centro", "observacoes": "sem cebola" },
  "p_items": [
    { "product_id": "11111111-1111-4111-8111-111111111111", "nome_produto": "Açaí 500ml",
      "quantity": 2, "price": 22, "preco_unitario": 22,
      "adicionais": [{ "nome": "Leite Ninho", "preco": 2 }, { "nome": "Granola", "preco": 2 }],
      "observacoes": "sem cebola" },
    { "product_id": null, "nome_produto": "Batidinha Morango",
      "quantity": 1, "price": 12, "preco_unitario": 12, "adicionais": [], "observacoes": null }
  ],
  "p_request_id": "00000000-0000-4000-8000-000000000001"
}
```

`price` = `precoUnitario` (18 base + 2 + 2 adicionais = 22). `total` = `totalCarrinho` (44 + 12 = 56). Mensagem WhatsApp correspondente também é congelada (string multilinha determinística).

---

## 3. Critério de validação automatizado (sem banco)

### 3.1 Habilitador (extração mínima e fiel — ✅ **EXTRAÍDO na Onda 5.2 · Trilha B** (`e5ae1a2`), autorizado 2026-07-07)
Extrair do corpo do `submit`, **sem reescrever a lógica** (move puro das expressões), duas funções puras:

```js
// src/utils/orderPayload.js  — camada de DOMÍNIO (NÃO services/; ver INV-CK e regra D2 da Onda 0)
export function buildOrderArgs(cart, form, requestId) { /* monta p_customer/p_order/p_items/p_request_id */ }
export function buildWhatsAppMessage(cart, form) { /* monta a string do WhatsApp */ }
export function buildCheckoutView(cart) { /* INV-CK/I-CK2: linhas formatadas + total p/ o resumo — tira a formatação do componente */ }
```

⚠️ **Localização: `utils/`, não `services/`.** O builder **compõe** `pricing/addons/format`; a **regra D2 (Onda 0)** proíbe `services/lib/data/constants` de importar lógica pura/domínio → sob `services/` o `test:deps` reprovaria. Em `utils/` (folha de domínio) a composição é válida; o módulo entra na allowlist **D1** ao ser criado. Este order-domain é a **fonte única de verdade** do pedido — ver **[INV-CK](REF-APP-01-modularizacao-appjsx.md#1-bis-inv-ck--invariante-estrutural-do-domínio-de-checkout-regra-rígida-não-convenção)**.

O `submit` passa a **chamar** essas funções (em vez de montar inline) — então, por construção, o que vai para `DS.savePedido` é exatamente o que o golden congela. Pelo **INV-CK**, o `submit` é **só orquestração** (sem cálculo/formatação) e o `DataService` **não reimplementa** o domínio (já barrado pela D2). `buildOrderArgs` recebe `requestId` por parâmetro (não chama `newRequestId`), permanecendo determinística.

### 3.2 Golden — `tests/checkout.golden.mjs` (`npm run test:checkout`)
ESM `node` autocontido, no padrão dos goldens existentes (`pricing.golden.mjs`/`addons.golden.mjs`): importa o domínio real (`pricing.js`) e os builders; **não toca banco, rede, React nem localStorage**. Asserções:

1. **Snapshot do payload** — `deepStrictEqual(buildOrderArgs(cart, form, REQ), GOLDEN_PAYLOAD)` (byte-a-byte).
2. **Snapshot da mensagem** — `strictEqual(buildWhatsAppMessage(cart, form), GOLDEN_MSG)`.
3. **Reconciliação** — `Σ(p_items.price × quantity) === p_order.total` (invariante do comentário [App.jsx:1087](../../src/App.jsx#L1087)).
4. **`product_id`** — uuid preservado; id de mock (não-uuid) → `null`.
5. **Idempotência (passthrough)** — `p_request_id === REQ` injetado (zero aleatoriedade no builder).
6. **Pureza/idempotência** — 2ª montagem `deepStrictEqual` à 1ª.
7. **Contratos null** — `adicionais || []`, `observacoes || null` preservados.

Adicionar fixtures de borda na suíte cumulativa: item com adicionais grátis (cota), `troco` preenchido, `obs` vazio, carrinho vazio (se aplicável).

### 3.3 Evidência (PoC já executado, read-only)
O PoC importou `pricing.js`/`format.js` reais e a montagem fiel → produziu o payload da §2 e **passou as 7 asserções** sem nenhuma dependência de banco. Confirma a viabilidade.

---

## 4. O que o golden NÃO cobre (e como é tratado)

- **Aleatoriedade do `newRequestId`** e **durabilidade do `encanto_req_id` no localStorage** — fora do payload puro; o builder recebe `requestId` pronto. A persistência/retry é comportamento do `submit`, validado na extração do checkout (Onda 5) e/ou por um teste de stub.
- **"O `submit` realmente chama `savePedido` com esses args"** — garantido por construção (o `submit` passa a chamar `buildOrderArgs`); opcionalmente reforçado por um teste que **stuba `DS.savePedido`** e captura o argumento, comparando ao golden (sem banco). Esse stub-test é leve e pode entrar junto na Onda 5.
- **Incremento de fidelidade, `cart.clear()`, `onSuccess`** — efeitos colaterais do `submit`, fora do escopo do payload; preservados como move puro.

---

## 5. Como o B2 entra na fase de execução

- O golden (`test:checkout`) é **congelado ANTES** de extrair o `CheckoutPage` (passo da Onda 5).
- A extração do checkout (e qualquer passo que toque a montagem do pedido) deve manter `test:checkout` **verde**.
- O golden vira parte da suíte cumulativa (`test:pricing`/`addons`/`deps`/**`checkout`**), rodada a cada commit da fase.
- **Nenhuma mudança de comportamento:** o golden trava o payload atual; a extração só pode mover, nunca alterar.

> 🟢 **B2 — GOLDEN APLICADO (VERDE).** Payload mínimo + critério automatizado sem banco materializados em `tests/checkout.golden.mjs`. ✅ **Onda 5 CONCLUÍDA (Trilha B):** o habilitador §3.1 (`utils/orderPayload.js`) foi extraído (5.2, `e5ae1a2`); `SuccessPage` (5.1, `3350ab3`) e `CheckoutPage` (5.3, `e4985e8`) extraídos; a limpeza 5.4 (`796098c`) removeu os imports órfãos residuais. `test:checkout` permaneceu **verde** em todas as subfases (moveu, nunca alterou).
