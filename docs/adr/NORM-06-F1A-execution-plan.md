# NORM-06 · F1A — Execution Plan (runbook operacional)

- **Tipo:** runbook de execução controlada (procedimento institucional) — **não é arquitetura.**
- **Pertence a:** [ADR NORM-06 (congelado)](NORM-06-collections.md) §7 F1A. Este documento **não altera** arquitetura, escopo, SQL, código nem fases — apenas formaliza **como** a F1A é executada.
- **Natureza:** trate a F1A como uma **implantação de banco em produção**. Cada etapa tem resultado esperado e condição de abort. **Nenhuma etapa é pulada; nenhuma muda de ordem.**
- **Aplica a SQL desta fase:** **exclusivamente** o DDL/guard já desenhados no ADR (§6 guard de slug, §7 F1A "1) Estrutura (DDL)" + "2) medida temporária de compatibilidade"). Este runbook **não introduz SQL novo** — **exceção:** a **expressão de slug** segue a forma **corrigida** da [Errata-01](NORM-06-F1A-errata-01-slug.md) (bugfix de implementação; o ADR permanece congelado).

> **Regra-mãe:** se **qualquer** verificação falhar — no Execution Gate ou em qualquer etapa — **PARAR IMEDIATAMENTE** (estado FAILED/ABORTED). Nunca "seguir para testar depois". Sem improviso, sem auto-correção.

---

## 0. Execution Gate (gate de execução)

A implementação da F1A **somente pode começar quando TODOS os itens abaixo estiverem simultaneamente verdadeiros**:

| # | Condição do gate | Como validar | OK? |
|---|---|---|---|
| 1 | **ADR NORM-06 congelado** | NORM-06 com Status = 🔒 Congelado; nenhum diff de escopo pendente | ☐ |
| 2 | **Execution Plan aprovado** | este runbook revisado e aprovado pelo usuário | ☐ |
| 3 | **Backup realizado** | dump/backup do ambiente antes do DDL | ☐ |
| 4 | **Snapshot validado** | `snapshot.mjs NORM-06-F1A` gravado, localizável e verificado | ☐ |
| 5 | **Working tree limpo** | `git status --short` retorna vazio (modificados) | ☐ |
| 6 | **Branch correta** | `git rev-parse --abbrev-ref HEAD` = branch acordada para a F1A | ☐ |
| 7 | **Banco correto** | project ref `hvbcdxsagkjtfjwvnslo` no `db.env` (credenciais **nunca** no chat) | ☐ |
| 8 | **Nenhuma migração paralela em andamento** | nenhuma DDL/migração de outra frente sendo aplicada no mesmo ambiente | ☐ |
| 9 | **Nenhuma alteração local não versionada** | `git status --short` sem arquivos não rastreados (`??`) | ☐ |
| 10 | **Autorização explícita do usuário ("GO F1A")** | o usuário disse, de forma inequívoca, "GO F1A" | ☐ |

**Se qualquer condição NÃO estiver satisfeita → A IMPLEMENTAÇÃO NÃO INICIA.**

### Regra institucional — a autorização nunca é presumida

> **A autorização para implementar a F1A nunca pode ser presumida.**

- ADR aprovado **≠** autorização;
- Execution Plan pronto **≠** autorização;
- Backup realizado **≠** autorização;
- Banco preparado **≠** autorização.

A execução **só começa após uma autorização explícita do usuário ("GO F1A")**. Nenhum dos itens 1–9 do gate, isolada ou conjuntamente, dispensa o item 10.

---

## Estados oficiais da execução

Cada etapa só pode terminar em **um** destes estados — **nenhum estado intermediário diferente é permitido**:

| Estado | Significado |
|---|---|
| **PENDING** | ainda não iniciada |
| **RUNNING** | em execução |
| **SUCCESS** | concluída com o resultado esperado |
| **FAILED** | terminou com erro/divergência |
| **ABORTED** | interrompida por decisão de gate (Execution Gate, colisão de slug ou falha de etapa anterior) |

---

## Gate entre etapas

Antes de avançar para a etapa seguinte, é **obrigatório** confirmar que a etapa anterior terminou em **✅ SUCCESS**.

Caso a etapa anterior **não** esteja em SUCCESS (isto é, FAILED ou ABORTED):
- **interromper imediatamente**;
- **não continuar** a execução;
- **não tentar corrigir** durante a mesma execução;
- **registrar o motivo** da interrupção (na Tabela de Evidências).

