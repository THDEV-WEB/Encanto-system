# ADR NORM-06 — Implementação do Catálogo: Collections (Categorias de Negócio × Coleções)

- **Status:** 🔒 **ARQUITETURA CONGELADA** (ver §Status de Governança) · **D-DEST aprovada (A)**.
- **Status de implementação:** **F1A (estrutura) APLICADA** em 2026-06-28 na branch `feature/norm-06-f1a` (tag `norm-06-f1a-complete` → `4177a45`); **F1B (invariantes STI), F1C/NORM-06.1 (RLS) e F2+ (backfill/DataService/Admin/UI) pendentes**; **não** integrada à `main`. Evidências e ledger no [F1A — Execution Plan](NORM-06-F1A-execution-plan.md). *(A arquitetura deste ADR permanece imutável — apenas o status de implementação foi anotado.)*
- **Base congelada:** [NORM-06A v4](NORM-06A-modelo-grupos-catalogo.md) (modelo) + [NORM-07](NORM-07-collection-engine.md) (Collection Engine, ramo `manual`). Referência: [NORM-01A](NORM-01A-modelo-canonico-catalogo.md).
- **Revisão:** incorpora a **"Revisão Arquitetural Final (Hardening do Plano)"** + uma **revisão adversarial** (12 revisores) sobre este ADR + a **rodada de hardening final** (5 pontos: D-DEST aprovada, reforço da policy temporária, F1A só-estrutura, ordem de retorno congelada, escopo fechado) — tudo em 2026-06-27. Não muda o objetivo (Collections) — endurece contratos, reduz risco e **fecha as inconsistências** que a revisão encontrou.
- **Escopo:** **EXCLUSIVAMENTE Collections.** RLS e remoção de legado são **explicitamente extraídos** (ver §1.2 e §15).

---

## 0. Estado verificado (ground truth, 2026-06-27 — banco `hvbcdxsagkjtfjwvnslo` + código)

