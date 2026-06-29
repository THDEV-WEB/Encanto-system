# NORM-06 · F1B — Execution Plan (runbook operacional)

- **Tipo:** runbook de execução controlada (procedimento institucional) — **não é arquitetura.**
- **Pertence a:** [ADR NORM-06 (congelado)](NORM-06-collections.md) §5 (invariantes I1–I4) + §7 F1B. Não altera arquitetura/escopo/fases.
- **Natureza:** trate a F1B como **implantação de banco em produção**. Cada etapa tem resultado esperado e condição de abort. **Nenhuma etapa é pulada; nenhuma muda de ordem.**
- **Aplica a SQL desta fase:** **exclusivamente** as triggers/funções de invariante STI desenhadas no ADR §5. F1B **não** toca schema (tabela/coluna/índice/constraint/policy) — isso foi a F1A. Rollback da F1B **não** desfaz o schema da F1A (propriedade-chave do ADR §8).
- **Modo de execução:** **acelerado** (autorização "autorizo a F1B" = GO F1B; runbook inteiro executado, parando só em condição de bloqueio). Mesma governança/evidências da F1A.

> **Regra-mãe:** se **qualquer** verificação falhar — Execution Gate ou etapa — **PARAR IMEDIATAMENTE** (FAILED/ABORTED) e aplicar a Regra de rollback. Sem improviso, sem auto-correção.

---

## 0. Execution Gate

| # | Condição | Validação | OK? |
|---|---|---|---|
| 1 | ADR NORM-06 congelado | Status 🔒 | ✅ |
| 2 | Execution Plan aprovado | este runbook (modo acelerado) | ✅ |
| 3 | Backup realizado | `snapshot.mjs NORM-06-F1B` | ✅ |
| 4 | Snapshot validado | `snapshot-NORM-06-F1B-2026-06-29T22-02-02-772Z.json` gravado | ✅ |
| 5 | Working tree limpo (no início) | `git status --short` vazio antes dos artefatos F1B | ✅ |
| 6 | Branch correta | `feature/norm-06-f1a` (bloco F1; merge único no fim do F1C) | ✅ |
| 7 | Banco correto | `hvbcdxsagkjtfjwvnslo` · db `postgres` · schema `public` | ✅ |
| 8 | Nenhuma migração paralela | — | ✅ |
| 9 | Autorização explícita ("GO F1B") | usuário: "autorizo a F1B" | ✅ |

---

## Decisão de implementação — D-I4-ADIC (ratificada)

**Questão:** o ADR §5 enumera I4 com dois exemplos (`business→collection com produtos`; `collection→business com membros`), mas o parêntese **não** cita `adicionais`. O princípio do §5 ("estados inválidos impossíveis de persistir") exige fechar o furo: uma categoria `business` **sem produtos** mas **com adicionais** (`aplica_categoria_id`) poderia virar `collection`, encalhando o adicional num collection (viola I3) **sem** trigger detectar.

**Decisão (usuário, 2026-06-29):** **incluir adicionais no I4.** A troca `business→collection` é bloqueada se houver **produtos OU adicionais** referenciando a categoria. Cumpre o princípio do §5 e o invariante I3; bloqueia **0** operações legítimas atuais/F2 (c8 não tem adicionais). Coberto pelo teste **N4b·I4**.

---

## Revisão adversarial (pré-aplicação)

Painel de 4 lentes (pg-semantics · soundness-vs-adr · test-harness · ops-rollback-scope) sobre o SQL + harness, **antes** de aplicar. Achados incorporados:

