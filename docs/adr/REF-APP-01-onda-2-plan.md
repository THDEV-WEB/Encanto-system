# REF-APP-01 · Onda 2 — `services/DataService.js`: Plano de Impacto & Não-Regressão (PROPOSTA)

- **Status:** 🟦 **PROPOSTA — NÃO APLICADA.** Recon/design da Onda 2 (§6 do diagnóstico). Pré-requisito: autorização explícita do usuário. Nenhuma extração iniciada.
- **Pertence a:** [REF-APP-01 (DESENHO)](REF-APP-01-modularizacao-appjsx.md) · Onda 2 (risco **alto** — pivô de ~20 consumidores).
- **Baseline:** `main` @ `de482a8` (pós-Onda 1). `DS` vive em `src/App.jsx` ~L41–230 (objeto literal único).
- **Objetivo:** mover o objeto `DS` (Único Ponto de Acesso a Dados) para `src/services/DataService.js`, **move-puro 100%**, preservando `this`, os singletons de cache e os contratos de retorno.
- **Atualização (2026-07-05):** incorporados aprendizados da **Estabilização de Produção** (Catálogo Offline, commit `b2ff9ac`, pushado) — ver **§8**. Não altera o desenho da Onda 2; apenas acrescenta evidências de produção que reforçam/complementam os riscos (§5) e gates (§6). Onda 2 permanece 🟦 PROPOSTA, aguardando autorização.

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

---

## 8. Aprendizados da Estabilização de Produção (Catálogo Offline · 2026-07-05)

> **Contexto:** atividade *"Estabilização — Catálogo Offline"* — auditoria `mockCatalog.js` × Supabase + alinhamento GRUPO A (preços/descrições/imagens/cosmético de categoria), commit `b2ff9ac` (pushado; foi ao ar junto com o fix crítico de checkout `9b8f7ac`). Esta seção **não altera o move-puro da Onda 2**; incorpora evidências de produção que reforçam/complementam os riscos (§5) e a estratégia de não-regressão (§6).

> **Estado de referência (Baseline):** as evidências, riscos e recomendações desta §8 refletem o estado do sistema **após** a estabilização de produção, composta pelos commits:
>
> - `9b8f7ac` — correção crítica do checkout (gate de persistência);
> - `35e7b05` — formalização do REQ-01 (telefone válido para entrega);
> - `b2ff9ac` — estabilização do catálogo offline (`mockCatalog.js`).
>
> Este conjunto é o **baseline arquitetural da futura Onda 2**: todas as conclusões desta seção são válidas a partir dele — âncora temporal para auditorias futuras, evitando dúvida sobre a partir de qual estado do sistema estas análises valem.
>
> **Coerência com o baseline técnico do move-puro:** o objeto `DS` permanece **byte-idêntico desde `de482a8`** (o baseline do slice citado no cabeçalho, §5 e §6) — **nenhum** dos 3 commits acima tocou o objeto `DS`: o fix de checkout alterou `CheckoutPage.submit` (~L839–979), o REQ-01 alterou docs/scripts, e a estabilização, `data/mockCatalog.js`. Logo, o **baseline técnico da byte-equivalência (`de482a8`) segue válido** e inalterado; este Baseline é a âncora **temporal das evidências**, não uma mudança do ponto de extração do move-puro.

### 8.1 — R5 validado em produção (`imagem_url` viva × `image_url` legada)
A auditoria confirmou **empiricamente** no banco de produção: a coluna legada `image_url` permanece **populada em 10 linhas** de `products` (todas de `c7` + "Marmita com Suco"), enquanto `imagem_url` (viva) é a fonte correta; **nenhuma** linha tem `imagem_url` vazia com `image_url` preenchida (o bug órfão de imagem **não** está presente). ⇒ Eleva a confiança no **R5**: `upsertProd`/`_sanitizeImageUrl` devem seguir gravando/lendo **`imagem_url`, nunca `image_url`**. O move-puro byte-exato preserva esse comportamento; o guard de R5 (grep "grava `imagem_url`, nunca `image_url`") continua válido e **agora tem evidência de produção**.

### 8.2 — Técnica de não-regressão re-validada (byte-controle + conformidade)
A estabilização aplicou o mesmo padrão previsto no §6 (slice/patch programático byte-controlado + **asserção de âncoras** que aborta se algum alvo não casa exatamente) e adicionou uma **auditoria de conformidade** que compara `BEFORE→AFTER` campo-a-campo e exige que o conjunto de campos alterados seja **exatamente** o planejado — **nada a mais** (pega regressão colateral) e **nada a menos** — além de conferir cada valor contra o banco online. Resultado: diff de 23 linhas, 0 regressões, suíte + conformidade verdes. ⇒ **Recomendação para a Onda 2:** somar ao gate de byte-equivalência (§6.1) um check explícito *"diff `BEFORE→AFTER` do objeto `DS` == 0 mudanças de campo/contrato"* (um move-puro não deve alterar nenhum valor). A técnica está agora **provada em produção** (`b2ff9ac`), além da Onda 1.4 (`mockCatalog`).

### 8.3 — Paridade fallback × online estabilizada
`App.jsx` usa `MOCK_PRODS`/`MOCK_CATS` (`data/mockCatalog.js`) como **fallback** quando `DS.getProds`/`DS.getAllCats` retornam vazio/erro (App.jsx L243/254, L1328–1332). A estabilização **alinhou esse fallback ao banco**, reduzindo o risco de **divergência visível** caso o fallback ative durante/após a extração da Onda 2. Nota de arquitetura: o `DataService` é o caminho **primário**; o fallback é secundário e **não** faz parte do move-puro — mas sua paridade com produção está agora muito melhor.

### 8.4 — Complemento à Matriz de Risco (§5) — dois itens a incorporar
| Risco | Descrição | Mitigação / Guard | Situação |
|---|---|---|---|
| **R-checkout** (severidade **máxima**) | o fluxo sagrado `submit → savePedido → create_order` é o de maior impacto do `DataService` | `savePedido` move **byte-idêntico** + `submit` **não** é tocado na Onda 2 + **1 pedido real ponta-a-ponta** (§6.5 = gate humano indispensável) | mitigação já prevista; a estabilização levou à produção o fix de persistência do checkout (`9b8f7ac`), **reafirmando** este como o risco a vigiar |
| **R-cache-2** (`_prodCache` do `useProducts`) | além de `_globalProductsCache` (prop do `DS`, coberto por **R4**), o hook `useProducts` mantém um 2º singleton `_prodCache` (`Map` de módulo, App.jsx L264) **fora** do `DataService` | a Onda 2 (move-puro do `DS`) **não o toca**; registrar para **não duplicar/confundir** cache na extração e nas ondas seguintes | `useProducts` só migra em onda posterior; nenhuma ação na Onda 2 além de **não** mover este cache junto |

### 8.5 — Estado dos dados que o `DataService` serve (contexto, não é código)
A auditoria mapeou, no banco lido por `DS.getProds`/`getAllProds`: **2 colisões** `unique_nome_categoria` (Encanto Mineiro `c4`+`c8`; Marmita G 2 prot. `c1`+`c2`) e **3 produtos com `preco=0`** (cadastro incompleto: as "Marmita Especial"). São questões de **dados** (GRUPO B, decisão de negócio pendente), **não** de código do `DataService` — não afetam o move-puro. Registrado aqui para que, ao rodar a Onda 2, esses retornos "estranhos" de `getProds` **não sejam confundidos com regressão** da extração.

> 🟦 **PROPOSTA — aguardando autorização.** Nenhuma extração iniciada.
