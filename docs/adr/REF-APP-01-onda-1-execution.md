# REF-APP-01 · Onda 1 (DOMÍNIO PURO) — Execution Ledger

- **Status:** ✅ **APLICADA (2026-06-30).** Primeira onda de extração da REF-APP-01, autorizada pelo usuário ("inicie a execução da ONDA 1 do REF-APP-01 (DOMÍNIO PURO)"). Move-puro 100%; zero mudança funcional (provada mecanicamente, §4).
- **Pertence a:** [REF-APP-01 — Diagnóstico (DESENHO congelado)](REF-APP-01-modularizacao-appjsx.md) · Onda 1 da §6.
- **Baseline:** `main` @ `0be695d` (== App.jsx do merge F1 `14f0752`, 3866 linhas). **Ponto de restauração:** branch `backup/main-pre-onda-1` @ `0be695d`.
- **Resultado:** `App.jsx` **3866 → 3452 linhas (−414)**; 6 módulos novos; suíte completa verde.

---

## 1. Módulos extraídos (1 módulo = 1 commit, build+testes verdes entre cada)

| # | Commit | Módulo | Símbolos movidos | Validação-chave |
|---|---|---|---|---|
| 1 | `8703394` | `src/lib/supabase.js` | `db` + `SUPA_URL`/`SUPA_KEY`/`WHATSAPP`/`RPC_TIMEOUT`/`LOGO` | `createClient` ÚNICO (grep=1); `db=null` degradado preservado; `export let db` binding vivo |
| 2 | `fd65e6a` | `src/utils/ids.js` | `isUuid`, `newRequestId` | folha pura (sem imports); resíduo 0 |
| 3 | `b89b33e` | `src/utils/catalog.js` | `CAT_EMOJI`/`catEmoji`, `isHttpUrl`, `CATEGORIAS_DESCONTINUADAS`/`isCategoriaDescontinuada`, `prodInCat`, `getProdCatIds` | importa só `norm` (format.js) — D2 ok (utils/ não é camada não-UI); `norm` removido do import de App.jsx |
| 4 | `4773a28` | `src/data/mockCatalog.js` | `MOCK_CATS`[8], `MOCK_PRODS`[45], `filterMock` | **slice byte-exato** (zero transcrição); importa só `prodInCat` (D2 ok) |
| 5 | `cf76ca9` | `src/constants/catalogConfig.js` | `PRODUCTS_PAGE_SIZE`/`PAGINATE`/`CACHE_TTL` | constantes sem imports (D2 trivial) |
| 6 | `175542a` | `src/constants/storage.js` | `STORAGE_KEYS` (12 chaves) — 33 literais `'encanto_*'` inline → `STORAGE_KEYS.X` | **commit próprio**; valor byte-igual; guarda mestra (0 literais órfãos) |

Todos os símbolos extraídos deixaram **pointer-comment** no local (estilo do código, ex. L188 que aponta addons → utils/addons.js).

---

## 2. Escopo — o que ficou de fora da Onda 1 (e por quê)

A §3/§6 do diagnóstico listava `constants/*` genérico (incluindo `checkout.js` e `orderStatus.js`). Decisão de escopo **fiel ao princípio B4 (§10-bis: REF-APP-01 = 100% move-puro, preservar duplicação)**:

| Item | Decisão | Motivo |
|---|---|---|
| `constants/orderStatus.js` (`ORDER_STATUS_MAP`) | ⏸️ **DIFERIDO** | O mapa de status é DUPLICADO no fonte (App.jsx ~L1894 `recebido:{label...}` ≡ ~L1955). Unificá-lo = **consolidação/dedup = classe B4** → proibido nesta fase (REF-APP-02). |
| `constants/checkout.js` (`PAYMENT_METHODS`/`ORDER_STEPS` — o array `pays`@~L1069 e `steps`@~L1201) | ⏸️ **DIFERIDO p/ Onda 5** | São **locais ao CheckoutPage/SuccessPage** (código de negócio). Extrair JUNTO dos componentes na Onda 5 evita tocar o checkout duas vezes. |

`format.js`/`pricing.js`/`addons.js` permanecem folhas sagradas intocadas (NORM-03/04/05).

---

## 3. Gates aplicados em cada passo (§6.1 do diagnóstico)

- **Build** (`vite build`) verde · **`test:deps`** (grafo acíclico, D1/D2/D3, G-CK, regra F) · **`test:pricing`** · **`test:addons`** verdes.
- **Resíduo:** grep do símbolo extraído em App.jsx = **0 definições** (só import + pointer).
- **Equivalência mecânica** (§4).

---

## 4. Prova de ZERO mudança funcional (mecânica)

1. **Byte-identidade do corpo movido vs baseline** (`backup/main-pre-onda-1`), normalizando só o token `export `:
   - supabase(config+db) 676B · ids 737B · catalog(emoji..isHttpUrl) 493B · catalog(categorias) 763B · catalog(prodInCat+getProdCatIds) 1149B · catalogConfig 695B — **todos byte-idênticos**.
   - `MOCK_CATS` (1562B) e `MOCK_PRODS` (13945B) — **byte-idênticos** ao git HEAD (slice puro).
   - `STORAGE_KEYS`: guarda mestra — após o swap, **0 literais `encanto_` remanescentes** ⇒ prova completude E valores byte-corretos (33 substituições; perKey conferido).
2. **Regras-trava (grep no src/):** `createClient(`=1 · `export let db = null`=1 · `db = null;`=2 (export+catch) · `_prodCache = new Map()`=1 · `_globalProductsCache: null`=1 · `STORAGE_KEYS def`=1.
3. **Suíte completa verde** (Onda 1 é frontend; backend intacto): build · `test:deps` · `test:pricing` · `test:addons` · `test:f1b` PASS=23 · `test:rls` PASS=15 · `test:orders-rls` PASS=16.
4. **Auditoria adversarial independente** (workflow `onda1-adversarial-verify`, 2 lentes céticas sobre `git diff backup..HEAD`):
   - **Lente regressão → LIMPO.** Set-diff canonicalizado (strip `export`/comentários; `STORAGE_KEYS.X` re-expandido ao literal antigo; sort) + diff bloco-a-bloco byte-exato (exit 0) de todos os símbolos. Únicas divergências = comentários de cabeçalho/breadcrumb, imports novos e o objeto `STORAGE_KEYS`; **ZERO linha de código com valor alterado** (preço/emoji/regex/operador/default/ordem). 2 achados só `info` (live-binding do `db`; remoção do `norm` não-usado) — corretos.
   - **Lente integração → LIMPO.** 18 imports todos usados (0 import morto), cada módulo exporta o que App.jsx consome; singletons (createClient 1×, `db`, `_prodCache`, `_globalProductsCache`) preservados; D2 e F confirmados por `test:deps`; grafo acíclico; build (113 módulos) + `test:deps` OK; 0 resíduo das 22 assinaturas movidas.

> **Veredito adversarial: ✅ MOVE-PURO CONFIRMADO** (ambas as lentes LIMPO; nenhum achado de severidade alta/média/baixa).

---

## 5. Rollback

- **Por módulo:** `git revert <hash>` (cada commit é isolado e reversível).
- **Fase inteira:** `git reset --hard backup/main-pre-onda-1` (== `0be695d`).

---

## 6. Próximo passo (NÃO iniciado)

Onda 2 (§6): `services/DataService.js` (objeto literal, preserva `this`; **alto risco** — pivô de ~20 consumidores). Aguarda autorização explícita do usuário. INV-CK e B2 (golden de checkout) seguem como pré-condição dos passos que tocam o checkout (Onda 5).
