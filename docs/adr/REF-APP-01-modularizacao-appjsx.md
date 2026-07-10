# REF-APP-01 — Diagnóstico de Modularização do `App.jsx` (DESENHO)

- **Status:** ▶️ **EM EXECUÇÃO — desenho ratificado/congelado (2026-06-30) e execução autorizada.** Este é o diagnóstico arquitetural da REF-APP-01. As pré-condições (Onda 0 + congelamento explícito) foram cumpridas e a execução está em andamento: **Onda 0** (`1b55379`), **Onda 1** (`8703394`…`175542a`), **Onda 2** (`3643c9d`/`09aff7c`), **Onda 3** (`4d30541`…`a5194e8`), a **rede R9 `test:render`** (`39615c9`), **Onda 4** (folhas visuais, `e1164cd`…`f4c5b12`) **Onda 5** (checkout · Trilha B, `3350ab3`/`e5ae1a2`/`e4985e8` + limpeza 5.4 `796098c`), **Onda 6** (admin catálogo/auth/upload, `789459d`…`4c721a8`), **Onda 7** (admin operações + barrel `AdminPanel`, `333e1d5`…`7f07bfb`) e **Onda 8** (componentes isolados da loja `SearchBar`/`AddressModal`, `2ea1e03`/`0acea12`) **aplicadas** (2026-07-06→10); `App.jsx` 3866→998 linhas; suíte 7/7 verde. **Próxima:** Onda 9 (núcleo `StoreApp`). O desenho e as decisões deste documento permanecem como registrados — este cabeçalho apenas reconcilia o estado de execução.
- **Pré-condição obrigatória (B1):** o achado **B1** (§5) é tratado como **pré-condição bloqueante da fase**. O `test:deps` (regra D) não pode depender de importers rígidos do `App.jsx` — isso inviabiliza refatoração incremental. A Onda 0 deve ser proposta, ratificada e aplicada **antes** de qualquer congelamento de execução.
- **Baseline:** `main` @ `14f0752` (pós-merge do bloco F1; suíte verde). `src/App.jsx` = **3866 linhas**, ~40 unidades top-level num único componente-arquivo.
- **Objetivo da fase:** quebrar o monólito `App.jsx` em módulos coesos **com ZERO mudança funcional**, preservando integralmente os ADRs, a arquitetura de domínio (NORM-03/04/05) e a estabilidade.
- **Método deste recon:** workflow read-only — 10 leitores paralelos mapearam o arquivo, 1 síntese desenhou a decomposição, 2 críticos adversariais (acoplamento; ordem/validação) endureceram o plano. Afirmações-chave verificadas contra o fonte (citadas abaixo).

---

## 1. Princípios invioláveis da fase

1. **Cada extração é um MOVE puro** (recortar-e-colar do corpo, sem reescrever lógica) + ajuste de imports/exports. **1 unidade extraída = 1 commit** (a "onda" agrupa, o commit é por módulo).
2. **Domínio é sagrado:** `utils/pricing.js`, `utils/addons.js`, `utils/format.js` permanecem **folhas puras intocadas** (contratos NORM-03/04/05; guardas `test:pricing`/`test:addons`/`test:deps`).
3. **Checkout é sagrado:** `create_order` (RPC), `request_id`, idempotência e o payload `{p_customer,p_order,p_items,p_request_id}` são copiados **sem edição**. A **ausência de try/catch** no submit é comportamento existente — fica como está.
4. **Preservar bugs e código morto deliberadamente** (refatorá-los = mudança funcional proibida nesta fase): ver §8.2.
5. **Validação por passo:** `build` (vite) + `test:pricing` + `test:addons` + `test:deps` verdes + (a partir da Onda 4) **`test:render`** + (no checkout) **`test:checkout`** + (nos passos de I/O) **1 pedido real** preservado vs baseline. Mais os **gates de resíduo e equivalência** da §6.1.
6. **Invariante estrutural do domínio de checkout (INV-CK):** regra rígida do refactor — ver §1-bis. Submit = orquestração; cálculo/formatação/derivação do pedido = exclusivamente nos builders; DataService = persistência. **Sem duplicação de domínio** entre os três.

---

## 1-bis. INV-CK — Invariante estrutural do domínio de checkout (regra rígida, não convenção)

- **Status:** ✅ **FORMALMENTE ACEITO E ESTRUTURALMENTE ELIMINADO O RISCO (2026-06-30, commit `937b6e6`).** Invariante crítico da REF-APP-01, ratificado pelo usuário. O risco de duplicação **não depende de convenção** — é barrado por `test:deps` (G-CK1/G-CK2/G-CK3).
- **Bloqueio de progressão:** **nenhuma Onda 1 inicia** enquanto não estiverem satisfeitos: (1) INV-CK aceito ✅; (2) order-domain validado como fonte única de verdade ✅ (§validação); (3) risco de duplicação estruturalmente eliminado ✅ (guards vivos).

