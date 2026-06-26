# ADR NORM-08 — Search Engine

- **Status:** CONGELADO. **Fase 1 tem urgência de correção** (ver §1); Fases 2/3 reservadas.
- **Origem:** revisão v4 (G5 + crítica adversarial).
- **Princípio:** busca evolutiva **100% Postgres**, em fases **aditivas**, atrás de **UMA RPC `search_products()`** chamada pelo DataService. O frontend/DS nunca veem a tecnologia interna (ILIKE → unaccent → pg_trgm → tsvector): troca-se só o corpo da função e os índices.

## 1. Por que F1 é correção de curto prazo, não escala futura
A crítica encontrou um **bug latente atual**: `DS.getProds` ([App.jsx](../../src/App.jsx) :328-343) busca todos os produtos **sem `limit`** e filtra categoria no cliente. O PostgREST corta em **1000 linhas por padrão** → **a partir de ~1000 produtos o catálogo já chega truncado hoje**, silenciosamente. Logo, mover a busca/listagem para o servidor é **correção**, com gatilho próximo, não "onda de 5-10 anos".

## 2. Contrato da RPC (CORRIGIDO)
A versão original retornava só `(product_id, rank)` e hidratava por um "cache por id" que **não existe** (`_prodCache` é por-query). Corrigido: a RPC **devolve a linha completa do produto**.
```
search_products(p_q text, p_categoria_id text DEFAULT NULL, p_collection text DEFAULT NULL,
                p_limit int DEFAULT 200)
RETURNS TABLE ( <colunas de products>, categories jsonb, rank real )
LANGUAGE sql STABLE;   -- SELECT público (RLS de catálogo); imune ao checkout
```
- DS hidrata direto (mesma forma de `getProds`), sem segundo round-trip.
- **`has_more`** (pedir `p_limit+1`), **não** `count(*) OVER()` (que materializa o conjunto inteiro por página e mata o ganho de escala).
- **Sem cursor/keyset na F1** (LIMIT único alto). Keyset = reserva, junto da F2, com `rank` calculado em subquery/CTE (não dá para referenciar alias no `WHERE`) e tie-break por `id`.

## 3. Fases
**F1 — unaccent + servidor (CORREÇÃO, agora):**
- `WHERE disponivel AND (f_unaccent(nome) ILIKE f_unaccent('%'||q||'%') OR f_unaccent(descricao) ILIKE ... OR f_unaccent(array_to_string(composicao,' ')) ILIKE ...)`. **Incluir `composicao`** (buscar por "morango"/"nutella" é o caso de uso real de cardápio).
- Filtros: `categoria_id` (business); coleção via **EXISTS** em `product_collections` (manual) / predicado (rule) / `collection_cache` (smart) — **nunca** `resolve_collection()` completo dentro do loop de busca.
- **Offline:** DS offline → `null` → `useProducts` cai para `filterMock(catId, search)` (caminho já existente). Obrigatório, não opcional.
- Índice: **`products(categoria_id)`** (fecha G1 da listagem-sem-termo; hoje só existe `(nome,categoria_id)`, ordem errada). `unaccent` puro não precisa de GIN nesta escala.

**F2 — pg_trgm + GIN (RESERVA; typo/substring/prefixo):**
- **Pré-requisito BLOQUEANTE:** `unaccent` é **STABLE**, não `IMMUTABLE` → colunas `GENERATED` o **rejeitam**. Criar wrapper `f_unaccent(text) IMMUTABLE` e usá-lo em tudo (inclusive F1, para consistência).
- `ALTER TABLE products ADD COLUMN busca_txt text GENERATED ALWAYS AS (f_unaccent(lower(nome||' '||coalesce(descricao,'')))) STORED; CREATE INDEX ... USING gin (busca_txt gin_trgm_ops)`. Predicado `%`, rank `similarity()`. **F2 substitui o ILIKE da F1.** Se algum dia passar da F1, **ir para F2 e PARAR** — cobre acento+substring+typo+prefixo, 100% do que delivery precisa.

**F3 — tsvector/full-text (RESERVA; provavelmente NUNCA neste domínio):**
- Stemming "portuguese" sobre nomes de 1-3 palavras ("Açaí 500ml", "Marmita G") não agrega relevância real e pode confundir. Documentado como reserva improvável.

**Motor externo (Meilisearch/Typesense):** só se cruzar ~10k produtos **com** instant-search/facetas **ou** marketplace multi-tenant (G4). Até lá, é um sistema a sincronizar (CDC/reindex/dual-source) sem ganho.

## 4. Compatibilidade
Busca lê `products` via RPC de **leitura**; não toca `create_order`/`order_items`/Pricing/Addons/Checkout/Monte/Batidinhas/HARDEN-01..07. Reusa `unaccent` (instalado), `resolve_collection` (NORM-07), padrão de RPC e DS único. Colunas `GENERATED STORED` aditivas (rollback = drop). Compatível com PG17.

## 5. Recorte
- **AGORA (correção):** F1 (`search_products` devolvendo linha completa + `composicao` + `has_more`; `DS.getProds` delega quando há termo; offline=`filterMock`; índice `products(categoria_id)`).
- **RESERVA:** `f_unaccent` IMMUTABLE + F2 (pg_trgm/GIN), keyset; F3 (tsvector); motor externo; telemetria de busca (depende de [NORM-09](NORM-09-event-engine.md)); `p_store_id`/índices por-tenant se G4=sim.
