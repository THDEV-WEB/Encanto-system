# NORM-06 · F1A — Execution Plan (runbook operacional)

- **Tipo:** runbook de execução controlada (procedimento institucional) — **não é arquitetura.**
- **Pertence a:** [ADR NORM-06 (congelado)](NORM-06-collections.md) §7 F1A. Este documento **não altera** arquitetura, escopo, SQL, código nem fases — apenas formaliza **como** a F1A é executada.
- **Natureza:** trate a F1A como uma **implantação de banco em produção**. Cada etapa tem resultado esperado e condição de abort. **Nenhuma etapa é pulada; nenhuma muda de ordem.**
- **Aplica a SQL desta fase:** **exclusivamente** o DDL/guard já desenhados no ADR (§6 guard de slug, §7 F1A "1) Estrutura (DDL)" + "2) medida temporária de compatibilidade"). Este runbook **não introduz SQL novo**.

> **Regra-mãe:** se **qualquer** verificação falhar — em pré-condição ou em etapa — **PARAR IMEDIATAMENTE**. Nunca "seguir para testar depois". Sem improviso, sem auto-correção.

---

## 0. Pré-condições (gate de entrada — ABORTAR se qualquer item falhar)

Antes de **qualquer** SQL ser executado:

| # | Pré-condição | Como validar | OK? |
|---|---|---|---|
| 0.1 | **Working tree limpo** | `git status --short` retorna vazio | ☐ |
| 0.2 | **Branch correta** | `git rev-parse --abbrev-ref HEAD` = branch acordada para a F1A | ☐ |
| 0.3 | **Banco correto (ambiente esperado)** | confirmar project ref `hvbcdxsagkjtfjwvnslo` no `db.env` (credenciais **nunca** no chat) | ☐ |
| 0.4 | **Backup realizado** | dump/backup do ambiente antes do DDL | ☐ |
| 0.5 | **Snapshot salvo** | `snapshot.mjs NORM-06-F1A` gravado e localizável | ☐ |
| 0.6 | **ADR congelado** (sem mudança de escopo) | NORM-06 com Status = 🔒 Congelado; nenhum diff de escopo pendente | ☐ |
| 0.7 | **Nenhuma migração pendente não relacionada ao NORM-06** | não há DDL/migração de outra frente aguardando aplicação no mesmo ambiente | ☐ |

**Se qualquer item falhar → ABORTAR EXECUÇÃO.** Não prosseguir para a Etapa 1.

---

## Sequência de execução (ordem imutável — 11 etapas)

### Etapa 1 — Guard de Slug
- **Ação:** executar **primeiro** a verificação de colisões (ADR §6), com a **mesma expressão** do backfill.
- **Resultado esperado:** **0 colisões** (relatório vazio).
- **Se houver QUALQUER colisão:**
  - **NÃO** corrigir automaticamente;
  - **NÃO** gerar slug alternativo / sufixo / número;
  - **NÃO** continuar.
  - → **ABORTAR MIGRAÇÃO.** Resolução é **humana**; depois reinicia-se do gate de pré-condições.

### Etapa 2 — Aplicação do DDL
- **Ação:** aplicar **exclusivamente** o DDL previsto na F1A (ADR §7 F1A "1) Estrutura"): colunas novas em `categories`, backfill de `slug`, `CREATE TABLE product_collections`. *(A "2) medida temporária de compatibilidade" — `ENABLE RLS` + `pc_public_read` — é parte da F1A e entra aqui, destacada como provisória.)*
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

**Resultado por etapa:**

| Etapa | Início | Fim | Duração | Resultado | Observações |
|---|---|---|---|---|---|
| 0. Pré-condições | — | — | — | ☐ | — |
| 1. Guard de slug | — | — | — | ☐ | colisões = ? |
| 2. DDL | — | — | — | ☐ | warnings = ? |
| 3. Índices | — | — | — | ☐ | — |
| 4. Constraints | — | — | — | ☐ | — |
| 5. Validação de schema | — | — | — | ☐ | — |
| 6. Build | — | — | — | ☐ | — |
| 7. Testes da fase | — | — | — | ☐ | — |
| 8. Validação funcional (tel 44) | — | — | — | ☐ | — |
| 9. Evidências | — | — | — | ☐ | — |
| 10. Commit | — | — | — | ☐ | hash = ? |
| 11. Atualização documental | — | — | — | ☐ | — |

---

## Regras do Execution Plan (procedimento institucional)

1. **Nenhuma etapa pode ser pulada.**
2. **Nenhuma etapa pode mudar de ordem.**
3. **Se uma etapa falhar, interromper imediatamente.**
4. **Nunca continuar "para testar depois".**
5. **Toda implementação futura da F1A deve seguir exatamente este roteiro** (é o checklist oficial da fase).
6. Em qualquer abort, o estado volta ao snapshot/backup (Etapa 0.4/0.5) e a execução recomeça do **gate de pré-condições**.

---

## Critério de conclusão da F1A

A F1A só é considerada **concluída** quando: pré-condições ✅ + Etapas 1–8 ✅ + evidências registradas + commit único com rollback documentado + working tree limpo + documentação atualizada. Qualquer pendência mantém a F1A **não concluída**.

---

## Escopo (o que este runbook NÃO faz)

Não altera arquitetura · não altera o escopo do NORM-06 · não altera/adiciona SQL além do já desenhado na F1A · não altera código · não altera fases · não adiciona funcionalidades. É **exclusivamente** o endurecimento do **processo de execução** da F1A.