A extração de `buildOrderArgs` e `buildWhatsAppMessage` (B2) **formaliza o core de domínio do pedido fora do React** — passa a ser a **fonte única de verdade** do domínio de checkout. Separação obrigatória de responsabilidades:

| ID | Regra |
|---|---|
| **I-CK1** | O **order-domain** (`buildOrderArgs`, `buildWhatsAppMessage`) é a **fonte única de verdade**: todo **cálculo, formatação e derivação** de dados de pedido reside nele. Módulo **puro** (sem React/IO), compõe `pricing`/`addons`/`format`. |
| **I-CK2** | O **`submit` é exclusivamente orquestração** (`input → builder → RPC`). **Proibido conter lógica de negócio**: não calcula preço, não formata, não deriva — só coleta `form`/`cart`, injeta `requestId` e chama o builder e a RPC. |
| **I-CK3** | O **`DataService` é só persistência**: recebe os args montados e chama `create_order`. **Proibido reimplementar/derivar** lógica de pedido. |
| **I-CK4** | **Anti-duplicação:** nenhuma lógica de derivação de pedido pode coexistir em mais de um dos três (builders/submit/DataService). Vive **só** nos builders. |

### Localização obrigatória (correção exposta pelo INV-CK + Onda 0)
O order-domain **deve morar na camada de domínio `utils/`** (ex.: `utils/orderPayload.js`) — **NÃO** em `services/`. Motivo: a **regra D2 (Onda 0)** proíbe `services/lib/data/constants` de importar `pricing/addons/format`; como o builder **compõe** esses domínios, sob `services/` ele seria **bloqueado pelo próprio `test:deps`**. Em `utils/` (folha de domínio compartilhada) a composição é válida (e o módulo entra na allowlist D1 ao ser criado).

### Enforcement mecânico (por regra, não por convenção)
| Guard | Garante | Estado |
|---|---|---|
| **G-CK1** = **D2 da Onda 0** | `DataService`/`services/lib/data/constants` **não importam** `pricing/addons/format` → não podem reimplementar o domínio (I-CK3) | ✅ **ATIVO** (`test:deps`, `1b55379`) |
| **G-CK2** | `components/checkout/**` (o submit) **não importa** `pricing/addons/format` diretamente — só o order-domain (+ `DS`) → submit sem lógica de negócio (I-CK2) | ✅ **ATIVO (inerte-pronto)** (`937b6e6`) — vazio até `components/checkout/` existir; ativa na extração |
| **G-CK3** | order-domain (`utils/orderPayload.js`) é **puro** — sem React/IO/DataService/hooks (pode compor `pricing/addons/format`) (I-CK1) | ✅ **ATIVO (inerte-pronto)** (`937b6e6`) — vazio até o módulo existir |
| **B2 golden + revisão** | I-CK4 residual: uma re-soma inline que **não** importe domínio (não pega por D2/G-CK2) faz o **payload divergir do golden** → barrada | ✅ golden especificado (B2) |

**Validação negativa (PoC):** G-CK2 reprova `components/checkout/CheckoutPage.jsx → pricing/format`; G-CK3 reprova `utils/orderPayload.js → react/DataService`. Logo I-CK1/I-CK2/I-CK3 são **mecânicos**; I-CK4 fica coberto por D2 + G-CK2 + golden + revisão. Os guards são **inertes hoje** (sem `components/checkout/` nem `utils/orderPayload.js`) e **ativam automaticamente** no instante da extração.

### Consequência de design: order-domain também provê o view-model de exibição
Como I-CK2 proíbe **qualquer formatação de item** no submit/componente, o order-domain (`utils/orderPayload.js`) deve expor, além de `buildOrderArgs`/`buildWhatsAppMessage`, um **view-model de exibição** (ex.: `buildCheckoutView(cart)` → linhas formatadas + total) para o resumo do `CheckoutPage`. Assim `components/checkout/**` importa **só** o order-domain (+ `DS`) — `pricing/addons/format` ficam fora, e o **G-CK2 é um guard file-level limpo**.

> **INV-CK é pré-condição de aceite de qualquer passo que toque o checkout.** Violá-lo (lógica de negócio no submit, derivação no DataService, ou duplicação) **reprova a fase**, independentemente de a UI continuar funcionando.

---

## 2. Mapa de responsabilidades atuais (`App.jsx`, 3866 linhas)