---

## Regra de rollback

Caso **qualquer** etapa termine em **FAILED** ou **ABORTED**:
- o rollback deve seguir **exclusivamente** o procedimento **previamente documentado** (rollback da F1A = [ADR §8](NORM-06-collections.md): `DROP TABLE product_collections` + `ALTER TABLE categories DROP CONSTRAINT/COLUMN …` + `DROP INDEX …` + restore do snapshot da Etapa 0);
- **nunca** criar um rollback improvisado durante a execução.

---

## Sequência de execução (ordem imutável — 11 etapas)

> Cada etapa começa em PENDING → RUNNING e deve terminar em **SUCCESS** para liberar o **Gate entre etapas**. Qualquer término em **FAILED/ABORTED** dispara a **Regra de rollback** e encerra a execução.

### Etapa 1 — Guard de Slug `[READ-ONLY]`
- **Ação:** executar `npm run guard:slug` ([`scripts/norm06-f1a-slug-guard.mjs`](../../scripts/norm06-f1a-slug-guard.mjs)). Usa a **expressão CORRIGIDA da [Errata-01](NORM-06-F1A-errata-01-slug.md)** (não a do ADR §6/§7, cujo bug está documentado na errata) — a **mesma** que o backfill da Etapa 2 usará.
- **Declaração de read-only (impressa no relatório):** *esta etapa executa apenas consultas — nenhum INSERT / UPDATE / DELETE / ALTER TABLE / migração / escrita no banco.*
- **Relatório reproduzível + autoauditável obrigatório (nesta ordem):**
  1. declaração read-only · expressão SQL usada · fingerprint do banco (Project ID · Database · Schema · Timestamp UTC · nº de categorias) · contagens (categorias, slugs, `Slug collisions: N`) · lista completa `| Categoria | Slug |` · saída efetiva dos casos conhecidos · bloco de critério de aceite;
  2. **Execution Fingerprint:** Commit SHA · Branch · Node Version · Plataforma · Arquitetura · Project ID · Database · Schema · Timestamp UTC · Script (`guard:slug`) · Working tree (clean/dirty);
  3. **Duration:** Started · Finished · Duration (ms) — rastreabilidade, não benchmark;
  4. **Database immutability:** `Database writes detected: 0` · `DDL executed: 0` · `Migration executed: 0` · `Status: READ ONLY CONFIRMED`;
  5. **Execution Report SHA256:** hash do corpo do relatório (tamper-evidence);
  6. **Encerramento formal:** bloco `ETAPA 1 / STATE: SUCCESS|FAILED / NEXT STEP / NO DATABASE WRITES DETECTED`.
- **Critério de aceite — SUCCESS exige TODOS simultaneamente:**
  1. **0 colisões**;
  2. **casos conhecidos aprovados** (Cardápio de Marmitas→`cardapio-de-marmitas` · Destaques→`destaques` · Monte seu Copo→`monte-seu-copo` · Promoção do Dia→`promocao-do-dia`);
  3. **nenhum slug vazio**;
  4. **nenhum slug iniciando com hífen**;
  5. **nenhum slug terminando com hífen**;
  6. **nenhum caractere inválido** (somente `[a-z0-9-]`);
  7. **relatório completo gerado**;
  8. **banco confirmado** (fingerprint);
  9. **execução read-only confirmada**.
- **Se QUALQUER item falhar:** estado = **FAILED** → **interromper imediatamente**; **não** corrigir durante a mesma execução; **não** gerar slug alternativo/sufixo/número; **não** continuar. (Colisão/divergência → também **ABORTED**; resolução humana; reinicia do **Execution Gate §0**.)
- **🚦 Gate após SUCCESS (não automático):** mesmo com tudo verde, **PARAR**. Apresentar o relatório completo + evidências + estado oficial + confirmação de que **nenhuma escrita ocorreu**. **Aguardar autorização explícita** para a Etapa 2 (DDL). **Nunca** iniciar a Etapa 2 automaticamente.

