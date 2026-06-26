# ADR NORM-09 — Event Engine (telemetria de engajamento)

- **Status:** RESERVA ARQUITETURAL (contrato congelado; **não** construído no NORM-06). Ativar só quando "mais visualizados/adicionados" for requisito real — `smart` por **vendas** já roda sobre `order_items` (existe) e vem antes.
- **Origem:** revisão v4 (G3 + crítica adversarial).
- **Princípio:** subsistema **próprio**, fora do core de catálogo e **fora do caminho transacional do pedido**. Reusa pg_cron/unaccent, o padrão `application_logs` (append-only, jsonb sem PII), e `anon_id` no estilo do `request_id` durável.

## 1. Camada 1 — ingestão `engagement_events` (renomeada de `event_log`)
`PARTITION BY RANGE(ts)` mensal; retenção via **DROP PARTITION** (O(1), sem bloat/vacuum — ao contrário do `DELETE` de `purge_old_logs`).
```
engagement_events ( id bigint identity, ts timestamptz default now(),
  event_type text CHECK (product_view|add_to_cart|remove_from_cart|favorite|unfavorite|collection_view|search),
  product_id uuid NULL [SEM FK], collection_id text NULL [SEM FK],
  anon_id uuid NOT NULL, session_id uuid NULL, qty int NULL,
  payload jsonb NULL [sem PII], origin text default 'web', version text,
  PRIMARY KEY (id, ts) )
```
- `product_id`/`collection_id` **sem FK** (mesma decisão de `order_items.product_id`) → catálogo pode mudar/dropar sem travar ingestão.
- **`purchase` NÃO é evento:** vendas são `order_items` (fonte de verdade única). Evitar dupla-fonte de vendas.
- Índices por partição: `(event_type, ts)`, `(product_id, ts) WHERE product_id IS NOT NULL`, `(collection_id, ts) WHERE collection_id IS NOT NULL`.

## 2. Ingestão — caminho ÚNICO endurecido (CORRIGIDO)
A crítica matou os dois caminhos contraditórios: a `VITE_SUPABASE_KEY` é **pública** (embarcada no bundle), então `INSERT` direto de `anon` na tabela = **vetor de flood** que enviesa exatamente os rankings smart.
- **`anon` recebe SÓ `EXECUTE` em `ingest_events(jsonb)`** (SECURITY DEFINER, owner com INSERT). **Zero** INSERT/SELECT direto de anon na tabela (espelha "anon revogado" do HARDEN-07).
- `ingest_events`: **clampa** o tamanho do array (teto de N), valida `event_type`, é **exception-safe** (best-effort real, `PARTITION ... DEFAULT` como rede), rate por `anon_id` opcional, decisão de dedup documentada (telemetria tolera ruído ou `event uuid` do cliente).

## 3. Cliente — `DS.track` (fire-and-forget, batched) (CORRIGIDO)
- `DS.track(eventType, ctx)` bufferiza; flush por **N eventos** ou **T segundos**.
- **Flush no unload via `fetch(url, {keepalive:true, headers:{apikey, Authorization}})`** — **NÃO `navigator.sendBeacon`** (não permite setar o header `apikey` que o PostgREST exige → falharia silenciosamente). Nunca bloqueia render/checkout (try/catch que engole, como `logEvent`).

## 4. Camada 2 — rollups (pg_cron) e Camada 3 — consumo
- `product_metrics_daily(day, product_id, views, add_to_cart, favorites)` incremental (lê só a partição do dia).
- `product_metrics_rollup(product_id PK, views_30d, atc_30d, fav_total, score_smart, computed_at)` — janela 30d (não reservar 7/30/90 especulativamente).
- **`score_smart` v1 = só `add_to_cart` + compra (de `order_items`)** — sinais com custo para bot. `product_view` → **só analytics admin**, fora do ranking público (corta o loop de feedback de bot sem antifraude pesado).
- `purch_*` derivado **exclusivamente de `order_items`**, rotulado **métrica de ranking** (nunca receita).
- `collection_cache(collection_id, product_id, posicao, computed_at)` (reserva G2 do NORM-06A) é populado a partir do rollup; `resolve_collection('smart')` só **lê** o cache.

## 5. Reserva-dentro-da-reserva
`co_view(product_a, product_b, weight)` para recommendations ([NORM-11], lookup O(1) por sessão) e personalização (G6) — **não modelar** até haver demanda.

## 6. Compatibilidade
Puramente **aditivo e desligável**. Não toca `create_order` (sem FK em `product_id`/`collection_id`), Pricing, Addons, Monte, Batidinhas, DS existente, HARDEN-01..07. Reusa pg_cron/unaccent/padrão sem-PII de `application_logs`/painel `orders_health`. Se nunca for ligado, catálogo e checkout funcionam idênticos.

## 7. Pré-condições de ativação
- **Multi-tenant (G4):** se virar marketplace, `engagement_events`/rollups precisam de `store_id` **antes** de fixar (retrofit em tabela particionada + rollups é caro).
- **Gatilho:** só quando "mais visualizados/adicionados" for pedido explícito. Smart por vendas (order_items) não depende deste subsistema.