| Região | Linhas | Unidades | Responsabilidade | Efeitos / acoplamentos |
|---|---|---|---|---|
| **Config + mocks** | 1–216 | imports; `SUPA_URL/KEY/WHATSAPP/RPC_TIMEOUT/LOGO`; `db` (cliente Supabase); `CAT_EMOJI/catEmoji`; `isHttpUrl`; `MOCK_CATS`; `MOCK_PRODS`; `CATEGORIAS_DESCONTINUADAS/isCategoriaDescontinuada`; flags `PRODUCTS_*` | Ambiente, singleton de dados, helpers puros, catálogo-sombra de fallback | `db` tem efeito de import-time (createClient, persistSession→localStorage, autoRefreshToken→timer); `db=null` = modo degradado |
| **DataService** | 219–414 | objeto `DS` (run/cache/fetchAllProductsSafe/get*/save/upsert/del/logEvent/_sanitizeImageUrl…) | **Único ponto de acesso a dados** (DB/RPC/storage). Pivô de ~20 consumidores | usa `this` em métodos reais; `_globalProductsCache` singleton; contratos de retorno inconsistentes (null/[]/uuid) intencionais |
| **Hooks + helpers** | 415–599 | `useCategories/useProducts(+_prodCache)/useAdicionais/useOrders/useCart`; `filterMock/prodInCat/getProdCatIds/isUuid/newRequestId` | Mediadores DS↔UI + helpers puros | `_prodCache` (Map) singleton de sessão; `useCart` persiste em `localStorage` (HARDEN-07, TTL 12h) |
| **Apresentação storefront** | 600–1062 | `Spinner`, `BADGE_MAP`, `ProductCard`(memo), `ProductModalInner`, `ProductModalBoundary`, `ProductModal`, `CartSidebar` | Cards/modal/drawer de produto e carrinho | `ProductCard` é `React.memo` (comparador ignora preço — staleness intencional); `obs` polimórfico no modal |
| **Checkout** | 1063–1260 | `CheckoutPage`, `SuccessPage` | Submit `create_order`+idempotência+fidelidade+msg WhatsApp; tela de sucesso (barra de status cosmética) | sem try/catch; `SuccessPage.statusIdx`/`cart` = estado morto |
| **Admin catálogo** | 1261–1890 | `AdminLogin`, `AdminCategorias`, `ImageUploader`, `AdminProducts`, `AdminAdicionais` | Login real (`signInWithPassword`) + CRUD catálogo | `ImageUploader` usa `db.storage` direto; `AdminProducts` grava coluna viva `imagem_url` (sentinel `KEEP`) |
| **Admin operações** | 1891–2486 | `AdminPedidos`, `AdminDashboard`, `AdminStatus`, `AdminFidelidade`, `AdminHealth`, `AdminPanel` | Pedidos/métricas/status-loja/fidelidade/saúde + hub de abas | `AdminDashboard` auto-refresh 60s; mapa de status triplicado; fidelidade 100% localStorage |
| **Shell storefront** | 2487–2980 | `LazySection`, `AddressModal`, `SearchBar` | Lazy-render (IntersectionObserver), endereço (ViaCEP/Nominatim/Leaflet CDN), busca | `AddressModal` injeta Leaflet via `window.L`; reverse-geocode duplicado |
| **StoreApp** | 2981–3841 | `StoreApp` (~15 `useState`, 2 `useMemo`) | **Cérebro do storefront**: estado global, roteamento fake (page), modais, carrinho, gesto admin | maior unidade; prop-drilling massivo; handlers DOM inline (scroll `sec-*`, 5-cliques) |
| **Raiz** | 3842–3866 | `App` | Roteamento `mode` (store/login/admin), hash `#admin-encanto`, wrapper `AppShell` | `replaceState` no initializer lazy de `useState` (anti-pattern preservado; `main.jsx` **não** usa StrictMode) |

> `src/` já contém `AppShell.jsx` + `BackgroundLayer.jsx` extraídos (casca/fundo global); entry = `main.jsx` (`createRoot(...).render(<App/>)`, sem StrictMode). `import './index.css'` é side-effect em `App.jsx:5`.

---

## 3. Decomposição proposta (~48 módulos)

