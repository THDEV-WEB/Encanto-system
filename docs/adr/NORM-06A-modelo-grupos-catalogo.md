# ADR NORM-06A — Modelo de Catálogo: Categorias de Negócio × Coleções — v4 CONGELADO

- **Status:** CONGELADO (arquitetura definitiva pré-implementação; nada implementado).
- **Decisão de produto:** todo produto tem **exatamente uma** categoria de negócio (identidade). O mesmo produto aparece em N coleções **sem duplicar registro, sem flags, sem `categoria_ids`**.
- **Domínio:** **Categoria de negócio** (Marmitas, Monte, Batidinhas, Bebidas…) ≠ **Coleção/Vitrine** (Destaques, Promoções, Mais Vendidos, Black Friday…).
- **Histórico:** v1 (junção uniforme — rejeitada: dual-source) → v2 (junção só-coleção) → v3 (nomenclatura, estratégias, identidade visual, pin) → **v4 (esta: Collection Engine, paginação/G1, RLS, idempotência×partição, multi-tenant congelado, roadmap NORM-06..11 — via workflow design+crítica adversarial).**
- **ADRs derivados (v4):** [NORM-07 Collection Engine](NORM-07-collection-engine.md) · [NORM-08 Search Engine](NORM-08-search-engine.md) · [NORM-09 Event Engine](NORM-09-event-engine.md). Base: [NORM-01A](NORM-01A-modelo-canonico-catalogo.md).

---

## 1. Princípio: cardinalidade casa com estrutura
| Fato | Cardinalidade | Estrutura |
|---|---|---|
| Produto → categoria de negócio | **1:1** (identidade) | **coluna** `products.categoria_id` |
| Produto → coleções (curadas) | **N:N** | **junção** `product_collections` |
| Produto → coleção rule/smart | **derivada** | **resolver** `resolve_collection()` ([NORM-07](NORM-07-collection-engine.md)) |

## 2. Modelo canônico (inalterado desde v3)
### 2.1 `categories` (evoluída; STI business/collection)
```
id text PK; slug text NOT NULL UNIQUE; nome text NOT NULL; descricao text; icone text; cor text;
imagem text; banner text; ordem int DEFAULT 0; ativo bool DEFAULT true;
tipo text NOT NULL DEFAULT 'business' CHECK (tipo IN ('business','collection'));
-- SÓ-coleção (NULL quando business):
estrategia text CHECK (estrategia IN ('manual','rule','smart'));
definicao jsonb; starts_at timestamptz; ends_at timestamptz;
CHECK (tipo='collection' OR (estrategia IS NULL AND definicao IS NULL AND starts_at IS NULL AND ends_at IS NULL));
CHECK (tipo='business' OR estrategia IS NOT NULL);
```
### 2.2 `products`
`categoria_id` (FK→categories.id) = categoria de negócio **primária e única fonte da identidade** (aponta `tipo='business'`). `destaque` deprecado (→ coleção "Destaques"); `categoria_ids` eliminado.
### 2.3 `product_collections` (junção N:N — só coleções)
```
id uuid PK; product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE;
collection_id text NOT NULL REFERENCES categories(id) ON DELETE CASCADE;
ordem int NOT NULL DEFAULT 0; fixado bool NOT NULL DEFAULT false; created_at timestamptz DEFAULT now();
UNIQUE (product_id, collection_id);
```
Índices `(collection_id, fixado DESC, ordem)`, `(product_id)`. Linha = associação **curada**; `manual` guarda todas; `rule/smart` guardam **só os pins**.
### 2.4 Invariantes (triggers)
`collection_id`→collection; `categoria_id`→business; `adicionais.aplica_categoria_id`→business; troca de `tipo` bloqueada se gerar inconsistência. + CHECKs STI da §2.1.
### 2.5 Resolver → **[NORM-07](NORM-07-collection-engine.md)**
`resolve_collection(p_collection_id, p_limit DEFAULT NULL, p_after DEFAULT NULL) RETURNS (product_id, posicao, origem, fixado)`, STABLE. Contrato de saída **corrigido na v4**: `origem ∈ {curado,calculado}` + `fixado bool` (pin = curado AND fixado); `posicao` = rank global, tie-break por `product_id`; **sem `p_ctx`**. `rule` é **materializável** (não "barato em tempo real"). Hidratação **server-side**.
### 2.6 View `vw_product_memberships` (derivada; leitura uniforme sem duplicar dado).