| Fato | Verificado |
|---|---|
| `categories` tem | `id(text PK), nome, ordem, ativo, created_at, icone, cor` — e nada mais |
| `categories` **não** tem | `slug, descricao, imagem, banner, tipo, estrategia, definicao, starts_at, ends_at` → **tudo net-new** |
| `products` tem | `…, categoria_id(text), image_url(legado), imagem_url, destaque, ordem(999), tamanhos, composicao, …` |
| `products` **não** tem | `categoria_ids` → fantasma (só cliente/MOCK) · `variantes`/`subgrupo` → fantasma |
| `product_collections` | **não existe** (net-new) |
| Volume | **39 produtos** (34 disponíveis), **9 categorias**, **10** linhas com `image_url` legado, **3** com `destaque=true` |
| RLS | **ligado** nas 5 tabelas; SELECT público = `USING (true)` em `products` e `categories` |
| **Vitrine "Destaques" HOJE** | renderizada por **`categoria_id='c8'`** ([App.jsx:3456](../../src/App.jsx#L3456) `prodInCat(p,'c8') && disponivel`) = **1 produto** (Encanto Mineiro). `nome.includes('destaque')` ([App.jsx:3466](../../src/App.jsx#L3466)) só define o **estilo** da seção |
| `destaque=true` | flag **lida apenas pelo admin** ([App.jsx:1556/1591/1785](../../src/App.jsx#L1556)) — **não alimenta nenhuma vitrine** na loja hoje. Marca 3 produtos (c1×2 + c8×1) que **não aparecem juntos** em lugar nenhum atualmente |
| Truncamento PostgREST | **já corrigido** por `fetchAllProductsSafe`/`PRODUCTS_PAGINATE` ([App.jsx:209-264](../../src/App.jsx#L209)) — `getProds/getAllProds` **já paginam** |

**Categorias reais** (ordem · nome · nº produtos): `c5 Marmitas(7) · c8 Destaques(1) · c4 Copos Prontos(5) · c3 Monte(5) · c9 Batidinhas(4) · c1 Combos(3) · c10 Fitness(2) · c7 Bebidas(10) · c2 Promoção(2, INATIVO)`.

---

## 1. Objetivo e fronteiras de escopo

### 1.1 Objetivo
Implementar o modelo **1 categoria de negócio por produto + N coleções** (junção `product_collections`) e o ramo `manual` do Collection Engine, de forma **aditiva** e **sem mudar o comportamento da loja** (mesmos produtos visíveis, mesmos preços) e **sem tocar o checkout**.

### 1.2 NÃO-objetivos (extraídos — fases próprias)
| Tema | Por que sai do NORM-06 | Para onde vai |
|---|---|---|
| **RLS / policies de tabelas existentes** | altera comportamento externo (PostgREST) + segurança — preocupação independente | **NORM-06.1 / HARDEN-RLS** |
| **Remoção de legado** (`image_url`, `destaque`) | limpeza destrutiva espera produção estável | **HARDEN-LEGACY** |
| Ramos `rule`/`smart` + DSL + cache | reserva de escala | NORM-10 |
| `list_products` keyset (escala) | truncamento **já corrigido** hoje (§0/§14) → é otimização, não correção | **F3b** (futuro) |
| Reconciliação do modelo dual (`acai`×`simples`) | dívida de dados/UX | NORM dedicado |
| Multi-tenant `store_id` materializado | over-engineering; só o contrato é congelado (§3, G4) | reserva |
| Particionamento + `idempotency_keys` | toca a costura do checkout | HARDEN-08 |

---

## 2. Lista completa das alterações incorporadas nesta revisão

> Todas **apenas no desenho/ADR** — nenhuma no código/banco.

1. **RLS removido do escopo (ponto 1).** A proposta `anon→só disponíveis / authenticated→todos` **NÃO entra** no NORM-06 → vira **NORM-06.1 / HARDEN-RLS**. Registro explícito: RLS é preocupação independente; fase própria; não faz parte da migração de Collections; **nenhuma policy de tabela existente é alterada**. *(A postura de leitura da tabela **nova** `product_collections` é tratada em §7 F1A como postura inicial aditiva — ver §11/decisão D-RLS.)*
2. **Contrato do Collection Engine congelado (ponto 2).** `resolve_collection()` retorna **somente membros** — **4 campos** `(product_id, posicao, origem, fixado)`, alinhado ao contrato congelado de [NORM-07 §2](NORM-07-collection-engine.md) e [NORM-06A §2.5](NORM-06A-modelo-grupos-catalogo.md). **Nunca** Product completo / dados hidratados / preço / imagem / descrição. Hidratação = **camada superior**. Detalhe em §4.
3. **STI vira invariante arquitetural (ponto 3).** Estados inválidos **impossíveis de persistir**, enforçados no banco (triggers + CHECKs). Detalhe em §5.
4. **Guard de colisão de slugs (ponto 4).** Relatório **bloqueante** antes do `UNIQUE`; qualquer colisão → **ABORTAR**; nunca auto-corrigir. Guard e backfill usam a **mesma expressão**. Detalhe em §6; DoD §9.
5. **Remoção de `image_url` adiada (ponto 5).** **Nenhum `DROP COLUMN`** no NORM-06. `image_url`/`destaque` ficam **dormentes** → **HARDEN-LEGACY**. Dívida em §14.
6. **F1 dividida (ponto 6):** **F1A** (DDL) · **F1B** (triggers/invariantes) · **F1C** (RLS — **REMOVIDO**, reservado).
7. **Documentação reconciliada (ponto 7):** ADR, migração, rollback, DoD, riscos, cronograma — sem inconsistências; divergências deliberadas da base congelada explicitadas em §16.
8. **Nada aplicado (ponto 8).**

**Correções da revisão adversarial (fecham inconsistências/risco que a própria revisão encontrou):**
- **C1 (era blocker):** a vitrine Destaques é alimentada **por `categoria_id='c8'` (1 produto)**, não pelo flag `destaque`. O backfill F2 passa a preservar **exatamente** esse conteúdo (1 membro) → **zero mudança de comportamento**. A semântica "3 produtos do flag" vira **decisão explícita** (§3, D-DEST), não default.
- **C2:** contrato do resolver fixado em **4 campos** (não 5; `ordem` é chave **interna** de ordenação, não retornada) — alinhado a NORM-07/NORM-06A.
- **C3:** postura de RLS da tabela **nova** `product_collections` tornada explícita em F1A (espelha o regime público atual; não altera policy existente).
- **C4:** F3 reconciliada — o truncamento que NORM-06A §3.1 chamava de "correção" **já está corrigido** no código (§0/§14); `list_products` é otimização (F3b). Divergência documentada em §16.

**Hardening final (consolidação do desenho, 5 pontos):**
- **H1 — D-DEST aprovada = A:** decisão de produto registrada na seção [Decisões de Produto](#decisões-de-produto); migrar p/ `destaque=true` é ADR futuro, nunca no NORM-06.
- **H2 — policy temporária reforçada:** a abertura pública de `product_collections` é declarada **provisória** (não é a política de segurança definitiva; revisão integral no HARDEN-RLS) — F1A item 2 e §15.
- **H3 — F1A só estrutura:** F1A separa **estrutura (DDL)** da **permissão**; a permissão aparece destacada como **medida temporária de compatibilidade**, não como desenho estrutural (sem criar F1D).
- **H4 — ordem de retorno congelada:** a ordem dos membros de `resolve_collection` faz parte do **contrato público** (§4) — sem reordenar por conveniência/alfabética/preço sem novo ADR.
- **H5 — escopo fechado confirmado:** §17 confirma que o NORM-06 contém só Collections/STI/Engine/Backfill/UI e que nenhum item proibido (cache, endpoints, serviços, otimizações, RPCs extras, tabelas fora do desenho, mudança de comportamento) entrou; índices de paginação movidos para F3b.

**Governança final (3 pontos, só documentação):**
- **G1 — regra institucional de quebra de contrato** do Collection Engine (§4): add/remove/rename campo, mudar tipo/semântica ou ordem só via novo ADR + revisão arquitetural + atualização da suíte de testes.
- **G2 — §18 "Estado após implementação prevista":** registra o estado oficial da arquitetura pós-NORM-06 (para quem abrir só este ADR no futuro).
- **G3 — §19 "Próximo ADR":** continuidade documental → NORM-06.1 (HARDEN-RLS) com objetivos previstos.

---

## 3. F0 — Decisões a ratificar **antes** de aplicar F1A

**R1 — classificação business × collection** (conservadora):
- **business:** c5, c4, c3, c9, c7, c1, c10.
- **collection (`manual`):** **c8 Destaques**.
- **c2 Promoção do Dia:** **não vira coleção** (inativa; 2 órfãos `disponivel=false` sem `preco_promo`). Promoções reais = coleção `rule` (NORM-10). Órfãos recebem business home e ficam `disponivel=false`.

**Produtos que precisam de business home antes da conversão (único trabalho manual — 3 linhas):**

| Produto | id | Hoje | → business home |
|---|---|---|---|
| Encanto Mineiro | `45e97133…` | c8 | **c4 Copos Prontos** (+ membro Destaques) |
| Marmita G 2 Prot Açaí 500 | `94da9683…` | c2 | **c1 Combos** (`disponivel=false`) |
| Marmita M com Refri Lata | `ec64e9d1…` | c2 | **c1 Combos** (`disponivel=false`) |

**D-DEST — conteúdo da vitrine Destaques:** **APROVADA = A (preservar a vitrine atual, 1 produto).** Decisão registrada na seção [Decisões de Produto](#decisões-de-produto). A migração para a semântica do flag `destaque` (3 produtos) é decisão **futura**, em ADR próprio, **nunca** dentro do NORM-06.

**D-RLS — postura da tabela nova `product_collections`** *(decisão; ver §7 F1A):* nasce com a **mesma postura pública das tabelas de catálogo de hoje** (RLS on + `SELECT TO public USING(true)`) — espelha o regime atual, **não** altera policy existente e **não** é a hardening anon/authenticated (que segue na NORM-06.1). Alternativa: gatear a vitrine na NORM-06.1.

**D1 — `categoria_ids`:** remover (fantasma) → multi-pertença = `product_collections` (limpeza do cliente em F6).
**D3 — `variantes`:** **fora** do NORM-06 (fantasma).
**G4 — multi-tenant:** não materializar; congelar contrato — toda `UNIQUE`/FK nova nasce documentada com `store_id` na frente (`UNIQUE(slug)` → futura `(store_id, slug)`).
**§3.3 — idempotência × particionamento:** **NORM-06 não particiona** → idempotência do HARDEN-03 intocada. Desacoplamento = HARDEN-08.

---

## Decisões de Produto

### D-DEST

**Status:** Aprovada (2026-06-27).

**Escolha:** Opção A — preservar exatamente a vitrine atual.

**Decisão:** a coleção "Destaques" deve continuar exibindo **exatamente o mesmo conteúdo que a aplicação mostra hoje** — **1 produto** (Encanto Mineiro, via `categoria_id='c8'`). Não se aproveita o NORM-06 para alterar comportamento funcional.

**Justificativa:**
- o objetivo do NORM-06 é **arquitetura**, não mudança funcional;
- **zero mudança de comportamento** na loja;
- a eventual mudança para usar o campo `destaque=true` (3 produtos) é **decisão futura de produto** e será tratada em **ADR específico — nunca dentro do NORM-06**.

**Consequência no desenho:** o backfill F2 (§7) usa como fonte o conteúdo atual da vitrine (`categoria_id='c8'`), inserindo o único produto que ela exibe hoje; o flag `destaque` permanece dormente (dívida em §14).

---

## 4. Contrato congelado do Collection Engine (ponto 2)

> **Contrato público do domínio.** Congelado e **alinhado** a [NORM-07 §2](NORM-07-collection-engine.md) e [NORM-06A §2.5](NORM-06A-modelo-grupos-catalogo.md).

`resolve_collection(p_collection_id text, p_limit int DEFAULT NULL, p_after jsonb DEFAULT NULL)` — função SQL `STABLE`, ramo `manual`. **`RETURNS TABLE (product_id uuid, posicao int, origem text, fixado bool)`** — exatamente **4 campos**:

| Campo | Significado |
|---|---|
| `product_id` (uuid) | identidade do membro |
| `posicao` (int) | rank **global** estável: `row_number()` sobre `(fixado DESC, ordem, product_id)`, antes de `p_limit/p_after`; tie-break final por `product_id` |
| `origem` (text) | `'curado'` (de `product_collections`) — `'calculado'` reservado p/ rule/smart |
| `fixado` (bool) | espelha `product_collections.fixado`; **pin** = `origem='curado' AND fixado` |

**`ordem` NÃO é retornado.** É apenas a **chave interna de ordenação** (`product_collections.ordem`) consumida pelo `row_number()` para produzir `posicao` — idêntico ao `ORDER BY` do ramo `manual` de NORM-07 §3.

**A ORDEM dos membros retornados faz parte do contrato público da API.** O resolver retorna os membros ordenados por `(fixado DESC, ordem, product_id)` e a UI **depende dessa ordem** para renderizar a vitrine. Portanto a ordenação é **congelada** junto com os campos:
- **não** alterar a ordenação por conveniência;
- **não** ordenar alfabeticamente;
- **não** ordenar por preço;
- **não** alterar nenhum critério de ordenação (nem o tie-break por `product_id`) **sem novo ADR**.
Qualquer mudança de ordenação é uma mudança de contrato arquitetural, não um detalhe de implementação.

**O resolver NUNCA retorna:** Product completo · dados hidratados · `preco`/`preco_promo` · `imagem_url` · `descricao` · qualquer campo de exibição.
**O resolver NÃO conhece:** UI · React · DataService. É SQL puro de **pertença**.

**Hidratação = camada superior.** `DS.getCollectionProducts(id)` chama `resolve_collection`, coleta os `product_id` e **hidrata por id** (`WHERE id = ANY(ids)`, projeção idêntica a `getProds`). **Guard G1:** hidratação **limitada por id** — **proibido** `getAllProds()` + filtro no cliente.

### Regra institucional da API do Collection Engine (quebra de contrato)

`resolve_collection` é **contrato público**. Constituem **quebra de contrato público** quaisquer das alterações abaixo:
- **adicionar** novos campos retornados;
- **remover** campos;
- **renomear** campos;
- **alterar o tipo de dados** de um campo;
- **alterar o significado semântico** de um campo (ex.: o que `origem`/`fixado`/`posicao` representam);
- **alterar a ordem de retorno** dos membros.

Nenhuma dessas alterações pode ser feita por conveniência ou em silêncio. Cada uma só é permitida mediante **os três simultaneamente**:
1. **novo ADR** que documente a mudança e sua motivação;
2. **revisão arquitetural** (impacto em UI, hidratação, NORM-07/NORM-06A, consumidores);
3. **atualização da suíte de testes correspondente** (snapshot do resolver) refletindo o novo contrato.

Esta é uma **regra institucional** da API: o contrato (campos + tipos + semântica + ordem) é estável por padrão; mudá-lo é um evento arquitetural deliberado, nunca um detalhe de implementação.

---

## 5. Invariante arquitetural STI (ponto 3) — parte do modelo de domínio

> Não é "uma validação". É **regra do modelo de domínio**, enforçada no banco, tornando estados inválidos **impossíveis de persistir**.

Estados **impossíveis** (rejeitados pelo banco):
- **(I1)** categoria `tipo='business'` referenciada em `product_collections.collection_id`.
- **(I2)** categoria `tipo='collection'` usada como `products.categoria_id`.
- **(I3)** `adicionais.aplica_categoria_id` apontando `tipo!='business'` (mantém NORM-06A §2.4).
- **(I4)** troca de `categories.tipo` que gere inconsistência (business→collection com produtos apontando-a como `categoria_id`; collection→business com linhas em `product_collections`).

Enforço (desenhado para F1B):
- CHECKs STI estruturais na `categories` (estrutura/só-coleção) — em F1A (§7).
- Triggers cross-table (FK não filtra por coluna de outra tabela):
  - `BEFORE INSERT/UPDATE OF categoria_id ON products` → exige `tipo='business'` (I2).
  - `BEFORE INSERT/UPDATE OF collection_id ON product_collections` → exige `tipo='collection'` (I1).
  - `BEFORE UPDATE OF tipo ON categories` → bloqueia troca inconsistente (I4).
  - (mantém) `adicionais.aplica_categoria_id → business` (I3).

> **Os invariantes condicionam a ORDEM do backfill F2** (§7): por I1 e I4, não dá para inserir membros de uma coleção antes de ela ser `collection`, nem flipar `c8→collection` enquanto produtos a apontam como `categoria_id`. A sequência F2 abaixo respeita isso.

Registro: estas regras **fazem parte do modelo de domínio do catálogo**; qualquer evolução futura deve preservá-las.

---

## 6. Guard de colisão de slugs (ponto 4)

Antes de criar a `UNIQUE(slug)` (F1A), executar **obrigatoriamente** o relatório bloqueante — **mesma expressão** usada no backfill:

```sql
-- GUARD BLOQUEANTE: lista slugs que colidiriam. Se retornar QUALQUER linha → ABORTAR.
SELECT slug, count(*) AS n, array_agg(id) AS ids
FROM (SELECT id, lower(regexp_replace(unaccent(nome),'[^a-z0-9]+','-','g')) AS slug
      FROM public.categories) s
GROUP BY slug HAVING count(*) > 1;
```

Fluxo: **Categorias → slug gerado → existe colisão? → SIM → ABORTAR.**
**Proibido:** auto-corrigir · renomear · adicionar `-1`/números. Havendo colisão, a migração **falha**; o operador resolve **manualmente** e reexecuta. O backfill F1A **DEVE** usar **byte-a-byte a mesma expressão** (`lower(regexp_replace(unaccent(nome),'[^a-z0-9]+','-','g'))`) para o relatório prever de fato o resultado do `UNIQUE`. Registrado no DoD (§9).

---

## 7. Plano de migração — fases (escopo · diff desenhado · rollback · teste · evidência)

> Todo diff abaixo é **desenho, não aplicado**. Backup (`snapshot.mjs <label>`) antes de **toda** fase com DDL/DML.

### F1A — DDL estrutural (schema · tabelas · índices · constraints · guard de slug) `[backup: NORM-06-F1A]`
**Escopo:** **exclusivamente estrutura de banco.** **Sem triggers de invariante (F1B). Sem qualquer redesenho de RLS (F1C).** A F1A não contém decisão de segurança — a única configuração de permissão necessária para a tabela nova aparece **destacada abaixo como medida temporária de compatibilidade**, fora do desenho estrutural.
**Execução:** seguir **obrigatoriamente** o checklist operacional [F1A — Execution Plan](NORM-06-F1A-execution-plan.md) — procedimento institucional (pré-condições → 11 etapas em ordem imutável → abort imediato em qualquer falha). É o roteiro oficial desta fase.

**1) Estrutura (DDL) — o desenho de fato:**
- **Colunas (`ALTER TABLE categories ADD COLUMN IF NOT EXISTS`)** → `slug, descricao, imagem, banner, tipo (NOT NULL DEFAULT 'business')`, `estrategia, definicao(jsonb), starts_at, ends_at`. (`tipo … DEFAULT` é metadata-only/instantâneo no PG11+.)
- **Guard de slug (§6) — bloqueante — ANTES de** `UPDATE … slug` e do `UNIQUE`.
- **Backfill de slug:** `UPDATE categories SET slug = lower(regexp_replace(unaccent(nome),'[^a-z0-9]+','-','g'))` (**mesma expressão do guard**) → `ALTER COLUMN slug SET NOT NULL`.
- **Constraints:** `ADD CONSTRAINT categories_slug_uk UNIQUE (slug)` (G4: futura `(store_id, slug)`); CHECKs STI **estruturais** — `tipo IN ('business','collection')`; `estrategia IN ('manual','rule','smart')`; só-coleção isolado por CHECK; business exige `estrategia IS NULL`.
- **Tabela nova:** `CREATE TABLE product_collections (id, product_id→products, collection_id→categories, ordem, fixado, created_at, UNIQUE(product_id,collection_id))`.
- **Índices (do Collection Engine):** `pc(collection_id, fixado DESC, ordem)`, `pc(product_id)` — backam diretamente o `resolve_collection` (são parte do motor, não otimização avulsa). *(Os índices de `products` para paginação — `products(categoria_id)`, `products(disponivel, ordem, id)` — **NÃO entram na F1A**: são diferidos para a F3b junto com `list_products`, fora do escopo do NORM-06 — ver §5/§17.)*

**2) ⚠️ Medida TEMPORÁRIA de compatibilidade (permissão — NÃO faz parte do desenho estrutural):**
```sql
ALTER TABLE product_collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY pc_public_read ON product_collections FOR SELECT TO public USING (true);
```
> **A política pública aplicada à tabela `product_collections` existe exclusivamente para preservar a compatibilidade com o comportamento atual da aplicação (mesmo regime `USING(true)` que `products`/`categories` já têm hoje). Ela NÃO representa a política definitiva de segurança e será integralmente revisada no HARDEN-RLS (NORM-06.1).**

Esta linha **não** altera nenhuma policy de tabela existente; é só a postura inicial mínima para a vitrine conseguir ler a tabela nova (com RLS on e zero policy, o anon receberia 0 linhas e a vitrine quebraria). Não interpretar esta abertura como decisão permanente.

**Rollback:** `DROP TABLE product_collections` (leva a policy temporária junto); `ALTER TABLE categories DROP CONSTRAINT/COLUMN …`; `DROP INDEX …` + snapshot. (Nenhuma policy de tabela existente a restaurar.)
**Teste:** introspecção `\d+` bate o contrato; CHECKs estruturais rejeitam linha inválida; anon lê `product_collections` (vitrine viável); `npm run build` verde.
**Evidência:** introspecção pós-DDL + build verde + pedido real (telefone `44`) intacto.

### F1B — Triggers / invariantes STI (ponto 3) `[backup: NORM-06-F1B]`
**Escopo:** só os invariantes I1–I4 (§5). Isolado de F1A → rollback de invariante **não** toca schema.
**Rollback:** `DROP TRIGGER … ; DROP FUNCTION …` (estrutura F1A permanece).
**Teste:** negativos (membro de categoria business → rejeitado; `categoria_id`→collection → rejeitado; flip de `tipo` inconsistente → rejeitado) **e** positivos (operações legítimas passam, inclusive a sequência F2).
**Evidência:** suíte negativos/positivos verde + build verde.

### F1C — RLS (de tabelas existentes) — **REMOVIDO DESTE NORM** ⛔ → **NORM-06.1 / HARDEN-RLS**
**Nenhuma policy de tabela existente é criada ou alterada no NORM-06.** As policies `USING(true)` atuais de `products`/`categories` permanecem **exatamente como estão**. A fase existe na numeração só para **registrar a extração deliberada**: RLS (redesenho anon/authenticated) é preocupação independente, fase própria, **não** parte de Collections. *(A postura da tabela nova `product_collections` é F1A/D-RLS, não esta hardening.)*

### F2 — Backfill (só coleções) `[backup: NORM-06-F2]` — **assume D-DEST (A) preservar**
**Sequência obrigatória** (ditada pelos invariantes I1/I4 — §5):
```sql
BEGIN;
-- 1) realojar ex-membro(s) de c8 ao business home (Encanto Mineiro c8→c4) ANTES do flip (I4)
UPDATE products SET categoria_id='c4' WHERE id='45e97133…';
-- 2) realojar órfãos de c2 → c1 (disponivel=false preservado)
UPDATE products SET categoria_id='c1' WHERE id IN ('94da9683…','ec64e9d1…');
-- 3) c8 → coleção manual (agora nenhum produto a aponta como categoria_id; I4 ok)
UPDATE categories SET tipo='collection', estrategia='manual' WHERE id='c8';
-- 4) pertença = CONTEÚDO ATUAL da vitrine (o que a seção c8 mostrava hoje) — preserva comportamento
INSERT INTO product_collections (product_id, collection_id, ordem, fixado)
VALUES ('45e97133…','c8',0,false) ON CONFLICT DO NOTHING;   -- Encanto Mineiro (1 membro)
COMMIT;
```
> O membro inserido (Encanto Mineiro) é exatamente o produto que `prodInCat(p,'c8')` retorna hoje. Resultado: **vitrine Destaques mostra 1 produto, idêntico a hoje.** *(D-DEST (B) trocaria o passo 4 por `SELECT … WHERE destaque IS TRUE` = 3 membros — mudança deliberada.)*

**Rollback:** inverso explícito (reverter `categoria_id`, `tipo`; `DELETE` membros) + snapshot.
**Teste:** Destaques resolve **1** membro (== hoje); **0** produtos com `categoria_id` apontando coleção (I2); reexecução = `0 rows` (idempotente).
**Evidência:** contagem de membros (=1) + "0 órfãos de invariante".

### F3 — Collection Engine + DataService `[sem DDL de dados]`
**Escopo:** `resolve_collection` ramo `manual` (contrato §4, **4 campos**); `DS.resolveCollection(id,{limit,after})` (membros) + `DS.getCollectionProducts(id)` (**hidratação na camada superior**, por id).
**`getProds/getAllProds` permanecem como estão — e isso é correto:** o truncamento de 1000 linhas que [NORM-06A §3.1](NORM-06A-modelo-grupos-catalogo.md) tratava como "correção pendente" **já está corrigido** por `fetchAllProductsSafe`/`PRODUCTS_PAGINATE` ([App.jsx:209-264](../../src/App.jsx#L209)) — ambos **já paginam** o PostgREST. Logo `list_products` keyset (NORM-06A §3.1) é **otimização de escala**, não correção → **F3b**, futura. *(Divergência deliberada da base congelada — §16.)* **A F3b** (futura, fora do NORM-06) é também onde entram os índices de paginação `products(categoria_id)` e `products(disponivel, ordem, id)` — por isso **não** estão na F1A.
**Rollback:** `DROP FUNCTION resolve_collection`; remover wrappers do DS (`git revert`).
**Teste:** snapshot do resolver p/ c8 (`origem='curado'`, `fixado=false`, `posicao=0`, 1 linha); offline → `null`; `getProds` byte-idêntico; hidratação **nunca** chama `getAllProds`.
**Evidência:** snapshot do resolver + build verde + `getProds` inalterado.

### F4 — Admin
**Escopo:** toggle `tipo`, editor de pertença da coleção (add/remove/reordenar/`fixado`), campo `slug`; **paginar as leituras admin ainda unbounded** (`getAllAds` e congêneres que hoje não usam `fetchAllProductsSafe`; `getAllProds` já pagina). Aditivo.
**Rollback:** `git revert`. **Teste:** editar membros de c8 reflete no resolver; loja inalterada.

### F5 — UI (navegação business + vitrines)
**Escopo:** Home = nav por `tipo='business'` + vitrines por coleção (`DS.getCollectionProducts`). "Destaques" passa a ser vitrine alimentada por `product_collections` (não mais por `categoria_id=c8` direto). Substitui o acoplamento cosmético `nome.includes('destaque'/'combo')`. **Conteúdo preservado** (D-DEST A → 1 produto). UX offline (`resolveCollection→null`): cair p/ grade da categoria business ou esconder a vitrine (decidir antes da F5).
**Rollback:** `git revert`. **Teste:** vitrine Destaques exibe **o mesmo 1 produto** de hoje; grades por categoria business com conjunto **idêntico** antes/depois.

### F6 — Limpeza (somente cliente, **não-destrutiva**) `[sem DROP de coluna]`
**Escopo:** remover a lógica fantasma `categoria_ids` do cliente (`prodInCat`/`prodCats`) e o acoplamento `nome.includes('destaque'/'combo')`. **Sem `DROP COLUMN`.**
**Adiado p/ HARDEN-LEGACY (ponto 5):** `DROP COLUMN products.image_url` e `products.destaque` — após produção estável. Até lá, dormentes (não lidos) + dívida (§14).
**Rollback:** `git revert` (cliente). **Teste:** build verde; nenhuma referência a `categoria_ids`/`includes('destaque')` remanescente; loja inalterada.

---

## 8. Plano de rollback (consolidado)

| Fase | Rollback |
|---|---|
| F1A | `DROP TABLE product_collections` (leva a policy nova junto); `ALTER TABLE categories DROP CONSTRAINT/COLUMN …`; `DROP INDEX …` + snapshot |
| F1B | `DROP TRIGGER/FUNCTION …` (schema F1A intacto) |
| F1C | — (nada aplicado; nenhuma policy de tabela existente tocada) |
| F2 | inverso de `categoria_id`/`tipo`; `DELETE` membros + snapshot |
| F3 | `DROP FUNCTION resolve_collection` + `git revert` (DS) |
| F4/F5/F6 | `git revert` (cliente) |
| HARDEN-LEGACY (futuro) | re-`ADD COLUMN` + restore do snapshot |

**Propriedade-chave:** rollback de **invariante** (F1B) ou de **segurança** (F1C, no-op) **não** obriga a desfazer o **schema** (F1A).

---

## 9. DoD (Definition of Done)

**Por fase:** `npm run build` verde + teste específico + **pedido real (telefone `44`) preservado** + linha de rollback no commit + commit único por fase.

**Global:**
- [x] **D-DEST decidida = A** (preservar; ver [Decisões de Produto](#decisões-de-produto)).
- [ ] **F0 ratificada** (R1, D-RLS, D1, D3, G4, §3.3) antes de qualquer DDL — D-DEST já fechada.
- [ ] **GUARD de slug (§6) executado e VERDE** (zero colisões) antes do `UNIQUE`; **backfill usa a mesma expressão do guard**. Colisão ⇒ migração abortada, **sem** auto-rename.
- [ ] Invariante STI (I1–I4) com **testes negativos e positivos** verdes.
- [ ] `resolve_collection` respeita o contrato **4 campos** (§4); hidratação **só por id** (guard G1).
- [ ] **Nenhuma policy de tabela existente** (`products`/`categories`) criada/alterada. A policy de `product_collections` (tabela nova) **espelha o regime público atual** (não é a hardening anon/authenticated).
- [ ] **Nenhum `DROP COLUMN`** no NORM-06.
- [ ] `test:deps`, `test:pricing`, `test:addons` permanecem verdes.
- [ ] **Vitrine Destaques exibe o mesmo conjunto de hoje** (D-DEST A → 1 produto) e as grades business são idênticas antes/depois.
- [ ] Memória + status dos ADRs atualizados ao fim.

---

## 10. Matriz de riscos

### Mitigados
| Risco | Antes | Mitigação |
|---|---|---|
| **R-RLS** (cegar admin; mudar comportamento externo) | G9 dentro do NORM-06 | **Removido** → NORM-06.1; nenhuma policy de tabela existente tocada |
| **R-Destaques** (mudar nº de produtos visíveis) | backfill por `destaque=true` (3) | backfill por **conteúdo atual** (`categoria_id=c8`, 1) → preserva (D-DEST A) |
| **R-slug** (colisão silenciosa / auto-rename) | backfill direto | **GUARD bloqueante** + **mesma expressão** guard↔backfill (§6) |
| **R-rollback amplo** | F1 monolítica | **F1A/F1B/F1C** separadas (§7/§8) |
| **R-legado destrutivo** | F6 dropava `image_url` | **Adiado** p/ HARDEN-LEGACY (§14) |
| **R-hidratação** (G1) | hidratação ambígua | contrato §4: hidratar **só por id**; resolver members-only (4 campos) |
| **R-invariante fraco** | validação em código | **invariante de banco** (triggers+CHECK, §5) |
| **R-vitrine sem leitura** (tabela nova RLS) | F1A silenciosa | postura pública explícita em F1A/D-RLS |

### Remanescentes (aceitos / a ratificar)
| Risco | Natureza | Tratamento |
|---|---|---|
| **R1** | decisão de classificação (dados) | veredito conservador + ratificação F0 *(D-DEST já aprovada = A, §Decisões de Produto)* |
| **R-admin-auth** | depende do fluxo de auth do admin | diferido com NORM-06.1 (RLS saiu) |
| **Dívida de legado** (`image_url`/`destaque` dormentes) | dívida técnica | §14; HARDEN-LEGACY |
| **Trigger STI bloqueando escrita legítima** | implementação | testes positivos na F1B; F1B isolada |
| **Slug colidindo no F0** | operação | guard aborta; resolução humana |

---

## 11. Cronograma das fases

```
F0  Ratificar (R1, D-DEST, D-RLS, D1, D3, G4, §3.3)
 └─ F1A  DDL aditivo + GUARD slug + postura pública de product_collections
     └─ F1B  Triggers/invariantes STI (I1–I4)
         └─ [F1C  RLS de tabelas existentes — REMOVIDO → NORM-06.1/HARDEN-RLS]
             └─ F2  Backfill (realojar 3 produtos; c8→manual; Destaques=1 membro)
                 └─ F3  Collection Engine (resolve_collection 4 campos) + DS
                     └─ F4  Admin
                         └─ F5  UI (nav business + vitrines)
                             └─ F6  Limpeza cliente (não-destrutiva)

Pós-estabilização (fases próprias, fora do NORM-06):
   NORM-06.1 / HARDEN-RLS   — policies anon/authenticated (tabelas existentes)
   HARDEN-LEGACY            — DROP image_url, DROP destaque
   F3b / NORM-08            — list_products keyset (escala)
   NORM-10                  — ramos rule/smart + cache
```

---

## 12. Prova de não-regressão e **confirmação de zero mudança de comportamento**

Após as correções da revisão adversarial, o desenho **não introduz nenhuma mudança de comportamento** (assumido D-DEST A) — apenas endurecimento e redução de risco:

- **RLS de tabelas existentes intocado** → **zero** mudança no PostgREST para `products`/`categories`. A tabela **nova** `product_collections` nasce tão aberta quanto as de catálogo já são hoje (`USING(true)`), sem alterar nada existente.
- **Vitrine Destaques preservada:** F2 backfilla a pertença a partir do **conteúdo atual** (`categoria_id=c8`, 1 produto) → a loja mostra **o mesmo 1 produto** de hoje. *(A opção +2 produtos é D-DEST (B), só sob aval explícito.)*
- **Nenhum `DROP COLUMN`** → nenhum leitor perde campo.
- **`getProds/getAllProds` inalterados** (já paginam) → loja mostra os mesmos produtos/preços.
- **`resolve_collection` é `STABLE`/read-only**, 4 campos, sem FK nova, não referencia `create_order` nem escreve `products`/`order_items` → **checkout, HARDEN-01..07, idempotência, reconciliação, Monte, Batidinhas, Pricing, Addons imunes**.
- **Sem particionamento** → idempotência do HARDEN-03 intocada.
- **Invariantes STI** apenas **proíbem estados que já não ocorrem** (após o backfill F2) — não alteram leitura/escrita legítima.
- **Domínios `pricing.js`/`addons.js` intocados** → `test:deps/pricing/addons` seguem verdes.
- **Ponto 8:** nada aplicado.

---

## 13. Relação com NORM-07 (refinamento do contrato)

[NORM-07](NORM-07-collection-engine.md) já define `resolve_collection` retornando a **tupla de 4 membros** `(product_id, posicao, origem, fixado)`. Esta revisão **congela** explicitamente:
- o resolver é **members-only / 4 campos** (§4) — **`ordem` é chave interna**, não retornada (idêntico ao `ORDER BY` do ramo `manual` de NORM-07 §3);
- o resolver **nunca hidrata**; a hidratação é da **camada superior** (`DS.getCollectionProducts`), **limitada por id** (G1);
- onde o corpo de NORM-07 §4 fala em "devolver a linha completa do produto", entenda-se a **companion de hidratação** (camada superior), **não** o resolver. *(Pointer no topo de NORM-07.)*

---

## 14. Dívida técnica registrada (temporária)

| Item | Estado após NORM-06 | Saldar em |
|---|---|---|
| `products.image_url` (legado, 10 linhas, 0 órfãs vs `imagem_url`) | **dormente** (não lido) | **HARDEN-LEGACY** |
| `products.destaque` (flag, já admin-only e sem efeito de vitrine hoje) | **dormente** (pertença vive em `product_collections`) | **HARDEN-LEGACY** |
| `categoria_ids` (fantasma no cliente) | lógica removida em F6 | concluído no NORM-06 |
| RLS `USING(true)` de `products`/`categories` (vaza indisponíveis ao anon) | **inalterado** | **NORM-06.1 / HARDEN-RLS** |
| `list_products` keyset (escala) | truncamento já corrigido; otimização pendente | **F3b** |

---

## 15. RLS é preocupação independente (registro explícito — ponto 1)

RLS **não faz parte** da migração de Collections. Será tratado na **NORM-06.1 / HARDEN-RLS** (redesenho `anon`=só disponíveis / `authenticated`=todos, fechando o vazamento `USING(true)`). **No NORM-06, nenhuma policy de tabela existente é criada ou alterada.** A única ação relacionada a RLS dentro do NORM-06 é a **postura inicial** da tabela **nova** `product_collections` (F1A item 2), que apenas espelha o regime público que `products`/`categories` já têm hoje — e não a hardening reservada.

> **Reforço (não permanente):** a política pública aplicada à tabela `product_collections` existe **exclusivamente** para preservar a compatibilidade com o comportamento atual da aplicação. Ela **NÃO representa a política definitiva de segurança** e será **integralmente revisada no HARDEN-RLS (NORM-06.1)**. Ninguém deve interpretar essa abertura como uma decisão permanente.

## 16. Divergências deliberadas da base congelada NORM-06A (documentadas — ponto 7)

NORM-06A é **congelado** e não é editado por este NORM. Onde o NORM-06 diverge dela, é **deliberado e registrado aqui**:
1. **RLS (NORM-06A §8 lista RLS dentro do NORM-06):** extraído por mandato do usuário → NORM-06.1 (§1.2/§15).
2. **Paginação (NORM-06A §3.1 trata como "correção"):** o truncamento **já está corrigido** em produção por `fetchAllProductsSafe`/`PRODUCTS_PAGINATE` ([App.jsx:209-264](../../src/App.jsx#L209)) → `list_products` keyset vira **otimização** (F3b), não correção. `getProds/getAllProds` não viram shims agora.
3. **`destaque` → Destaques:** NORM-06A previa migrar a semântica do flag; como a vitrine **hoje** usa `categoria_id=c8` (não o flag), o default preserva o conteúdo atual (D-DEST A); a semântica do flag (B) é decisão de produto.

---

## 17. Escopo fechado — confirmação (ponto 5)

Após a rodada de hardening + revisão adversarial, confirma-se que o NORM-06 **contém apenas**:

- ✅ **Collections** (modelo categorias de negócio × coleções; tabela `product_collections`);
- ✅ **STI** (invariante de domínio business × collection, I1–I4);
- ✅ **Collection Engine** (`resolve_collection`, ramo `manual`, contrato §4);
- ✅ **Backfill** (F2, preservando a vitrine atual);
- ✅ **Integração da UI** (F4 admin + F5 vitrines).

E confirma-se que **NÃO foram adicionados** (nem pela revisão adversarial):

| Item proibido | Estado | Onde foi parar |
|---|---|---|
| **Cache** (ex.: `collection_cache`) | ❌ não adicionado | reserva NORM-10 |
| **Novos endpoints** | ❌ nenhum | — |
| **Novos serviços** | ❌ nenhum | — |
| **Novas otimizações** | ❌ removidas da F1A | índices de paginação `products(categoria_id)`/`products(disponivel,ordem,id)` **movidos para F3b** (fora do NORM-06) |
| **Novos RPCs além do Collection Engine** | ❌ só `resolve_collection` | `list_products` (RPC de paginação) → **F3b**, fora do NORM-06 |
| **Novas tabelas fora do desenho** | ❌ só `product_collections` (aprovada) | — |
| **Mudanças de comportamento** | ❌ nenhuma | D-DEST = A preserva a vitrine |

> **Nota sobre a única permissão dentro do NORM-06:** a policy `USING(true)` em `product_collections` **não** é um item de escopo novo — é a **medida temporária de compatibilidade** da tabela nova (F1A item 2 / §15), explicitamente provisória e reservada para revisão integral no HARDEN-RLS. Não é cache, serviço, endpoint nem otimização.

Qualquer item da lista proibida que tente entrar em fases futuras deve ser tratado em **ADR próprio**, não no NORM-06.

---

> **Resumo da revisão:** escopo estreitado para **só Collections** (confirmado fechado em §17); RLS e legado extraídos; contrato do resolver fixado em **4 campos + ordem de retorno congelada + regra institucional de quebra de contrato (§4)**; invariante STI congelado; guard de slug bloqueante (com expressão compartilhada); F1A é **só estrutura** (a permissão da tabela nova é medida temporária destacada); F1 dividida em F1A/F1B/F1C; **backfill de Destaques preserva o conteúdo atual (1 produto)** — **D-DEST aprovada = A**; postura de RLS da tabela nova explicitada como provisória; divergências da base congelada documentadas. **Nenhuma mudança de comportamento.** Nada aplicado.

---

## 18. Estado após implementação prevista

Após a conclusão do NORM-06 (todas as fases F1A→F6):
- **Collections tornam-se o mecanismo oficial de vitrines** (curadoria via `product_collections`, resolvida pelo Collection Engine).
- **`categories` passa a ter papéis distintos** — `tipo='business'` (identidade do produto, `categoria_id`) × `tipo='collection'` (vitrines), separados por invariante de banco (STI, §5).
- **O Collection Engine (`resolve_collection`) torna-se a única forma oficial de resolver membros de coleções** — contrato público de 4 campos, ordem congelada (§4); a UI nunca reimplementa a regra.
- **A UI deixa de depender de categorias artificiais** — o acoplamento cosmético por nome (`includes('destaque'/'combo')`) e a lógica fantasma `categoria_ids` saem (F5/F6); as vitrines vêm de coleções reais.
- **O comportamento funcional da aplicação permanece inalterado** — mesmos produtos visíveis, mesmos preços; "Destaques" continua exibindo o mesmo 1 produto de hoje (D-DEST = A).

*(Itens explicitamente fora deste estado, reservados a fases próprias: hardening de RLS — NORM-06.1; remoção de `image_url`/`destaque` — HARDEN-LEGACY; `list_products` keyset — F3b; ramos `rule`/`smart` — NORM-10.)*

---

## 19. Próximo ADR — NORM-06.1 (HARDEN-RLS)

Continuidade documental direta deste ADR. **Objetivos previstos:**
- **revisar integralmente as políticas de acesso** (`anon` / `authenticated`) das tabelas de catálogo;
- **endurecer a segurança das tabelas novas e existentes** — `anon` = só linhas públicas/disponíveis; `authenticated` (admin) = acesso pleno; fechar o vazamento atual `USING(true)` em `products`/`categories`;
- **remover as políticas temporárias de compatibilidade** introduzidas no NORM-06 (a `pc_public_read USING(true)` de `product_collections` — F1A item 2 / §15 — é provisória e substituída aqui);
- **manter a compatibilidade funcional** (loja e admin continuam funcionando; a mudança é de postura de segurança, não de comportamento de produto).

Pré-requisito a verificar antes da NORM-06.1: o **fluxo de autenticação do admin** (para a policy `authenticated` não cegar o painel). Relacionada: **HARDEN-LEGACY** (drop de `image_url`/`destaque`).

---

## Status de Governança

**Estado:** Congelado para implementação (2026-06-27).

A partir deste ponto:
- **não** serão incorporadas novas funcionalidades ao NORM-06;
- **não** serão ampliadas as fases existentes;
- qualquer nova ideia arquitetural deverá originar um **novo ADR** ou um **HARDEN específico**;
- qualquer **mudança de comportamento** deverá ocorrer em **ADR próprio**;
- qualquer alteração do contrato do Collection Engine seguirá a **regra institucional já definida** (§4).

**Objetivo:** garantir que a implementação siga **exatamente** o desenho aprovado, evitando expansão de escopo durante o desenvolvimento.

> A partir do congelamento, este ADR é referência de implementação. As próximas interações sobre o NORM-06 são de **execução** (rito: backup → F1A → validações → commit → rollback documentado), não de arquitetura.

> **Checklist oficial de execução:** a F1A é executada **exclusivamente** segundo o runbook [F1A — Execution Plan](NORM-06-F1A-execution-plan.md) (procedimento institucional, sem pular/reordenar etapas). O runbook é operacional (anotado com evidências na execução) e **não altera** a arquitetura congelada deste ADR.