```
src/
├─ lib/supabase.js            ← db + SUPA_URL/KEY + WHATSAPP + RPC_TIMEOUT + LOGO   (singleton I/O)
├─ services/
│   ├─ DataService.js         ← objeto DS COMPLETO (preserva `this`; objeto literal)
│   └─ geocoding.js           ← ViaCEP/Nominatim (ver §5-B4: REFATORAÇÃO, adiar)
├─ data/mockCatalog.js        ← MOCK_CATS + MOCK_PRODS + filterMock
├─ utils/
│   ├─ catalog.js             ← CAT_EMOJI/catEmoji/isHttpUrl/CATEGORIAS_DESCONTINUADAS/isCategoriaDescontinuada/prodInCat/getProdCatIds
│   ├─ ids.js                 ← isUuid/newRequestId
│   ├─ whatsapp.js            ← openWhatsApp
│   ├─ sections.js            ← categoriaToSecId (ver §5-B4: REFATORAÇÃO, adiar)
│   ├─ pricing.js  ⛔ SAGRADO  (intocado)
│   ├─ addons.js   ⛔ SAGRADO  (intocado)
│   └─ format.js   ⛔ SAGRADO  (intocado)
├─ constants/
│   ├─ catalogConfig.js       ← PRODUCTS_PAGE_SIZE/PAGINATE/CACHE_TTL
│   ├─ storage.js             ← STORAGE_KEYS (chaves localStorage — commit próprio, ver §6)
│   ├─ checkout.js            ← PAYMENT_METHODS/ORDER_STEPS
│   └─ orderStatus.js         ← ORDER_STATUS_MAP (unifica mapa triplicado)
├─ hooks/
│   ├─ useCategories.js  useProducts.js(+_prodCache)  useAdicionais.js  useOrders.js  useCart.js
├─ components/
│   ├─ ui/Spinner.jsx   LazySection.jsx
│   ├─ ProductCard.jsx (+BADGE_MAP)   ProductGrid.jsx(ver §5-B4)
│   ├─ ProductModal/{ProductModalInner,ProductModalBoundary,index}.jsx
│   ├─ CartSidebar.jsx   CartStickyBar.jsx(+WhatsAppFab)
│   ├─ checkout/{CheckoutPage,SuccessPage}.jsx
│   ├─ admin/{AdminLogin,ImageUploader,AdminCategorias,AdminProducts,AdminAdicionais,
│   │         AdminPedidos,AdminDashboard,AdminStatus,AdminFidelidade,AdminHealth,
│   │         AdminPanel,StatCard}.jsx
│   ├─ icons/CategoryIcon.jsx
│   ├─ SearchBar.jsx  StoreHeader.jsx  DeliveryBar.jsx  LoyaltyBanner.jsx
│   ├─ modals/LoyaltyModal.jsx   AddressModal.jsx   CategoryChips.jsx   CatalogSections.jsx
├─ pages/StoreApp.jsx         ← orquestrador storefront (penúltimo)
├─ App.jsx                    ← AppRouter mínimo (mantém imports pricing+addons p/ regra F)
└─ main.jsx / AppShell.jsx / BackgroundLayer.jsx / index.css   (já existem — preservar)
```

Camadas (sem ciclos): `lib`/`constants`/`utils`(domínio) → `data` → `services` → `hooks` → `components(folha)` → `components(compostos)` → `pages/StoreApp` → `App`.

---

## 4. Grafo de dependências — **ACÍCLICO** (verificado na síntese)

Direção única, sempre de cima→baixo na pilha de camadas acima. Os **barris** (`ProductModal/index`, `admin/AdminPanel`, `App`) importam seus filhos e são extraídos **por último** em cada subárvore. Nenhuma dependência circular foi encontrada pelos dois críticos. O grafo completo (≈90 arestas módulo→módulo) está no anexo de síntese do recon; os pontos sensíveis:
- `DataService → lib/supabase + utils/catalog(prodInCat) + constants/catalogConfig`
- `useCart → utils/pricing(⛔) + constants/storage`; `useAdicionais → utils/addons(⛔)`
- `StoreApp → todos os hooks + todos os componentes de storefront`
- `App → pages/StoreApp + admin/AdminLogin + admin/AdminPanel + AppShell + utils/pricing(⛔) + utils/addons(⛔)`

---

## 5. ⚠️ Achados bloqueadores (descobertos pela revisão adversarial — verificados no fonte)

