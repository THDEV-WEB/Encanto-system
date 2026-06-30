# REF-APP-01 · Onda 2 — `services/DataService.js`: Plano de Impacto & Não-Regressão (PROPOSTA)

- **Status:** 🟦 **PROPOSTA — NÃO APLICADA.** Recon/design da Onda 2 (§6 do diagnóstico). Pré-requisito: autorização explícita do usuário. Nenhuma extração iniciada.
- **Pertence a:** [REF-APP-01 (DESENHO)](REF-APP-01-modularizacao-appjsx.md) · Onda 2 (risco **alto** — pivô de ~20 consumidores).
- **Baseline:** `main` @ `de482a8` (pós-Onda 1). `DS` vive em `src/App.jsx` ~L41–230 (objeto literal único).
- **Objetivo:** mover o objeto `DS` (Único Ponto de Acesso a Dados) para `src/services/DataService.js`, **move-puro 100%**, preservando `this`, os singletons de cache e os contratos de retorno.

---

## 1. Anatomia do `DataService` (22 métodos + 2 props de estado)

| # | Membro | Tipo | Usa `this` | Usa | Consumido por |
|---|---|---|---|---|---|
| — | `_globalProductsCache` / `_globalProductsCacheTime` | **estado (singleton)** | — | — | interno |
| 1 | `_invalidateProductsCache()` | infra | ✅ caches | — | upsert/toggle/delProd |
| 2 | `run(fn,{throwOnError})` | **infra (pivô)** | — | `db` | TODOS os métodos |
| 3 | `fetchAllProductsSafe(makeQuery)` | infra | ✅ `run` | `PRODUCTS_PAGINATE/PAGE_SIZE` | getProds/getAllProds |
| 4 | `getCats()` | leitura | ✅ `run` | — | useCategories |
| 5 | `getAllCats()` | leitura | ✅ `run` | — | AdminCategorias, AdminProducts |
| 6 | `getProds(catId,search)` | leitura | ✅ caches+`fetchAll` | `PRODUCTS_CACHE_TTL`, **`prodInCat`** | useProducts |
| 7 | `getAllProds()` | leitura | ✅ `fetchAll` | — | AdminProducts |
| 8 | `getAds()` | leitura | ✅ `run` | — | useAdicionais |
| 9 | `getAllAds()` | leitura | ✅ `run` | — | AdminAdicionais |
| 10 | `savePedido(cliente,order,itens,requestId)` | **escrita sagrada** | ✅ `run` | `RPC_TIMEOUT` | CheckoutPage.submit |
| 11 | `getPedidos()` | leitura | ✅ `run` | — | useOrders |
| 12 | `setStatus(id,status)` | escrita | ✅ `run` | — | AdminPedidos |
| 13 | `getHealth()` | leitura | ✅ `run` | — | AdminHealth |
| 14 | `logEvent(module,op,level,msg,payload)` | infra | ✅ `run` | — | useProducts, ImageUploader |
| 15 | `upsertCat(data,id)` | escrita | ✅ `run` | — | AdminCategorias |
| 16 | `delCat(id)` | escrita | ✅ `run` | — | AdminCategorias |
| 17 | `_sanitizeImageUrl(url)` | **pura** | — | — | upsertProd |
| 18 | `upsertProd(data,id)` | **escrita (R5 imagem)** | ✅ `_sanitize`+`run`+`_invalidate` | — | AdminProducts |
| 19 | `toggleProd(id,disp)` | escrita | ✅ `run`+`_invalidate` | — | AdminProducts |
| 20 | `delProd(id)` | escrita | ✅ `run`+`_invalidate` | — | AdminProducts |
| 21 | `upsertAd(data,id)` | escrita | ✅ `run` | — | AdminAdicionais |
| 22 | `delAd(id)` | escrita | ✅ `run` | — | AdminAdicionais |

**Conclusão:** `this` é **pervasivo** (20 dos 22 métodos chamam `this.run`/`this.fetchAll`/`this._*`). ⇒ **R2: manter objeto literal exportado; NUNCA desestruturar métodos.**

---

## 2. Dependências do novo módulo + prova da regra D2

`src/services/DataService.js` precisará importar:

```js
import { db, RPC_TIMEOUT } from '../lib/supabase.js';
import { PRODUCTS_PAGE_SIZE, PRODUCTS_PAGINATE, PRODUCTS_CACHE_TTL } from '../constants/catalogConfig.js';
import { prodInCat } from '../utils/catalog.js';
export const DS = { /* ...objeto byte-exato... */ };
```

**✅ NÃO viola D2** (que proíbe `services/lib/data/constants` de importar `pricing/addons/format`): `DataService` importa só `lib/supabase`, `constants/catalogConfig` e `utils/catalog` — **nenhum é `pricing/addons/format`**. `prodInCat` (utils/catalog) é permitido. Isto **confirma mecanicamente o I-CK3** (DataService = só persistência, não reimplementa domínio) — o `test:deps` D2/G-CK1 continua verde.

**Grafo (acíclico):** `DataService → {lib/supabase, constants/catalogConfig, utils/catalog→format}`. Sem aresta de volta.

---

## 3. Inventário dos ~20 consumidores (call-sites de `DS.*`)

| Consumidor (unidade) | Métodos chamados | Linhas |
|---|---|---|
| `useCategories` (hook) | getCats | 239 |
| `useProducts` (hook) | getProds, logEvent | 296, 311 |
| `useAdicionais` (hook) | getAds | 325 |
| `useOrders` (hook) | getPedidos | 335 |
| `CheckoutPage.submit` | **savePedido** | 865 |
| `AdminCategorias` | getAllCats, upsertCat, delCat | 1092, 1096, 1116 |
| `ImageUploader` | logEvent | 1188 |
| `AdminProducts` | getAllProds, getAllCats, upsertProd, toggleProd, delProd | 1309×2, 1381, 1458, 1465 |
| `AdminAdicionais` | getAllAds, upsertAd, delAd | 1597, 1601, 1624 |
| `AdminPedidos` | setStatus | 1710 |
| `AdminHealth` | getHealth | 2156 |