| Sev. | Achado | Resolução na F1B |
|---|---|---|
| 🟠 major | I4 furável por **TOCTOU** sob READ COMMITTED (flip de tipo vs. insert de referrer concorrente) | **Endurecido:** `SELECT … FOR SHARE` nas leituras de categoria em I1/I2/I3 serializa contra o `FOR NO KEY UPDATE` do flip. **Validado empiricamente** pelo teste **C1** (flip bloqueia, timeout 57014). |
| 🟡 minor | Triggers `CREATE` não idempotentes | Trocado para `CREATE OR REPLACE TRIGGER` (PG17.6). |
| 🟡 minor | Regex de PASS aceitava qualquer `STI Ix` | Passou a exigir a invariante **específica** derivada do id do teste. |
| 🟡 minor | Faltava negativo I1 via `UPDATE OF collection_id` | Adicionado **N1b**. |
| 🟡 minor | P4 PASS vácuo se `pidC8` nulo | Vira **SKIP** explícito. |
| ⚪ nit | I4 dependia do CHECK p/ exaustividade | Adicionado `ELSE RAISE` (defesa em profundidade). |
| ⚪ nit | DELETE/TRUNCATE/id-rename/replica-role | Documentado no cabeçalho do `.sql` (escopo do enforcement). |
| ⚪ nit | fetch de apoio sem `ORDER BY` | Determinístico (`ORDER BY id`). |
| 🔴 blocker (no harness) | **P4 colidia em `unique_nome_categoria`**: há **dois** "Encanto Mineiro" (c4 + c8); o realloc c8→c4 do ADR falha | P4 corrigido para usar realloc **sintético** (categoria business temp), isolando a invariante. **A colisão real é achado de DADOS do F2** — ver abaixo. |

---

## ⚠️ Achado de DADOS para o F2 (flag bloqueante do F2, NÃO da F1B)

A revisão expôs que o **plano de backfill F2 do ADR colide com a base real** por `unique_nome_categoria UNIQUE(nome, categoria_id)`:

| Produto duplicado | Está em | Passo F2 do ADR | Resultado |
|---|---|---|---|
| **Encanto Mineiro** | c4 (`cb7d5883…`) **e** c8 (`45e97133…`) | mover c8→**c4** | `UNIQUE(nome,c4)` já ocupado → **falha** |
| **Marmita G 2 Proteínas com Açaí 500 ml** | c1 **e** c2 | mover c2→**c1** | `UNIQUE(nome,c1)` já ocupado → **falha** |

> **Disposição:** registrado como achado bloqueante **do F2** (não da F1B). **Resolução humana obrigatória antes do F2** — escolher destino sem colisão, renomear, ou tratar como duplicata a fundir. **Proibido auto-corrigir** (mesma postura do guard de slug). A F1B (triggers) não é afetada: as triggers estão corretas e o teste P4 prova a invariante da sequência F2 com dados sintéticos.

---

## Sequência de execução (ordem imutável) — ledger de evidências

| Etapa | Estado | Horário (UTC) | Evidência |
|---|---|---|---|
| 0. Execution Gate + backup | **SUCCESS** | 2026-06-29T22:02 | 9/9 gate; snapshot `…F1B-2026-06-29T22-02-02-772Z.json` (categories 9, products 39, adicionais 35, pc 0, orders 1) |
| 1. Pré-validação (read-only) | **SUCCESS** | 2026-06-29T22:02 | **0 violações** de invariante no baseline: bad_tipo=0, collections=0, i1=0, i2=0, i3=0 → triggers não corrigem dado |
| 2. Aplicação do DDL | **SUCCESS** | 2026-06-29T22:03 | `NORM-06-F1B-step1.sql` (atômico): BEGIN · 8 CREATE (4 fn + 4 trg) · COMMIT · exit 0, sem warnings |
| 3. Validação de schema | **SUCCESS** | 2026-06-29T22:03 | 4 triggers STI + 4 funções (def correta); inventário inalterado (cat_cols=16, pc_cols=6, constraints 10, índices 6, pc_policies 1); auditoria pré-existente intacta (orders 3, order_items 2, customers 1) |
| 4. Build | **SUCCESS** | 2026-06-29T22:04 | `npm run build` exit 0; 107 módulos; assets byte-idênticos à F1A (`index-CV8UexFo.css`/`index-BkmThAW9.js`); 1 warning pré-existente (chunk>500kB); `src/` intocado |
| 5. Testes da fase | **SUCCESS** | 2026-06-29T22:04 | `test:f1b` **PASS=18 FAIL=0 SKIP=0** (SHA256 `64d564df…`): 9 negativos com assinatura STI específica + 8 positivos (incl. P4·F2) + **C1 concorrência (TOCTOU fechado)**; mutação líquida 0. Regressão: `test:deps`/`test:pricing`/`test:addons` verdes |
| 6. Validação funcional | **SUCCESS** | 2026-06-29T22:05 | Pedido tel 44 preservado (customer `6873df96`, order `05821c13`, total 43.99, 1 item); contagens == baseline; baseline de invariantes 0/0/0/0. *(status do pedido evoluiu recebido→entregue entre F1A e F1B — evolução legítima do pedido, **não** efeito da F1B: orders/order_items/customers não são tocados por nenhuma trigger STI.)* |
| 7. Evidências | **SUCCESS** | 2026-06-29T22:05 | esta tabela + ledger consolidado |
| 8. Commit | **SUCCESS** | 2026-06-29 | commit único da F1B com linha de rollback (ver git log) |
| 9. Atualização documental | **SUCCESS** | 2026-06-29 | este runbook + status do ADR + README + memória |

