# ADR NORM-07 — Collection Engine

- **Status:** CONGELADO (contrato definitivo; só o ramo `manual` é implementado junto do NORM-06; `rule`/`smart` reservados).
- **Origem:** revisão v4 (workflow design+crítica adversarial). Refina o resolver `resolve_collection()` congelado em [NORM-06A v4](NORM-06A-modelo-grupos-catalogo.md) §2.5.
- **Princípio:** o "Collection Engine" **não** é máquina de plugins em runtime nem camada OO no DataService. É **UMA function SQL dispatcher** que despacha por `categories.estrategia` lendo `definicao jsonb`. Open/Closed obtido por **DADO** (novo valor de `estrategia` + ramo isolado), não por framework.

## 1. Onde vive e por quê
No **SQL** (Postgres), com wrapper fino no `DS` (irmão de `getHealth`). Razões: (a) `rule`/`smart` precisam de predicado/cache que vivem no banco (banco = fonte de verdade); (b) o frontend nunca reimplementa a regra; (c) a vitrine precisa de **uma** chamada barata, sem baixar o catálogo no cliente. Rejeitado: registry dinâmico (dynamic SQL = injeção/sem plano), OO no DS (dual-source), híbrido (dual-source).

## 2. Contrato de saída (CORRIGIDO pela crítica)
A crítica derrubou o `origem ∈ {manual,pin,calculado}` original: fundia **dois eixos ortogonais** (curado-vs-calculado e fixado-vs-não), gerando badge inconsistente entre manual e rule/smart. Separados:

```
resolve_collection(p_collection_id text, p_limit int DEFAULT NULL, p_after jsonb DEFAULT NULL)
RETURNS TABLE (product_id uuid, posicao int, origem text, fixado bool)
LANGUAGE plpgsql STABLE;   -- read-only; SECURITY INVOKER + RLS de catálogo
```
- `origem ∈ {'curado','calculado'}` — a linha veio de `product_collections` ou foi derivada (rule/smart).
- `fixado bool` — espelha `product_collections.fixado`. **Pin** = `(origem='curado' AND fixado)` — derivável uniformemente pela UI, sem caso especial.
- `posicao` = **rank GLOBAL** na coleção (estável entre páginas), `row_number()` calculado **antes** de `p_limit`/`p_after`. **Tie-break final obrigatório por `product_id`** (`ordem` não é única → cursor pula/repete sem isso).
- **`p_ctx` REMOVIDO** (a crítica matou): slot de personalização numa função STABLE/cacheável é param morto que muda a natureza de cache se honrado. Personalização (G6) = **função irmã** futura `resolve_collection_for_user(...)`, não slot aqui.
- Assinatura **retrocompatível** com o ADR v3 (`resolve_collection(collection_id)`): `p_limit`/`p_after` são opcionais; `p_limit=NULL` retorna todos com **teto interno de segurança (ex. 500)** — não impõe cursor a uma coleção manual de 8 itens.

## 3. Ramos (despacho por `estrategia`)
- **`manual` (AGORA):** `SELECT product_id, row_number() over(order by fixado desc, ordem, product_id)-1, 'curado', fixado FROM product_collections WHERE collection_id=$1`.
- **`rule` (RESERVA):** pins (`fixado`) `UNION` produtos que satisfazem `definicao` (ver §5). **Correção da crítica:** `eval_predicate` por-linha é **Seq Scan a 10k** — `rule` **também é materializável** (mesmo `collection_cache` + refresh **on-write** por trigger/pg_cron), ou o atributo filtrado é **promovido a coluna real indexada**. Não prometer "STABLE barato em tempo real".
- **`smart` (RESERVA):** pins seguidos de `collection_cache` (materializado por pg_cron a partir de rollups — ver [NORM-09](NORM-09-event-engine.md)). O resolver **nunca** recalcula em tempo de request.
- **Tipos futuros** (recommendation/campaign/ai/external): cada um = novo valor de `estrategia` + ramo isolado/function-satélite. Adicionar **não toca** os ramos existentes (Open/Closed).

## 4. Hidratação (CORRIGIDO)
A hidratação client-side via "cache que o DS já mantém" é **ficção** (`_prodCache` é por-query, não por-id). O resolver/companion **devolve a linha completa do produto** (mesma projeção de `getProds`: `*, categories(...)`) via `WHERE id = ANY(ids)` no banco, **nunca** `getAllProds` + filtro no cliente (senão G1 volta). 
- `DS.resolveCollection(id, {limit, after})` → `[{product_id, posicao, origem, fixado}]` | `null` (offline).
- `DS.getCollectionProducts(id)` → produtos hidratados server-side, preservando `posicao`/`fixado`.
- **Offline:** `null` → a UI cai para "produtos da categoria business" ou esconde a vitrine (decisão de UX antes da F5).

## 5. Definition DSL (`definicao jsonb`, ramo `rule` — RESERVA)
Formato **declarativo, versionado, fechado por whitelist** — **nunca SQL armazenado**. A engine traduz para query **parametrizada** (identificadores/operadores são constantes do servidor; só `value` vira `$n` via `USING`).
```json
{ "v":1, "match":"all", "rules":[{"field":"categoria_id","op":"eq","value":"c-marmitas"},
  {"field":"preco","op":"lte","value":30}], "sort":[{"field":"preco","dir":"asc"}], "limit":40 }
```
- Whitelist de `field` = colunas reais de `products` + derivados read-only; operadores validados por tipo; profundidade ≤3; `limit` clamp 1..200; `v` versiona o schema.
- `validate_collection_definition(jsonb)` em trigger de escrita + reuso no Admin.
- **Ressalvas da crítica (obrigatórias):**
  - **Preço × `tamanhos`:** `preco`/`preco_promo`/`em_promocao` filtram o **preço-base escalar** e **mentem para produtos com `tamanhos`** (Monte c3, Batidinhas c9 — preço real vive em `tamanhos[].preco`). v1: ou **excluir** produtos com `tamanhos IS NOT NULL` dos filtros de preço, ou expor derivados `preco_min`/`preco_max` (COALESCE com `tamanhos`). Documentar.
  - **`em_promocao`** = **uma única expressão SQL compartilhada** com a engine de preço ([NORM-01A](NORM-01A-modelo-canonico-catalogo.md) §1.3) — não duplicar a fórmula no tradutor.
  - **Drift whitelist×schema:** teste de CI **bloqueante** cruzando whitelist com `information_schema`; **revalidação** de todas as `definicao` após migração de coluna (ex.: NORM-06 dropa `image_url`/deprecia `destaque`).

## 6. Compatibilidade
`resolve_collection` é **STABLE/read-only**, sem FK nova; não referencia `create_order`, não escreve `products`/`order_items`. → **Checkout, HARDEN-01..07, idempotência, reconciliação, Monte, Batidinhas, Pricing Engine e Addons Resolver imunes** (coleção é leitura de vitrine). DS ganha só wrappers irmãos de `getHealth`. Reusa pg_cron/unaccent/padrão de RPC.

## 7. Recorte
- **AGORA (NORM-06/07):** ramo `manual`; contrato de saída final (`origem`+`fixado`); `DS.resolveCollection`/`getCollectionProducts`; hidratação server-side.
- **RESERVA (NORM-10+):** ramos `rule`/`smart` (+ `collection_cache`, `eval_predicate`, refresh on-write/cron); DSL ativo; tipos futuros; `resolve_collection_for_user` (G6).