**~20 call-sites · 11 unidades · 18 métodos distintos.** Todos invocam `DS.metodo(...)` — **nenhum desestrutura** `DS` (a verificar como guard). Como `DS` continua um objeto único importado, **todos os call-sites permanecem byte-idênticos** (zero edição nos consumidores).

---

## 4. Vazamentos de `db` fora do DataService (R3) — inventário fechado

Só **2 componentes** tocam `db` direto (não via DS):

| Componente | Uso | Linhas | Tratamento na Onda 2 |
|---|---|---|---|
| `AdminLogin` | `if(!db)`, `db.auth.signInWithPassword` | 1044, 1047 | **fica no App.jsx**; App.jsx mantém `import { db }` de lib/supabase |
| `ImageUploader` | `if(db)`, `db.storage...upload/getPublicUrl` | 1181, 1185, 1190 | idem |

⇒ Na Onda 2, **App.jsx continua importando `db`** (de `lib/supabase`) para esses dois. Quando forem extraídos (Onda 6), passam a importar `db` deles mesmos. **`RPC_TIMEOUT` sai do import de App.jsx** (só `savePedido` usava → vai p/ DataService); App.jsx mantém `{ db, WHATSAPP, LOGO }`.

---

## 5. Matriz de risco × mitigação

| Risco | Descrição | Mitigação | Guard mecânico |
|---|---|---|---|
| **R2** | quebrar `this` ao soltar métodos | manter **objeto literal** exportado; submit/consumidores chamam `DS.x` | grep: 0 `const {…}=DS` / `…=DS.run` desestruturado; micro-test de `this` |
| **R4** | duplicar/zerar cache singleton | caches são **propriedades do DS** → movem juntas (1 instância) | grep `_globalProductsCache:`=1; micro-test: `upsertProd`→`_invalidateProductsCache` zera cache |
| **R3** | `db` vaza p/ AdminLogin/ImageUploader | App.jsx mantém `import { db }` | grep `\bdb\b`: App.jsx=AdminLogin(2)+ImageUploader(3); DataService=run(2); `createClient`=1 |
| **R5** | gravar `image_url` (legada) no lugar de `imagem_url` | mover `upsertProd`/`_sanitizeImageUrl` **byte-exato** | byte-equiv; grep DataService grava `imagem_url`, nunca `image_url` |
| **R-contrato** | mudar retorno (null/[]/uuid) de algum método | move byte-exato (sem reescrever) | byte-equivalência do objeto inteiro vs baseline |

---

## 6. Estratégia de não-regressão (gates da Onda 2)

1. **Extração byte-exata** do objeto `DS` (slice programático, técnica provada na Onda 1.4 `mockCatalog`) → **byte-identidade vs `de482a8`** (prova `assert.strictEqual`).
2. **Resíduo:** `const DS =` em App.jsx = 0 (só import + pointer); grep das 22 assinaturas = 0 no App.jsx.
3. **Suíte:** `build` + `test:deps` (D2/G-CK1/F/acíclico verdes) + `test:pricing` + `test:addons`.
4. **Micro-test node** (`this` + caches, sem rede): importar `DS`, stubar `db`; verificar (a) `DS._sanitizeImageUrl` (`'data:…'`→null, `'http://x'`→ok, `''`→null); (b) `DS.getCats()` resolve `this.run` e monta `from('categories')`; (c) caminho `upsertProd`→`_invalidateProductsCache` zera `_globalProductsCache`; (d) `DS` é o **mesmo objeto** (sem cópia de métodos).
5. **1 pedido real (checkpoint sagrado):** pós-extração, pedido ponta-a-ponta (`submit`→`savePedido`→`create_order`) com **payload + reconciliação Σ(price×qty)=total + idempotência** idênticos ao baseline. _Dupla blindagem: `submit` não é tocado na Onda 2 e `savePedido` é byte-idêntico._
6. **Testes de banco** (ortogonais): `test:f1b`/`test:rls`/`test:orders-rls` seguem verdes (backend intocado).
7. **Auditoria adversarial independente** (workflow 2 lentes: regressão + integração), como na Onda 1.
8. **Rollback:** `git revert <hash>` (commit único) ou `git reset --hard backup/main-pre-onda-2`.

---

## 7. Passo-a-passo proposto (1 commit)

1. Ponto de restauração: `git branch backup/main-pre-onda-2 HEAD`.
2. `src/services/DataService.js` = header + 4 imports + `export const DS = {…}` (slice byte-exato).
3. App.jsx: `import { DS } from './services/DataService.js'`; remove o objeto `DS` (→ pointer); ajusta `import { db, WHATSAPP, LOGO }` (tira `RPC_TIMEOUT`).
4. Gates §6 (build/deps/pricing/addons + byte-equiv + resíduo + micro-test).
5. 1 pedido real + adversarial.
6. Commit `refactor(ref-app-01): Onda 2 — extrai services/DataService.js`.

> **Reavaliação de risco:** rotulado "alto" no diagnóstico, mas com a técnica da Onda 1 (slice byte-exato + objeto literal preservado + D2 já verde + consumidores intocados) o risco operacional cai para **médio-controlado**. O único ponto que exige atenção humana é o **checkpoint do pedido real** (passo 5), por ser o fluxo sagrado.

> 🟦 **PROPOSTA — aguardando autorização.** Nenhuma extração iniciada.