### Etapa 2 — Aplicação do DDL
- **Ação:** aplicar **exclusivamente** o DDL previsto na F1A (ADR §7 F1A "1) Estrutura"): colunas novas em `categories`, backfill de `slug`, `CREATE TABLE product_collections`. **O `UPDATE categories SET slug = …` usa byte-a-byte a expressão corrigida da [Errata-01](NORM-06-F1A-errata-01-slug.md)** (mesma do guard da Etapa 1). *(A "2) medida temporária de compatibilidade" — `ENABLE RLS` + `pc_public_read` — é parte da F1A e entra aqui, destacada como provisória.)*
- **Resultado esperado:** tabela criada; colunas corretas; **sem warnings**; **nenhuma alteração fora do escopo**.
- **Abort:** qualquer erro/warning inesperado ou objeto fora do desenho → parar.

### Etapa 3 — Índices
- **Ação:** criar **todos** os índices previstos na F1A (do Collection Engine): `pc(collection_id, fixado DESC, ordem)`, `pc(product_id)`. *(Índices de paginação de `products` NÃO entram — são F3b, fora do NORM-06.)*
- **Resultado esperado:** todos **válidos**; **nenhum índice inválido**; **nenhum índice duplicado**.
- **Abort:** índice inválido/duplicado → parar.

### Etapa 4 — Constraints
- **Ação:** aplicar todas as constraints previstas: `CHECK` (STI estrutural: `tipo`, `estrategia`, isolamento só-coleção), `UNIQUE` (`categories_slug_uk`, `product_collections_uk`), `FK` (`product_id→products`, `collection_id→categories`), demais previstas.
- **Resultado esperado:** **100% válidas** (sem `NOT VALID` pendente, sem violação ao validar).
- **Abort:** qualquer constraint falha/violada → parar.

### Etapa 5 — Validação do Schema
- **Ação:** executar a verificação completa de estrutura (introspecção do schema).
- **Confirmar:**
  - estrutura **corresponde exatamente** ao ADR §7 F1A;
  - **nenhuma coluna inesperada**;
  - **nenhum objeto ausente** (tabela, índice, constraint).
- **Resultado esperado:** **100%** de correspondência.
- **Abort:** qualquer divergência → parar.

### Etapa 6 — Build
- **Ação:** `npm run build` (completo).
- **Resultado esperado:** **build verde**.
- **Abort:** build vermelho → parar.

### Etapa 7 — Testes da fase
- **Ação:** executar **todos** os testes previstos para a F1A — a validação estrutural da fase (introspecção; CHECKs rejeitam linha inválida) **e** a regressão dos guards existentes que não podem quebrar: `npm run test:deps`, `test:pricing`, `test:addons`.
- **Resultado esperado:** **100% verdes**.
- **Abort:** qualquer teste vermelho → parar.

### Etapa 8 — Validação funcional
- **Ação:** validar o **pedido real (telefone `44`)** — fluxo de checkout/persistência intacto.
- **Resultado esperado:** **comportamento idêntico ao anterior; nenhuma regressão**.
- **Abort:** qualquer divergência de comportamento → parar.

### Etapa 9 — Evidências
- **Ação:** registrar a execução na **Tabela de Evidências** (abaixo): horário, ambiente, banco, duração e resultado de **cada** etapa + observações.
- **Resultado esperado:** tabela preenchida e anexada (no commit ou no PR).

### Etapa 10 — Commit
- **Pré-requisito:** **somente se TODAS as etapas anteriores estiverem verdes.**
- **Ação:** **commit único** da F1A, com **linha de rollback documentada** no corpo (rollback da F1A = ADR §8: `DROP TABLE product_collections` + `ALTER TABLE categories DROP …` + `DROP INDEX …` + restore do snapshot).
- **Resultado esperado:** commit criado; **working tree limpo** após o commit.

### Etapa 11 — Atualização documental
- **Pré-requisito:** **somente após sucesso total** (Etapas 1–10 verdes).
- **Ação:** atualizar: o **ADR** (status da F1A → aplicada, com hash); o **README dos ADRs**; a **memória do projeto**.
- **Resultado esperado:** documentação refletindo o estado pós-F1A; working tree limpo.

---

## Tabela de Evidências (registro oficial da execução)

**Cabeçalho da execução:**

| Campo | Valor |
|---|---|
| Data/hora (início) | 2026-06-28T15:47Z (Etapa 0 / backup) |
| Ambiente | Produção (Supabase) |
| Banco (project ref) | `hvbcdxsagkjtfjwvnslo` · database `postgres` · schema `public` |
| Branch | `feature/norm-06-f1a` |
| Commit base | `ce16ff6` (estado de código no momento da aplicação) |
| Operador | Claude Code (execução assistida, sob autorização explícita do usuário) |
| Snapshot/backup | `snapshot-NORM-06-F1A-2026-06-28T15-47-11-130Z.json` |
| Autorização ("GO F1A") | usuário — "pode executar" (Etapa 1) · "Aprovo a passagem para a Etapa 2" (Etapa 2) |