---

## 3. Decisões transversais v4 (da auditoria de escala + crítica adversarial)

### 3.1 G1/G7 — Paginação é CORREÇÃO de curto prazo, não escala futura
`DS.getProds` busca todos os produtos **sem `limit`** e filtra no cliente. **O PostgREST corta em 1000 linhas por padrão → o catálogo já chega truncado a partir de ~1000 produtos, hoje.** Decisão: a leitura nasce **paginada server-side** (keyset por `(ordem,id)`, tie-break obrigatório por `id`), via RPC `list_products` (business por `categoria_id`; coleção via resolver). `DS.getProds/getAllProds` viram **shims** (drenam `list_products`) para zero regressão; `useProductsPaged` com `loadMore`; `_prodCache` evolui para cache por-página; offline pagina o MOCK. **Home não lista o catálogo inteiro** — vira vitrines (coleções paginadas) + grade da categoria selecionada paginada. Índices: `products(categoria_id)`, `products(disponivel, ordem, id)`, `product_collections(collection_id, fixado DESC, ordem)`. Detalhe em [NORM-08](NORM-08-search-engine.md).

### 3.2 G9 — RLS de leitura pública = predicado de COLUNA LOCAL (não subconsulta, não `USING true`)
O DS lê **tabelas cruas** via PostgREST (`d.from('products')`), não views. Então `USING true` **vazaria** produtos `disponivel=false` e coleções fora da janela ao anon. Decisão: policies de leitura = **predicado de coluna local** — `USING (disponivel)` em `products`, `USING (ativo)` em `categories` — que é constante por-linha, barato e **não degrada plano**. O tabu real é **subconsulta** na policy (reavalia por-linha a 10k). Janela `starts_at/ends_at` de coleção fica na **view/RPC** de vitrine, nunca na policy.

### 3.3 G13 — Idempotência × particionamento (CRÍTICO — única costura que toca o checkout)
Particionar `orders` por `created_at` **exigiria** que todo `UNIQUE` incluísse a chave de partição → `UNIQUE(request_id)` viraria `UNIQUE(request_id, created_at)`, **destruindo a idempotência** do HARDEN-03 (mesmo `request_id` em duas partições = **pedido duplicado**, ex.: retry cruzando a virada do mês). **Decisão congelada:** a idempotência migra para tabela **não particionada** `idempotency_keys(request_id text PK, order_id uuid, created_at)`, consultada **dentro** de `create_order` antes do insert. Só então `orders/order_items` podem particionar por `created_at` sem tocar a garantia do HARDEN. *(Candidato a **HARDEN-08**; pré-requisito de qualquer particionamento futuro.)*

### 3.4 G4 — Multi-tenant: CONGELADO como contrato, **sem coluna agora**
A estratégia é **(a) shared-schema + `store_id` + RLS por tenant**, **RESERVADA**. Materializar `store_id='default'` agora é over-engineering: `ADD COLUMN … DEFAULT` é **metadata-only/instantâneo** no PG11+ → adiar **não** encarece. Congela-se só o **contrato**:
- tipo da chave = **text-slug** (única escolha de fato irreversível, alinha com host/subdomínio);
- regra dura: **toda `UNIQUE`/FK nova nasce documentada com `store_id` na frente**;
- `current_store_id()` **STRICT** (sem fallback `'default'` → fail-closed: sem tenant, nega tudo);
- FK composta com `store_id` **só para PKs text-slug** (`categories.id`), **não** para uuid (`products` já é globalmente único);
- **`settings` é por-tenant** (guarda config de negócio: preços, frete, textos) — não global.
**Decidir sim/não antes da F1** (trava as unicidades `slug`, `nome+categoria`).

### 3.5 Os 4 itens "decidir AGORA" (precedem a F1)
**G7** forma paginada do contrato · **G8/G4** `store_id` sim/não · **G9** RLS de coluna local · **G10** resolver entrega **uma** coleção por chamada, `rule/smart` sempre via cache (nunca cálculo ao vivo no storefront). Tudo o mais é infra aditiva.

---

## 4. Severidade das inconsistências (do NORM-01; inalterada) e identidade visual
Mantidas de v3 (preço em ~7 lugares ALTA; adicionais meio-migrados ALTA; taxonomia de grupo ALTA; MOCK drift ALTA; etc.). `categories` ganha identidade visual compartilhada (`slug/descricao/imagem/banner`); campos só-coleção isolados por CHECK.