---

## Objetos criados pela F1B

| Invariante | Função | Trigger | Evento |
|---|---|---|---|
| I1 | `trg_sti_pc_collection_is_collection()` | `trg_sti_pc_collection` | `BEFORE INSERT OR UPDATE OF collection_id ON product_collections` |
| I2 | `trg_sti_product_categoria_is_business()` | `trg_sti_product_categoria` | `BEFORE INSERT OR UPDATE OF categoria_id ON products` |
| I3 | `trg_sti_adicional_categoria_is_business()` | `trg_sti_adicional_categoria` | `BEFORE INSERT OR UPDATE OF aplica_categoria_id ON adicionais` |
| I4 | `trg_sti_categoria_tipo_guard()` | `trg_sti_categoria_tipo` | `BEFORE UPDATE OF tipo ON categories` |

**Desenho de lock (TOCTOU):** I1/I2/I3 leem a categoria com `FOR SHARE`; o flip de tipo (I4 host) pega `FOR NO KEY UPDATE` na categoria — locks conflitantes serializam "adicionar referrer" vs "flipar tipo". Quem roda por último re-lê o estado commitado e rejeita.

**Escopo do enforcement:** INSERT/UPDATE das colunas referenciadoras + UPDATE OF tipo. DELETE/TRUNCATE não criam inconsistência (só removem); id-rename é delegado às FKs (`ON UPDATE NO ACTION`); restores sob `session_replication_role='replica'` ou triggers desabilitadas **contornam** o enforcement e exigem revalidação pós-carga.

---

## Rollback da F1B (documentado)

```
node C:\Users\00thi\.encanto\run.mjs --file migrations/NORM-06-F1B-step1-rollback.sql
```
Remove as 4 triggers + 4 funções (atômico, `DROP … IF EXISTS`). **O schema da F1A permanece 100% intacto** (propriedade-chave do ADR §8: rollback de invariante não toca o schema). Se necessário, restaurar o snapshot `…F1B-2026-06-29T22-02-02-772Z.json`. Reaplicação: o `.sql` é idempotente (`CREATE OR REPLACE`).

---

## Critério de conclusão da F1B

Execution Gate ✅ + Etapas 1–6 em **SUCCESS** + `test:f1b` verde (negativos + positivos + concorrência) + regressão verde + pedido tel 44 preservado + evidências registradas + commit único com rollback + documentação atualizada. **Atendido.**

**Pendente (fases próprias):** F1C/NORM-06.1 (HARDEN-RLS, substitui `pc_public_read`) → F2 (backfill — **resolver antes as 2 colisões de `unique_nome_categoria`**) → F3+ (DataService/Admin/UI). Branch `feature/norm-06-f1a` **não** integrada à `main` (merge planejado no fim do F1C).

> **🔒 RUNBOOK DA F1B ENCERRADO** — STATE: SUCCESS.