**Resultado por etapa** (Estado ∈ PENDING · RUNNING · SUCCESS · FAILED · ABORTED):

| Etapa | Estado | Horário (UTC) | Evidência |
|---|---|---|---|
| 0. Execution Gate | **SUCCESS** | 2026-06-28T15:47 | 10/10 itens verdes; backup gravado |
| 1. Guard de slug | **SUCCESS** | 2026-06-28T16:09:10 | 9 cat · 0 colisões · 9 critérios OK · read-only · 1739 ms · SHA-256 `3d579031…` (relatório integral abaixo) |
| 2. DDL | **SUCCESS** | 2026-06-28T16:25:49–51 | 5 instruções · `categories` +9 cols · `product_collections` criada (6 cols) · RLS+policy provisória · slug 9/9 · 1802 ms · exit 0 · sem warnings (evidência abaixo) |
| 3. Índices | **SUCCESS** | 2026-06-28T16:35:48–49 | 2 índices criados (pc_collection_idx, pc_product_idx) válidos+ready; 1678 ms; exit 0; nada além de índices alterado (evidência abaixo) |
| 4. Constraints | **SUCCESS** | 2026-06-28T16:51:46–48 | pré-val 9/9 = 0 violações; 8 constraints + slug NOT NULL (todas convalidated); 2078 ms; exit 0; sem dado corrigido (evidência abaixo) |
| 5. Validação de schema | PENDING | — | — |
| 6. Build | PENDING | — | — |
| 7. Testes da fase | PENDING | — | — |
| 8. Validação funcional (tel 44) | PENDING | — | — |
| 9. Evidências | PENDING | — | — |
| 10. Commit | PENDING | — | hash = ? |
| 11. Atualização documental | PENDING | — | — |

> Em término **FAILED/ABORTED**, registrar nesta tabela o **motivo da interrupção** (Gate entre etapas) e aplicar a **Regra de rollback**.

### Evidência integral — Etapa 1 (Guard de Slug) — STATE: SUCCESS

```text
==================================================================
 GUARD DE SLUG — F1A / NORM-06 — RELATORIO
==================================================================
Esta etapa executa apenas consultas.
  Nenhum INSERT / UPDATE / DELETE / ALTER TABLE / migracao / escrita no banco

— Fingerprint do banco —
  Project ID  : hvbcdxsagkjtfjwvnslo
  Database    : postgres
  Schema      : public (current_schema=public)
  Timestamp   : 2026-06-28T16:09:10Z (UTC, relogio do servidor)
  Categorias analisadas: 9

— Expressao SQL utilizada (Errata-01, corrigida) —
  trim(both '-' from regexp_replace(lower(unaccent(nome)), '[^a-z0-9]+', '-', 'g'))

— Contagens —
  Categorias analisadas : 9
  Slugs gerados         : 9
  Colisoes encontradas  : 0
  Slug collisions: 0

— Lista completa —
  | Categoria                | Slug                  |
  |--------------------------|-----------------------|
  | Cardápio de Marmitas     | cardapio-de-marmitas  |
  | Destaques                | destaques             |
  | Copos Prontos            | copos-prontos         |
  | Monte seu Copo           | monte-seu-copo        |
  | Batidinhas               | batidinhas            |
  | Combos                   | combos                |
  | Pedido Fitness           | pedido-fitness        |
  | Bebidas                  | bebidas               |
  | Promoção do Dia          | promocao-do-dia       |

— Casos conhecidos (saida efetiva) —
  Cardápio de Marmitas
  -> cardapio-de-marmitas
  Destaques
  -> destaques
  Monte seu Copo
  -> monte-seu-copo
  Promoção do Dia
  -> promocao-do-dia

— Criterio de aceite —
  [OK] 0 colisoes
  [OK] nenhum slug vazio
  [OK] nenhum slug inicia com hifen
  [OK] nenhum slug termina com hifen
  [OK] nenhum caractere invalido (somente [a-z0-9-])
  [OK] relatorio completo gerado
  [OK] banco confirmado (fingerprint acima)
  [OK] execucao read-only confirmada

— Execution Fingerprint —
  Commit SHA   : ce16ff65272fcbb88835fe807bedfdc80176e561
  Branch       : feature/norm-06-f1a
  Node Version : v24.17.0
  Plataforma   : win32
  Arquitetura  : x64
  Project ID   : hvbcdxsagkjtfjwvnslo
  Database     : postgres
  Schema       : public
  Timestamp UTC: 2026-06-28T16:09:10Z
  Script       : guard:slug
  Working tree : clean

— Duration —
  Started : 2026-06-28T16:09:09Z
  Finished: 2026-06-28T16:09:10Z
  Duration: 1739 ms

— Database immutability —
  Database writes detected: 0
  DDL executed: 0
  Migration executed: 0
  Status: READ ONLY CONFIRMED

— Execution Report SHA256 —
  3d57903148ed48c8c031f4325334edac4dabbfbbf9658044ae97e86298541cfa

ETAPA 1 — STATE: SUCCESS — NO DATABASE WRITES DETECTED
```

