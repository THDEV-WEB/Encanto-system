# REF-APP-01 · Onda 5 — BASELINE do Checkout (subfase 5.0.5)

- **Status:** 🧊 **BASELINE CONGELADO** — subfase preparatória (5.0.5). **Nenhum código/teste/config alterado.** Só registro de estado inicial. · ✅ **ONDA 5 CONCLUÍDA (2026-07-09):** subfases 5.1→5.4 executadas e medidas contra estas âncoras (§6); as âncoras de bytes abaixo permanecem como registro histórico do ponto de partida.
- **Data:** 2026-07-07
- **HEAD no congelamento:** `5668e32` (branch `main`, ahead 21 de `origin/main`; sem push)
- **Propósito:** fixar o estado do checkout ANTES da primeira alteração de código, servindo de âncora de comparação para todas as subfases 5.1→5.4 (Trilha B). Ver a decisão em [REF-APP-01-B2-checkout-golden.md](REF-APP-01-B2-checkout-golden.md#decisão-2026-07-07--onda-5-autorizada--trilha-b-order-domain).

---

## 1. Método de hash (reproduzível)

`sha256` (hex) sobre texto **UTF-8**, cópia de trabalho em **LF**. Regiões = linhas 1-indexadas **inclusivas** de `src/App.jsx`, unidas por `\n`, sem newline final. Script de referência: `scratchpad/baseline_hash.mjs` (efêmero; a fórmula acima basta para regerar).

`src/App.jsx` no baseline: **2879 elementos de linha** (2878 linhas + última vazia) · `sha256(arquivo inteiro) = 44f1d4159b6c839d6de41c4672c8cfabe798f832134cbf5201c4d7efedae1272`.

---

## 2. Âncoras de bytes das regiões do checkout

| Região | Linhas | Nº linhas | Bytes | sha256 | 1ª linha / última linha |
|---|---|---|---|---|---|
| **R1 · `SuccessPage`** | L230-292 | 63 | 2700 | `62be5fbcff9354900d0fa544818779825dfdccdc7873aad507c827ac62a50cb3` | `function SuccessPage({ msg, cart, onBack }) {` … `}` |
| **R2 · `CheckoutPage`** | L79-228 | 150 | 7966 | `33e3926c3638f2e3aa0a918e478fc0dc8fd572603ec3f21c5206f00e60b75fc7` | `function CheckoutPage({ cart, onBack, onSuccess }) {` … `}` |
| **R3 · `submit`** (subconjunto de R2) | L92-170 | 79 | 4472 | `318ee9f237ee746edcdaa595b051d7864e17103065714c88865fd7c4f3ff30e1` | `const submit = async () => {` … `};` |
| **RESTO** (App.jsx menos L79-292) | 1-78 + 293-fim | 2665 | 125219 | `041f814829d9ec706952b727f57af54dd2ce25bd126f98e344cf97a234e0549b` | — |

**Router (wiring):** `App.jsx` L2035-2036 (`page==='checkout'`→`CheckoutPage`; `page==='success'`→`SuccessPage`). `cart` injetado por `StoreApp` (`const cart = useCart()`, L2022).

### 2.1 Natureza de cada âncora (crítico — o que se preserva e como)

- **R1 (`SuccessPage`)** → **move-puro byte-idêntico** esperado na 5.1. Não toca o order-domain (usa só `WHATSAPP`/`Math.random`/`window.open`). **Anchor de igualdade forte:** o corpo extraído deve reproduzir R1 verbatim.
- **R2/R3 (`CheckoutPage`/`submit`)** → **serão intencionalmente refatorados** (Trilha B): na 5.2 o `submit` deixa de montar inline e passa a **chamar** `buildOrderArgs`/`buildWhatsAppMessage`; na 5.3 o resumo passa a consumir `buildCheckoutView`. **Portanto R2/R3 NÃO permanecem byte-idênticos.** O que se preserva é o **comportamento**, provado pelo contrato §4 (`test:checkout` byte-a-byte) + `test:deps` (G-CK2/G-CK3/D1). R2/R3 aqui documentam o ponto de partida.
- **RESTO** → **deve permanecer verbatim.** No fim da 5.4, removendo do `App.jsx` final apenas os comentários-ponteiro do checkout, o remanescente deve reproduzir o conteúdo do RESTO (nenhuma alteração colateral fora do checkout).

---

## 3. Dependências do checkout (grafo no baseline)

`CheckoutPage`+`SuccessPage` são **autocontidas** (nenhuma função do escopo `App`/`StoreApp`). Imports usados:

| Símbolo | Origem | Usado por |
|---|---|---|
| `useState`, `useRef` | `react` | ambos |
| `DS.savePedido` | `services/DataService.js` | submit |
| `precoUnitario` (via `puComAdic`), `precoLinha` | `utils/pricing.js` | submit + resumo |
| `fmt` | `utils/format.js` | resumo + msg |
| `isUuid`, `newRequestId` | `utils/ids.js` | submit |
| `STORAGE_KEYS` (`REQ_ID`, `LOYALTY_*`) | `constants/storage.js` | submit |
| `WHATSAPP` | `lib/supabase.js` | `SuccessPage` |
| `cart` (prop) | `useCart()` via `StoreApp` | ambos |
| RPC `create_order` (via `DS.savePedido`) | Supabase | submit |

**Não usa** `addons.js` (cálculo de adicionais já embutido em `precoUnitario`), nenhum context. Observação registrada (bug incidental, **não corrigir**): `SuccessPage` recebe prop `cart` e **não a usa** (L230-292) — preservar como está.

---

## 4. Contrato comportamental CONGELADO (deve permanecer funcionalmente idêntico)

Fonte: `tests/checkout.golden.mjs` (`npm run test:checkout`), fixtures determinísticas (1 item uuid c/ 2 adicionais pagos qty2 + 1 item mock qty1; `FORM` pix). Estes valores **não podem mudar** em nenhuma subfase da Onda 5:

**4.1 Payload (`p_customer`/`p_order`/`p_items`/`p_request_id`)** — `total=56`; item1 `price=preco_unitario=22`, `product_id` uuid preservado; item2 `price=12`, `product_id=null`, `adicionais=[]`, `observacoes=null`. Snapshot completo em `GOLDEN_PAYLOAD` (test:checkout §A).

**4.2 Mensagem WhatsApp** — `GOLDEN_MSG` (multilinha determinística; item1 `— ${fmt(44)}`, item2 `— ${fmt(12)}`, `Total: ${fmt(56)}`).

**4.3 Resumo na tela** (o que `buildCheckoutView(cart)` deverá reproduzir na 5.2/5.3, para a mesma fixture):
- linhas: `[{ label: "Açaí 500ml x2", valor: fmt(44) }, { label: "Batidinha Morango x1", valor: fmt(12) }]`
- total: `fmt(56)`
- (label = `${i.nome} x${i.qty}`; valor = `fmt(precoLinha(i))`; total = `fmt(cart.total)` — markup renderizado idêntico).

**4.4 Pins de fonte (11)** que `test:checkout` trava hoje em `App.jsx` (submit) + `DataService.js` (savePedido):
`status:'recebido'` · `total:cart.total` · `observacoes:form.obs||null` · `product_id:isUuid(i.id)?i.id:null` · `price:pu` · `preco_unitario:pu` · `adicionais:i.adicionais||[]` · `observacoes:i.obs||null` · `const pu=puComAdic(i)` · `d.rpc('create_order',{` · `p_customer:cliente,p_order:order,p_items:itens,p_request_id:requestId??null`.
Na 5.2/5.3 os pins do **submit** passam a ler o novo arquivo (order-domain / `CheckoutPage.jsx`); os pins de `savePedido` seguem em `DataService.js` (intocado).

**4.5 Invariantes intocáveis (móvel, nunca alterado):** `DS.savePedido`, RPC `create_order`, `useCart`, regras de fidelidade e o **gate de persistência** (`if(!orderId){...return}`) permanecem **byte-equivalentes**.

---

## 5. Estado da suíte no baseline (todos verdes · exit 0)

| Gate | Baseline | Guarda relevante p/ Onda 5 |
|---|---|---|
| `test:deps` | ✅ | G-CK1 ativo; **G-CK2/G-CK3 inertes** (não há `components/checkout/` nem `utils/orderPayload.js` ainda); allowlist D1 atual = `App.jsx`, `hooks/useAdicionais`, `hooks/useCart`, `ProductCard`, `ProductModalInner`, `CartSidebar` |
| `test:pricing` | ✅ | domínio real usado pelo checkout |
| `test:addons` | ✅ | — |
| `test:checkout` | ✅ | contrato §4 (espelho + pins) |
| `test:ds-micro` | ✅ | R2/R4/R5 do `DS` (garante `savePedido` intocado) |
| `test:render` | ✅ | 6 folhas congeladas (checkout entra como smoke manual) |

`build` (Vite): não afetado por esta subfase (doc-only); será gate a partir da 5.1.

---

## 6. Checklist de reconciliação por subfase (como o baseline será usado)

- ✅ **5.1 (`SuccessPage`)** (`3350ab3`): corpo extraído == **R1** verbatim (sha256 da região movida conferido contra o baseline); build + suíte verdes.
- ✅ **5.2 (`orderPayload`)** (`e5ae1a2`): `test:checkout` trocou espelho→import real e seguiu **byte-a-byte igual** a §4.1/§4.2; `buildCheckoutView` fornece §4.3; G-CK3 (order-domain puro) verde; pins do submit repontados para `utils/orderPayload.js`.
- ✅ **5.3 (`CheckoutPage`)** (`e4985e8`): G-CK2 verde (checkout não importa `pricing/format` direto) + D1 atualizada; `test:checkout` verde (pins B); comportamento preservado.
- ✅ **5.4 (limpeza de resíduo + reconciliação documental):** **5.4a** (`796098c`) removeu 19 imports órfãos comprovados do `App.jsx` (só linhas de import; **comentários-ponteiro preservados** — diferente do plano inicial, que previa removê-los); a auditoria de resíduo confirmou **zero definições remanescentes** das extrações; suíte **7/7 verde**. **5.4b** (este commit) reconcilia os 4 docs de status da Onda 5.

> ✅ **Onda 5 CONCLUÍDA (2026-07-09).** As subfases 5.1→5.4 foram executadas e medidas contra estas âncoras (verificações da §6 satisfeitas; suíte **7/7 verde**; `App.jsx` 2878→2668 linhas). Este baseline permanece **congelado** como registro histórico do ponto de partida.