## 5. Reservas de escala (Nível 2/3 — acomodáveis sem mudar o núcleo)
- **Índices** adicionais: `order_items(order_id)`, `orders(created_at desc)`, `(status,created_at)`, `application_logs(created_at)`, `(module,created_at)`.
- **jsonb:** nunca filtrar/ordenar storefront por campo dentro de `tamanhos`/`definicao` sem índice — **promover atributo a coluna** real.
- **Reconciliação incremental** (janela 24-48h / `last_reconciled_at`), nunca full-table.
- **Particionamento** de `application_logs` (DROP PARTITION em vez de DELETE) e de `orders/order_items` — **só após §3.3**.
- **pg_cron** como recurso escasso: escalonar horários (cache de madrugada, purge fora de pico), serializar jobs concorrentes por advisory lock.
- **Admin:** `getAllProds/getAllAds` são **unbounded hoje** (travam a 10k) → paginar; code-split admin×storefront.
- **CDN/thumbnails** para a grade (imagens via transform webp, lazy-load).

## 6. Riscos/decisões inegociáveis antes da migração
- **R1 — Classificação business×collection:** `Pedido Fitness (c10)` e `Combos (c1)` provavelmente viram **coleções** se seus produtos se sobrepõem; `Destaques (c8)`/`Promoção (c2)` são coleções. Errar = produto some da navegação.
- **G4 — Multi-tenant:** decidir antes de travar unicidades (§3.4).
- **§3.3 — Idempotência desacoplada** antes de qualquer particionamento.

## 7. Prova de não-regressão (reconfirmada v4)
`create_order` não referencia `products`/`categories`; `order_items.product_id` sem FK → checkout/HARDEN-01..07/idempotência/reconciliação imunes — **desde que** a idempotência seja desacoplada do particionamento (§3.3, a **única** costura que toca o checkout). Collection Engine, busca, paginação, RLS de coluna local e eventos são leitura/aditivos. Monte/Batidinhas leem `tamanhos`. Reusa `categories`, `DS`, pg_cron, unaccent e o padrão de RPC.

---

## 8. Roadmap (reescrito — etapas independentes)
| Etapa | Conteúdo | Estado |
|---|---|---|
| **NORM-02** | Limpeza segura (morto, magic→const, `isHttpUrl`). Zero comportamento. | pré-req, baixíssimo risco |
| **NORM-03** | Engine de preço/grátis única (`utils/pricing.js`) + golden test. | pré-req |
| **NORM-04** | Resolvedor de adicionais único (`utils/addons.js`). | — |
| **NORM-05** | Fonte única de adicionais (migrar MOCK_ADS→tabela). | — |
| **NORM-06** | **Arquitetura do catálogo**: F0 decisões (R1, G4, §3.3) → F1 DDL aditivo + índices + RLS de coluna local + `slug` → F2 backfill (só coleções) → F3 DataService **paginado** (`list_products`, shims) → F4 Admin → F5 UI (nav business + vitrines) → F6 limpeza (`destaque`/`categoria_ids`/`image_url`). Inclui a paginação (§3.1, é correção). | núcleo |
| **NORM-07** | **Collection Engine** — só ramo `manual` ([ADR](NORM-07-collection-engine.md)). | — |
| **NORM-08** | **Search Engine** — F1 (correção do truncamento) ([ADR](NORM-08-search-engine.md)). | F1 com urgência |
| **NORM-09** | **Event Engine** — reserva ([ADR](NORM-09-event-engine.md)). | reserva |
| **NORM-10** | **Smart Collections** (ramo `rule`/`smart` + `collection_cache` + refresh). | reserva |
| **NORM-11** | **Recommendation Engine** (`co_view`, personalização G6). | reserva |
| **HARDEN-08** | Idempotência desacoplada em `idempotency_keys` (§3.3) — pré-req de particionamento. | candidato |

## 9. Invariantes de teste
Σ `order_items.price×qty == orders.total`; golden test de preço (NORM-03); snapshot do resolver por coleção; nenhum pedido/cliente real alterado; `resolve_collection` mantém assinatura congelada + params opcionais; RLS de coluna local não vaza indisponíveis ao anon.