### Evidência — Etapa 2 (DDL) — STATE: SUCCESS

Arquivo aplicado: `migrations/NORM-06-F1A-step2.sql` (atômico, `BEGIN/COMMIT`) · rollback: `migrations/NORM-06-F1A-step2-rollback.sql`.

```text
DDL executado (mensagens do banco):
  BEGIN / ALTER / UPDATE (9 rows) / CREATE / ALTER / CREATE / COMMIT / DONE
  exit code: 0 — sem warnings — sem erros
Started:  2026-06-28T16:25:49Z   Finished: 2026-06-28T16:25:51Z   Duration: 1802 ms

Validação do schema:
  categories            : 16 colunas (7 originais + 9 novas: slug, descricao, imagem,
                          banner, tipo[NOT NULL DEFAULT 'business'], estrategia,
                          definicao[jsonb], starts_at, ends_at)
  product_collections   : criada — 6 colunas (id uuid PK, product_id uuid NOT NULL,
                          collection_id text NOT NULL, ordem int NOT NULL DEFAULT 0,
                          fixado bool NOT NULL DEFAULT false, created_at timestamptz DEFAULT now())
  RLS product_collections: enabled=true · 1 policy: pc_public_read / SELECT / {public} / true (provisória)
  slug (backfill)       : 9/9 corretos (expressão Errata-01); 0 slugs nulos; tipo='business' em 9/9
  fora de escopo (próximas): slug NOT NULL + UNIQUE + CHECK STI + UNIQUE/FK product_collections -> Etapa 4; índices pc -> Etapa 3
  order tables          : não tocadas (pedido real preservado)
```

### Evidência — Etapa 3 (Índices) — STATE: SUCCESS

Arquivo aplicado: `migrations/NORM-06-F1A-step3.sql` (atômico) · rollback: `migrations/NORM-06-F1A-step3-rollback.sql`.

```text
SQL executado (mensagens do banco):
  BEGIN / CREATE / CREATE / COMMIT / DONE
  exit code: 0 — sem warnings — sem erros
Started: 2026-06-28T16:35:48Z   Finished: 2026-06-28T16:35:49Z   Duration: 1678 ms

Indices criados (pg_get_indexdef + validade):
  pc_collection_idx : CREATE INDEX pc_collection_idx ON public.product_collections USING btree (collection_id, fixado DESC, ordem)
                      indisvalid=true · indisready=true · unique=false
  pc_product_idx    : CREATE INDEX pc_product_idx    ON public.product_collections USING btree (product_id)
                      indisvalid=true · indisready=true · unique=false
  (pre-existente)   : product_collections_pkey UNIQUE btree (id)

Catalogo: product_collections tem 3 indices (pkey + os 2 novos) — nenhum indice adicional.
Inalterado nesta etapa: categories 16 cols · product_collections 6 cols · 1 policy (pc_public_read)
  · 0 triggers · constraints = product_collections_pkey (sem CHECK/UNIQUE/FK novos) · products: indices inalterados (2).
Fingerprint: project hvbcdxsagkjtfjwvnslo · db postgres · schema public · UTC 2026-06-28T16:36:27Z
  · commit ef8508d · branch feature/norm-06-f1a · node v24.17.0 · win32 x64.
```

### Evidência — Etapa 4 (Constraints) — STATE: SUCCESS