### B1 — `tests/deps.audit.mjs` regra D **bloqueia toda extração de componente** 🔴
[deps.audit.mjs:44-47](../../tests/deps.audit.mjs#L44-L47): `assert.deepStrictEqual(importers, ['App.jsx'])` para cada domínio (`pricing`, `addons`). **Qualquer módulo novo que importe um domínio** (ProductCard, ProductModalInner, CartSidebar, ProductGrid, CheckoutPage, useCart, useAdicionais, AdminProducts, AdminAdicionais, StoreApp) **reprova `test:deps`**. ⇒ **Onda 0 obrigatória** antes de qualquer componente: reescrever a regra D para uma **allowlist FECHADA e explícita** dos consumidores nomeados (não "qualquer arquivo de `src/`", que é vácuo e remove a proteção), asserindo que o conjunto de importers ⊆ allowlist **e** que nenhum importer é ele próprio um domínio. As regras A/B/C/E (folha pura, sem cruzar domínios, sem ciclo) e a regra F permanecem a **prova primária** de isolamento e ficam intactas. Único arquivo de teste alterado na fase; diff revisado por humano.

### B2 — Validação do checkout é 100% manual → falta golden de payload 🔴
Hoje a única garantia anti-regressão do fluxo sagrado é "1 pedido real" manual, não reproduzível e dependente de Supabase vivo. ⇒ **Antes da Onda 5** (idealmente na Onda 0): criar um **golden de payload** — expor a montagem de `{p_customer,p_order,p_items,p_request_id}` + a string WhatsApp como função pura testável; stubar `DS.savePedido`/`db` para capturar o argumento; congelar snapshot (carrinho fixo → payload byte-idêntico) com `deepStrictEqual` versionado. Converte "mesmo payload" de pedido manual em asserção mecânica.

### B3 — Side-effect de CSS + casca não rastreados 🔴
`import './index.css'` ([App.jsx:5](../../src/App.jsx#L5)) é side-effect global; `AppShell.jsx`/`BackgroundLayer.jsx` envolvem tudo. ⇒ Plano fixa: **`import './index.css'` permanece em `App.jsx` (ou migra para `main.jsx`) como import único**; nenhum componente extraído importa CSS; o wrapping `AppShell`→`BackgroundLayer` é preservado. Grep de resíduo de cada onda visual confirma CSS importado exatamente 1×.

### B4 — Quatro "moves" são na verdade REFATORAÇÕES (consolidam N cópias) 🟠
`ProductGrid` (generaliza 3 grids ~idênticos), `StatCard` (card repetido em Dashboard/Health), `utils/sections.js` (deriva `sec-id` por substring em 3 sítios, 1 deles morto), `services/geocoding.js` (separa I/O de setState + unifica reverse-geocode duplicado) **não são recorte-e-cola** — deduplicam cópias possivelmente não-idênticas e mudam a árvore JSX. ⇒ **✅ RATIFICADO (2026-06-30): adiado para REF-APP-02** (§10-bis). Nesta fase, **apenas moves puros**; as 4 consolidações **não** são feitas aqui. Os containers são extraídos preservando a duplicação/dead-code interno (mover cada cópia como está). Na REF-APP-02, consolidar exigirá prova de **equivalência textual das N cópias** (diff par-a-par) + diff de markup — `build` verde **não** detecta divergência de saída.

---

## 6. Ordem de extração (ondas)

| Onda | Passos | Módulos | Risco | Validação-chave (além de build+test:deps+test:pricing+test:addons) |
|---|---|---|---|---|
| **0** | desbloqueio | regra D do `deps.audit` → allowlist fechada (B1) + golden de payload do checkout (B2) | médio | A/B/C/E/F inalteradas e verdes; golden de payload `deepStrictEqual`; diff só nos testes (humano) |
| **1** | 1–6 | `lib/supabase`, `utils/catalog`, `utils/ids`, `constants/*`, `data/mockCatalog`; **`storage.js` em commit próprio** | baixo/médio | `createClient` único (grep); **cada `STORAGE_KEYS.X` == literal antigo byte-a-byte** (tabela string-a-string); `db=null` degradado preservado |
| **2** | 7 | `services/DataService.js` (objeto literal, preserva `this`) | **alto** | pedido real (payload+reconciliação Σ=total); **micro-teste node:** `upsertProd` zera `_globalProductsCache`; DS continua objeto único (sem desestruturar métodos); inventário fechado de consumidores diretos de `db` fora do DS (ImageUploader/AdminLogin/CheckoutPage) reaponta import |
| **3** | 8–9 | hooks `useCategories/useProducts(+_prodCache)/useAdicionais/useOrders/useCart` | médio | `_prodCache` segue singleton; `useProducts→DS.logEvent` (telemetria offline) continua disparando; carrinho persiste (TTL 12h, dedupe por `_key`) |
| **4** | 10–11 | folhas visuais: `Spinner/LazySection/StatCard`; `ProductCard(+BADGE_MAP)/ProductModal*/CartSidebar` | baixo/médio | comparador `React.memo` **intocado** (staleness de preço preservada); `prods` continua a MESMA referência de `useMemo` (sem `.map()` novo); `onOpen` recriado por render (não "otimizar" com `useCallback`) |
| **5** | 12 | `checkout/SuccessPage` → `checkout/CheckoutPage` | **alto** | golden de payload (B2) idêntico; idempotência sob duplo-clique; fidelidade `localStorage` incrementa igual; **sem** introduzir try/catch |
| **6** | 13 | admin catálogo: `AdminLogin/ImageUploader/AdminCategorias/AdminProducts/AdminAdicionais` | médio | login real (sem bypass); `upsertProd` sentinel `KEEP` grava `imagem_url` (viva), nunca `image_url`; bugs preservados (AdminAdicionais só nome+preco) |
| **7** | 14–15 | admin ops: `AdminPedidos/Dashboard/Status/Fidelidade/Health` → `AdminPanel` (barril, por último) | médio/alto | auto-refresh 60s com cleanup; mesmas chaves `localStorage` (lado cliente lê igual); abas roteiam o componente certo |
| **8** | 16–17 | shell: `SearchBar/CategoryIcon/AddressModal`; depois `StoreHeader/DeliveryBar/LoyaltyBanner/LoyaltyModal/CategoryChips/CatalogSections/CartStickyBar` | médio | ids `sec-*` preservados (scroll `onSuggest`→`sec-bebidas`); gesto 5-cliques abre admin; Leaflet via `window.L` injetado igual |
| **9** | 18–19 | `pages/StoreApp` (penúltimo) → `App.jsx` AppRouter mínimo | **alto** | pedido real ponta-a-ponta == baseline; `#admin-encanto`→login→admin→exit; regra F (App consome pricing+addons); **alvo: `App.jsx` < ~120 linhas** |

### 6.1 Gates padrão obrigatórios em **todo** passo de extração
1. **Resíduo:** grep do símbolo extraído em `App.jsx` retorna **0 definições** (só `import`, se houver) — sem cópia velha sombreando.
2. **Equivalência mecânica:** corpo movido == original (diff vazio / hash do corpo normalizado) para moves puros.
3. **1 módulo = 1 commit** com rollback próprio (`git revert`); ondas que agrupam vários módulos (4/6/7/8) são **vários commits**, não um.

---

## 7. Riscos técnicos globais

- **R1 (gate da fase):** regra D do `deps.audit` (B1) — sem a Onda 0, toda extração com domínio reprova.
- **R2:** `DataService` usa `this` em métodos reais — converter para funções soltas quebra binding. Manter **objeto literal exportado**. Pivô de ~20 consumidores.
- **R3:** `db` vaza para fora do DS (`ImageUploader.db.storage`, `AdminLogin.db.auth`, `if(!db)` no checkout). Cada um importa `db` de `lib/supabase` — inventário fechado no passo 7/13.
- **R4:** singletons mutáveis `_globalProductsCache` (DS) e `_prodCache` (useProducts) **não podem** ser duplicados (cache stale / quebra da invariante "escrita de produto invalida cache"). Validar com build de produção, não HMR.
- **R5:** 2 colunas de imagem — gravar **`imagem_url`** (viva), nunca `image_url` (legada). Validar payload exato no upsert.
- **R6:** ids `sec-*` são contrato implícito entre `CatalogSections`/`LazySection` e o scroll programático; manter literais.
- **R7:** prop-drilling massivo ao quebrar `StoreApp`; **não** introduzir Context nesta fase (muda árvore de re-render). Ver §9.
- **R8:** volume (~48 módulos / ~19 passos) — disciplina 1-commit-por-módulo é o que dá rollback granular.
- **R9 (rede de segurança):** só há golden de `pricing`/`addons` + `deps` + RLS de banco; **nenhum render/snapshot test**. Recomendado (opcional, antes da Onda 4): smoke render via `react-dom/server` num `.mjs` (estilo golden existente) montando `StoreApp` com mocks → snapshot de markup como baseline por onda visual.

---

## 8. Estratégia de ZERO mudança funcional

### 8.1 Regras
- Move puro + ajuste de import/export; nada de reescrita de lógica.
- Domínio (pricing/addons/format) e checkout (create_order/request_id/idempotência) **intocados na semântica**.
- Shapes implícitos (`MOCK_*`, objeto `cart` com `items/_key/total`) movidos **sem editar campos**.
- Chaves `localStorage`/`sessionStorage` centralizadas movendo o **literal idêntico** (validado por grep string-a-string); quem lê/escreve e quando **não muda**.
- Consolidações (B4) **adiadas** para REF-APP-02.

### 8.2 Bugs e código morto a **preservar** (refatorá-los = mudança funcional proibida aqui)
`AdminAdicionais.save` que só envia nome+preco · `AdminDashboard` lendo `o.cliente_nome/telefone` (vs join `customers`) · `cor` sem input em `AdminCategorias` · `inRange`/`getCatSecId`/`numero`/status `outrange` mortos · estado morto de `SuccessPage` (`statusIdx`/`tempo`/prop `cart`) · comparador `React.memo` de `ProductCard` que ignora preço · guarda `useRef?...:React.useRef` ([App.jsx:1385]) · `replaceState` no initializer lazy de `useState` (App raiz) — `main.jsx` não usa StrictMode, então não há double-invoke a tratar.

---

## 9. Estado compartilhado / Context (FORA desta fase)

**Não há nenhum React Context** no monólito: todo o estado do storefront vive em `StoreApp` (~15 `useState`) e desce por prop-drilling. Estado compartilhado oculto/perigoso = persistência client-side dispersa (mesmas chaves `localStorage` lidas/escritas em StoreApp, CheckoutPage, AdminFidelidade, AdminStatus, useCart → acoplamento implícito loja↔admin).

Candidatos a Context **futuros** (REF-APP-02+, não aqui): `CartContext`, `StoreContext` (page/selCat/search/modal/storeOpen/delivery), `AuthContext` (App captura o usuário em `setAdmin` mas **descarta** o valor). **Por que não agora:** migrar de prop-drilling para Context altera a árvore de re-render — incompatível com ZERO mudança funcional. Caminho conservador desta fase: (a) sub-componentes recebem o **mesmo** estado via props explícitos; (b) só as **chaves** de storage centralizadas; (c) opcionalmente, em passos próprios e posteriores, encapsular grupos de `localStorage` em hooks (`useDeliveryAddress`/`useLoyalty`/`useStoreStatus`/`useSecretAdminTap`) lendo/escrevendo as MESMAS chaves nos mesmos momentos.

---

## 10. Critérios de aceite da fase e o que falta para congelar

**Aceite (ao fim da REF-APP-01):** `App.jsx` reduzido a AppRouter mínimo (< ~120 linhas); suíte completa verde; pedido real ponta-a-ponta idêntico ao baseline; nenhuma regressão visual/funcional; cada módulo rastreável a 1 commit.

**Sequência de governança (2026-06-30):**
1. **Desenho CONGELADO** (sem execução). ✅
2. **Onda 0** (regra D evolutiva do `test:deps`) — **APLICADA** (`1b55379`). ✅
3. **B2** (golden de checkout) — **ESPECIFICADO** (`8f6d618`). ✅
4. **INV-CK** (invariante do order-domain) — **ACEITO + risco eliminado por regra** (G-CK1/G-CK2/G-CK3, `937b6e6`). ✅
5. **B4 / R9 / index.css** — **RATIFICADOS** (ver §10-bis). ✅
6. **Congelamento da execução + Onda 1 (DOMÍNIO PURO)** — **APLICADA** (`8703394`…`175542a`, 2026-06-30; ledger [Onda 1 — Execution](REF-APP-01-onda-1-execution.md)): 6 módulos (`lib/supabase`, `utils/ids`, `utils/catalog`, `data/mockCatalog`, `constants/catalogConfig`, `constants/storage`); `App.jsx` 3866→3452 linhas; move-puro provado byte-a-byte + auditoria adversarial LIMPO; suíte completa verde; restore `backup/main-pre-onda-1`. `orderStatus.js` (dedup=B4) e `checkout.js` (`pays`/`steps`, Onda 5) diferidos. ✅
7. **Onda 2** (`services/DataService.js`, objeto literal, **alto risco** — pivô de ~20 consumidores) — ✅ **EXECUTADA (2026-07-06)** (`3643c9d` C1 + `09aff7c` C2; move-puro byte-exato; suíte + build verdes; sem push; ledger [REF-APP-01 · Onda 2](REF-APP-01-onda-2-plan.md)).
8. **Onda 3 (HOOKS)** (`useOrders`/`useCategories`/`useProducts`/`useAdicionais`/`useCart`) — ✅ **EXECUTADA (2026-07-06)** (`4d30541`…`a5194e8`; 1 hook = 1 commit; move-puro; suíte + build verdes; sem push).
9. **Rede R9 `test:render`** (`tests/render.smoke.mjs` + loader esbuild) — ✅ **CONCLUÍDA (2026-07-06)** (`39615c9`; folhas `AppShell`/`BackgroundLayer` congeladas; pré-condição da Onda 4). ✅
10. **Onda 4 (FOLHAS VISUAIS)** (`Spinner`/`ProductCard`+`BADGE_MAP`/`ProductModalInner`/`ProductModalBoundary`/`ProductModal`/`CartSidebar`/`LazySection`) — ✅ **EXECUTADA (2026-07-06/07)** (`e1164cd`…`f4c5b12`; 1 componente = 1 commit; move-puro; snapshots `test:render` adicionados; suíte + build verdes; sem push). ✅
11. **Onda 5 (CHECKOUT · Trilha B)** — ✅ **EXECUTADA (2026-07-07→09):** 5.0 ADR (`5668e32`) · 5.0.5 baseline (`b4f2b3d`) · 5.1 `SuccessPage` (`3350ab3`) · 5.2 order-domain `utils/orderPayload.js` (`e5ae1a2`; `submit`/resumo passam a consumi-lo) · 5.3 `CheckoutPage` (`e4985e8`) · 5.4 limpeza de resíduo (19 imports órfãos, `796098c`) + reconciliação documental (este commit). `test:checkout` verde em todas as subfases; INV-CK honrado (G-CK2/G-CK3 ativos e verdes); `App.jsx` = 2668 linhas; sem push. ✅
12. **Onda 6 (ADMIN CATÁLOGO/AUTH/UPLOAD)** (`AdminLogin`/`AdminCategorias`/`ImageUploader`/`AdminProducts` → `components/admin/`) — ✅ **EXECUTADA (2026-07-09):** 6.1 `AdminLogin` (`789459d`) · 6.2 `AdminCategorias` (`fc77699`) · 6.3 `ImageUploader` (`a730871`; poda imports órfãos `db`/`isHttpUrl`) · 6.4 `AdminProducts` (`4c721a8`; + allowlist D1 pricing + **token Regra F**: `App.jsx` mantém `import precoVitrine` como consumo estrutural, consumidor real movido). 1 componente = 1 commit; move-puro; suíte 7/7 + build verdes a cada passo; sem push; `App.jsx` 2668→2124 linhas (−544). ✅
13. **Onda 7 (ADMIN OPERAÇÕES + BARREL)** (`AdminAdicionais`/`AdminPedidos`/`AdminDashboard`/`AdminStatus`/`AdminFidelidade`/`AdminHealth` → `components/admin/`; depois **barrel** `AdminPanel`, que passa a importar os 8 sub-componentes como irmãos) — ✅ **EXECUTADA (2026-07-09):** 7.1 `AdminAdicionais` (`333e1d5`; + allowlist D1 addons + poda `MOCK_ADS`) · 7.2 `AdminPedidos` (`77050cd`) · 7.3 `AdminDashboard` (`1796dbf`; poda `useOrders`) · 7.4 `AdminStatus` (`c0ebd75`) · 7.5 `AdminFidelidade` (`b797e36`) · 7.6 `AdminHealth` (`37d7ed4`; poda `useCallback`/`fmtDate`) · 7.7 `AdminPanel` barrel (`b7a1501`; poda dos imports órfãos decorrentes das extrações 6.2/6.4/7.1–7.6) + **7.7b** poda do resíduo pré-existente `ImageUploader` da Onda 6.4 (`7f07bfb`; `AdminProducts` já o importa como irmão). 1 mudança lógica = 1 commit; move-puro; suíte 7/7 + build verdes a cada passo; sem push; `App.jsx` 2124→1462 linhas (−662). App.jsx passa a ter **zero definições de componente admin** (importa apenas `AdminLogin` + `AdminPanel`). Nota de escopo: o stat-card repetido em `AdminDashboard`/`AdminHealth` foi **preservado** (dedup = B4/REF-APP-02, §10-bis). ✅
14. **Onda 8 (COMPONENTES ISOLADOS DA LOJA)** (`SearchBar`/`AddressModal` → `components/`) — ✅ **EXECUTADA (2026-07-10):** 8.1 `SearchBar` (`2ea1e03`) · 8.2 `AddressModal` (`0acea12`). Move-puro (corpos byte-a-byte; só `import React` + `export`); ambos consumidos apenas pelo `StoreApp`; nenhum importa domínio → **sem alteração de allowlist/`test:deps`**; fora do fluxo de checkout. 1 componente = 1 commit; suíte 7/7 + build verdes a cada passo; sem push; `App.jsx` 1462→998 linhas (−464). Ordem por **menor risco/maior isolamento primeiro**: extraídos os blocos independentes antes do núcleo. Remanescente = `StoreApp` (~860 linhas, núcleo/checkout) + router `App` → alvo da **Onda 9**. ✅

## 10-bis. Decisões ratificadas pré-execução (2026-06-30)

- **B4 — consolidações ADIADAS para REF-APP-02.** REF-APP-01 é **100% move-puro**. **Não** se criam `ProductGrid`, `StatCard`, `utils/sections.js` nem `services/geocoding.js` nesta fase (módulos ~48 → **~44**). Os containers são extraídos **preservando a duplicação/dead-code interno**: `StoreApp` mantém os 3 grids inline e as 3 derivações `sec-id` por substring; `AdminDashboard`/`AdminHealth` mantêm o stat-card repetido; `AddressModal` mantém o geocoding (I/O + setState) acoplado e o reverse-geocode duplicado. Consolidar/deduplicar = **REF-APP-02** (com prova de equivalência das N cópias).
- **R9 — render net automatizado ADOTADO.** Novo `tests/render.smoke.mjs` (`npm run test:render`): para cada **componente-folha apresentacional** (Spinner, ProductCard, CartSidebar, BADGE, etc.), renderiza com **props fixas** via `react-dom/server` (`renderToStaticMarkup`) e **congela o snapshot de markup**. JSX compilado por **esbuild** (já presente; sem nova dependência). O snapshot é congelado **no momento da extração** (que, sendo move-puro, iguala o markup original) e guarda contra drift futuro. Orquestrador (`StoreApp`) e componentes browser-heavy (`AddressModal`, `LazySection`) seguem em **smoke manual** por onda. Entra na suíte cumulativa antes da Onda 4. Viabilidade comprovada por PoC (`renderToStaticMarkup` OK, react 18.2.0).
- **`import './index.css'` → MOVER para `main.jsx`.** Passo contido e antecipado (early): o side-effect global de CSS passa do `App.jsx` para o entry `main.jsx`; `App.jsx` vira router puro; **nenhum componente extraído importa CSS**. Guard de resíduo por onda: CSS importado **exatamente 1×** (em `main.jsx`). Zero mudança funcional (Vite empacota o mesmo stylesheet).

---

## 11. Próximos passos

O desenho deste documento foi **congelado e ratificado**, e as pré-condições de execução — (a) **Onda 0 aplicada** (regra D reestruturada), (b) congelamento explícito da **fase de execução** pelo usuário, e (c) Execution Plan por ondas (padrão F1A/F1B) — foram **cumpridas**; a **execução está em andamento** (Ondas 0–8 + rede R9 aplicadas). O **F2 do NORM-06 permanece bloqueado** e independente desta fase.

> ▶️ **REF-APP-01 — EM EXECUÇÃO.** Desenho congelado/ratificado; Onda 0 + congelamento aplicados. **Ondas 0–8 + rede R9 executadas (2026-07-06→10).** Próxima: Onda 9 (núcleo `StoreApp`).

> ✅ **REF-APP-01 — decisões da §10/§10-bis ratificadas e congeladas; execução em andamento (Ondas 0–6 + rede R9).**
