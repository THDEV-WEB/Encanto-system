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

## Tabela de Evidências (preencher na execução)

**Cabeçalho da execução:**

| Campo | Valor |
|---|---|
| Data/hora (início) | — |
| Ambiente | — |
| Banco (project ref) | — |
| Branch | — |
| Commit base | — |
| Operador | — |
| Snapshot/backup | — |
| Autorização ("GO F1A") | — (quem / quando) |

**Resultado por etapa** (Estado ∈ PENDING · RUNNING · SUCCESS · FAILED · ABORTED):

| Etapa | Estado | Horário | Evidência |
|---|---|---|---|
| 0. Execution Gate | PENDING | — | — |
| 1. Guard de slug | PENDING | — | colisões = ? |
| 2. DDL | PENDING | — | warnings = ? |
| 3. Índices | PENDING | — | — |
| 4. Constraints | PENDING | — | — |
| 5. Validação de schema | PENDING | — | — |
| 6. Build | PENDING | — | — |
| 7. Testes da fase | PENDING | — | — |
| 8. Validação funcional (tel 44) | PENDING | — | — |
| 9. Evidências | PENDING | — | — |
| 10. Commit | PENDING | — | hash = ? |
| 11. Atualização documental | PENDING | — | — |

> Em término **FAILED/ABORTED**, registrar nesta tabela o **motivo da interrupção** (Gate entre etapas) e aplicar a **Regra de rollback**.

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