Arquivo aplicado: `migrations/NORM-06-F1A-step4.sql` (atômico) · rollback: `migrations/NORM-06-F1A-step4-rollback.sql`.

```text
Pre-validacoes (read-only, ANTES de aplicar): 9/9 verificacoes = 0 violacoes
  (slug null, slug dup, tipo, estrategia, sti_coll, sti_biz, pc dup, fk product, fk collection)

SQL executado (mensagens do banco):
  BEGIN / ALTER x9 / COMMIT / DONE
  exit code: 0 — sem warnings — sem erros
Started: 2026-06-28T16:51:46Z   Finished: 2026-06-28T16:51:48Z   Duration: 2078 ms

Constraints aplicadas (todas convalidated=true):
  categories.slug                   -> NOT NULL (column-level)
  categories_slug_uk    UNIQUE      -> UNIQUE (slug)
  categories_tipo_chk   CHECK       -> CHECK (tipo = ANY (ARRAY['business','collection']))
  categories_estrategia_chk CHECK   -> CHECK (estrategia = ANY (ARRAY['manual','rule','smart']))
  categories_sti_coll_chk CHECK     -> CHECK (tipo='collection' OR (estrategia IS NULL AND definicao IS NULL AND starts_at IS NULL AND ends_at IS NULL))
  categories_sti_biz_chk CHECK      -> CHECK (tipo='business' OR estrategia IS NOT NULL)
  product_collections_uk UNIQUE     -> UNIQUE (product_id, collection_id)
  product_collections_product_fk FK -> FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  product_collections_collection_fk FK -> FOREIGN KEY (collection_id) REFERENCES categories(id) ON DELETE CASCADE

Catalogo: 8 constraints novas (5 categories + 3 product_collections) + slug NOT NULL; NENHUMA adicional.
Dados: todos os registros satisfazem (convalidated=true, sem NOT VALID); pre-validacao 0 violacoes;
  NENHUM dado corrigido (migracao so tem ALTER, zero DML).
Inalterado nesta etapa: categories 16 cols / pc 6 cols (nenhuma coluna add/remove/retipo; unica mudanca de
  coluna = slug -> NOT NULL, que e a propria constraint de nulidade); 2 policies (pre-existente categories +
  pc_public_read) inalteradas; 0 triggers. Indices: +2 IMPLICITOS das UNIQUE (categories_slug_uk,
  product_collections_uk) — sao o proprio mecanismo das constraints; nenhum indice standalone criado/alterado.
Fingerprint: project hvbcdxsagkjtfjwvnslo · db postgres · schema public · UTC 2026-06-28T16:52:41Z
  · commit 73a07b2 · branch feature/norm-06-f1a · node v24.17.0 · win32 x64.
```

---

## Regras do Execution Plan (procedimento institucional)

1. **Nenhuma etapa pode ser pulada.**
2. **Nenhuma etapa pode mudar de ordem.**
3. **Se uma etapa falhar, interromper imediatamente.**
4. **Nunca continuar "para testar depois".**
5. **Toda implementação futura da F1A deve seguir exatamente este roteiro** (é o checklist oficial da fase).
6. Em qualquer abort, o estado volta ao snapshot/backup (Execution Gate itens 3/4) e a execução recomeça do **Execution Gate (§0)**.
7. **A autorização nunca é presumida** — a execução só inicia com "GO F1A" explícito (Execution Gate item 10 / Regra institucional §0).
8. **Avanço entre etapas exige SUCCESS** da etapa anterior (Gate entre etapas); FAILED/ABORTED dispara a **Regra de rollback** (procedimento documentado, nunca improvisado).
9. **Estados oficiais apenas:** PENDING · RUNNING · SUCCESS · FAILED · ABORTED.

---

## Critério de conclusão da F1A

A F1A só é considerada **concluída** quando: **Execution Gate ✅ (incluindo "GO F1A")** + Etapas 1–8 em **SUCCESS** + evidências registradas + commit único com rollback documentado + working tree limpo + documentação atualizada. Qualquer etapa fora de SUCCESS mantém a F1A **não concluída**.

---

## Escopo (o que este runbook NÃO faz)

Não altera arquitetura · não altera o escopo do NORM-06 · não altera/adiciona SQL além do já desenhado na F1A · não altera código · não altera fases · não adiciona funcionalidades. É **exclusivamente** o endurecimento do **processo de execução** da F1A.
