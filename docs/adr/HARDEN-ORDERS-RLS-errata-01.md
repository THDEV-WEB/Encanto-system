# Errata-01 do HARDEN-ORDERS-RLS — Re-baseline do `test:rls` CK1 (checkout)

- **Tipo:** **ERRATA de teste/não-regressão.** Corrige a asserção **CK1** da suíte `test:rls` (NORM-06.1). **Não altera código de produção, schema, policies, grants, funções nem comportamento do sistema.**
- **ADR:** [HARDEN-ORDERS-RLS](HARDEN-ORDERS-RLS.md) permanece **🔒 CONGELADO** — esta errata **não o reabre**. Apenas alinha um teste de uma fase anterior (NORM-06.1) à decisão **D-GRANTS** já ratificada do HARDEN-ORDERS-RLS.
- **Descoberta:** durante o **baseline pré-merge do bloco F1** (2026-06-30), antes de integrar `feature/norm-06-f1a` na `main`, a suíte `test:rls` acusou **PASS=14 FAIL=1** — falha em **CK1**. O `test:rls` **nunca havia sido reexecutado após o commit do HARDEN-ORDERS-RLS** (`9aa9b50`), então a inconsistência ficou latente desde aquele commit.
- **Rastreabilidade:** documento próprio + commit dedicado na branch `feature/norm-06-f1a` (antes do merge na `main`).

## 1. Escopo (o que esta errata NÃO faz)

- **não altera a arquitetura;**
- **não altera o escopo;**
- **não altera decisões** (D-RPC, D-ANON-READ, D-GRANTS, D-VIEW seguem como ratificadas);
- **não altera nenhum artefato de produção** (nenhuma migration, função, policy ou grant é tocado);
- **corrige apenas a asserção do teste** `CK1` em [`scripts/norm06-1-rls-test.mjs`](../../scripts/norm06-1-rls-test.mjs), que codificava um comportamento que o HARDEN-ORDERS-RLS **deliberadamente removeu**.

## 2. Causa técnica (registrar para não reintroduzir)

Duas fases do mesmo branch se cruzam:

| Fase | Modelo de checkout | Efeito no anon × `customers` |
|---|---|---|
| **NORM-06.1** (D2) | anon escreve `customers` **direto** | CK1 exigia **sucesso** do `INSERT customers` como anon |
| **HARDEN-ORDERS-RLS** (D-GRANTS, commit `9aa9b50`) | anon escreve **só** via RPC `create_order` (SECURITY DEFINER) | grant direto **REVOGADO** → `INSERT customers` como anon retorna **`42501 permission denied for table customers`** |

> A CK1 original asseria `verdict='PASS'` quando o `INSERT customers` **sucedia** e `'FAIL'` em `42501` ("RLS BLOQUEOU o checkout"). Após o HARDEN-ORDERS-RLS isso ficou **invertido em relação à intenção**: o `42501` agora é o **resultado correto e desejado** (é o objetivo do D-GRANTS), e um `INSERT` bem-sucedido seria um **vazamento**.

⚠️ **Não "consertar" reabrindo o grant do anon em `customers`** para fazer a CK1 antiga passar — isso **reintroduz o vazamento de privacidade** que o HARDEN-ORDERS-RLS fechou. O caminho legítimo do checkout é **exclusivamente** a RPC `create_order`.

## 3. Correção (AUTORITATIVA para o `test:rls`)

A **CK1** passa a asserir a **contrapartida endurecida**:

- **PASS** ⇔ anon `INSERT customers` direto é **negado com `42501`** (permission denied / grant revogado);
- **FAIL** ⇔ o `INSERT` **suceder** (rotulado **VAZAMENTO**) ou falhar com **código ≠ 42501** (erro inesperado);
- a garantia de **"checkout preservado"** **migra** para `test:orders-rls` (**AC1** checkout end-to-end via `create_order` + **AC2** idempotência), referenciada explicitamente na descrição da CK1.

Comentário-cabeçalho da suíte (`scripts/norm06-1-rls-test.mjs`, linha de cobertura) atualizado de *"checkout (customers) intacto para anon"* para *"anon NÃO escreve customers direto (HARDEN-ORDERS-RLS D-GRANTS; checkout via create_order RPC — ver test:orders-rls AC1)"*.

## 4. Evidência

| Momento | `test:rls` | CK1 |
|---|---|---|
| Antes da errata (pré-merge) | **PASS=14 FAIL=1 · FAILED** | `[FAIL] CK1 … RLS BLOQUEOU o checkout (42501)!` |
| Após a errata | **PASS=15 FAIL=0 · SUCCESS** | `[PASS] CK1 … negado (42501): permission denied for table customers — checkout flui pela RPC create_order (test:orders-rls AC1)` |

A mensagem `permission denied for table customers` confirma que a negação vem da **revogação de grant** (D-GRANTS), não de uma policy de RLS — coerente com o estado-alvo aplicado do HARDEN-ORDERS-RLS.

## 5. Prova de NÃO-regressão do sistema (o checkout real está íntegro)

Esta errata corrige **um teste**, não o sistema. O checkout anon segue funcional pela RPC, comprovado na mesma rodada de baseline:

- **`test:orders-rls` AC1** (checkout via `create_order`) → **PASS**;
- **`test:orders-rls` AC2** (idempotência por `request_id`) → **PASS**;
- **`test:orders-rls` GR1** (`has_table_privilege('anon','customers',…) = false`) → **PASS** (anon corretamente sem grant);
- **`test:orders-rls` AUD** (`create_order` = SECURITY DEFINER, owner postgres, `search_path` fixo) → **PASS**;
- suíte `test:orders-rls` → **PASS=16 FAIL=0**.

## 6. Efeito no roadmap

- **Nenhum.** O bloco F1 e o HARDEN-ORDERS-RLS permanecem encerrados; o **F2 segue bloqueado**; as **colisões de backfill seguem apenas registradas**, sem correção automática.
- Esta errata é pré-requisito apenas do **merge** (critério de auditoria "suíte verde na `main`"): aplicada na `feature/norm-06-f1a` antes da integração.
