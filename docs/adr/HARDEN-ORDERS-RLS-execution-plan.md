# HARDEN-ORDERS-RLS — Execution Plan (runbook + ledger de evidências)

- **Pertence a:** [ADR HARDEN-ORDERS-RLS (congelado)](HARDEN-ORDERS-RLS.md). **Resultado:** ✅ **APLICADA em 2026-06-30** na branch `feature/norm-06-f1a` (não mergeada na `main`).
- **Decisões ratificadas:** D-RPC (create_order→SECURITY DEFINER), D-ANON-READ (anon sem leitura direta), D-GRANTS (revogar grants do anon), D-VIEW (v_order_reconciliation→security_invoker).
- **Objetivo:** eliminar a exposição pública dos pedidos **preservando 100% o comportamento funcional** (checkout anon + painel admin).

---

## 1. Revisão adversarial (3 lentes) — achados e resolução

| Sev. | Achado | Resolução |
|---|---|---|
| 🔴 blocker | nome de policy poderia não bater (revisor leu o texto do ADR) | **pré-flight no catálogo**: nomes vivos SÃO `Allow all operations on {orders,customers,order_items}` — migração bate exato |
| 🟠 major | `authenticated` poderia não ter grants → FOR ALL inalcançável | **pré-flight**: authenticated tem grants completos nas 6 tabelas/view ✓ |
| 🟠 major (harness) | auditoria não asseria a EXECUTE ACL | harness passou a **asserir** anon=X presente + PUBLIC removido |
| 🟠 major (harness) | sem negativos de anon UPDATE/DELETE | adicionados **AO7/AO8** (42501) |
| 🟠 major (harness) | BO1/BO2 dependiam de orders não-vazia | tornados **herméticos** (semeiam customer+order+order_item na própria tx) |
| 🟡 minor | grants de PUBLIC poderiam vazar p/ anon | **pré-flight**: `relacl` sem entrada PUBLIC ✓ (revogar do anon basta) |
| 🟡 minor | base da view poderia ter tabela sem policy auth | **pré-flight**: view referencia só `orders`+`order_items` (ambas FOR ALL) ✓ |
| 🟡 minor (harness) | regex sql-dinâmico pegava `format()` | restrita a `\mexecute\M` (vetor real) |
| 🟡 minor (harness) | BO4 check tautológico (`rowCount>=0`) | trocado por "lida sem erro" |
| ⚪ nit | camada D-GRANTS não provada isolada | +**GR1** `has_table_privilege('anon',…)=false` |
| ⚪ nit | search_path só checava presença | passou a asserir valor (`pg_catalog`) |
| ⚪ nit | `current_user`→postgres no log | documentado (perda de fidelidade forense; errata opcional) |
| ⚪ nit | premissa `relforcerowsecurity=false` | documentada no step1/ADR |

create_order→DEFINER **aprovado** pela lente dedicada (corpo qualificado, sem SQL dinâmico, sem auth.uid/SET ROLE, idempotência preservada, ordem step1→step2 segura).

---

## 2. Ledger de execução (todas SUCCESS)

| Etapa | Estado | Evidência |
|---|---|---|
| 0. Backup | SUCCESS | `snapshot-HARDEN-ORDERS-RLS-2026-06-30T12-59-32-169Z.json` |
| 0.1 Pré-flight (read-only) | SUCCESS | nomes de policy (sufixados), grants authenticated (completos), PUBLIC (ausente), view (orders+order_items), relforce=false, create_order ACL |
| 1. Step1 (create_order→DEFINER) | SUCCESS | `ALTER FUNCTION ... SECURITY DEFINER`/`SET search_path`/`REVOKE EXECUTE FROM PUBLIC`; **anon checkout verificado OK** (`{ok:true}`) antes de tocar policies |
| 2. Step2 (policies/grants/view) | SUCCESS | `Allow all` removidas → `Auth all` (authenticated); grants do anon revogados (5 tabelas + view); `v_order_reconciliation`→security_invoker |
| 3. Validação de schema | SUCCESS | allow_all_remanesce=0; auth_all=3; anon_grants_remanescentes=0; create_order secdef+search_path+anon-EXECUTE+sem-PUBLIC; view security_invoker=true |
| 4. Build | SUCCESS | `npm run build` exit 0 (assets inalterados — `src/` intocado) |
| 5. Testes da fase | SUCCESS | `test:orders-rls` **PASS=16** (SHA256 `7d349dee…`): AO1-AO8 (anon 42501) + GR1 (D-GRANTS) + AC1/AC2 (checkout+idempotência) + BO1-BO4 (admin) + AUD (SECURITY DEFINER); net-zero |
| 6. Funcional | SUCCESS | pedido tel 44 intacto; orders/customers/order_items/order_events inalterados |
| 7. Auditoria SECURITY DEFINER | SUCCESS | create_order: secdef=true, owner=postgres, search_path=pg_catalog,public, sem SQL dinâmico, EXECUTE={anon,authenticated,service_role} sem PUBLIC |
| 8. Commit + docs | SUCCESS | commit único + ADR + README + memória |

---

## 3. Estado-alvo aplicado

| Objeto | anon | authenticated (admin) |
|---|---|---|
| `orders`/`customers`/`order_items` | **sem policy + sem grant** (42501) | `Auth all` FOR ALL + grants (getPedidos/setStatus) |
| `order_events` | sem grant (42501) | `order_events_read_auth` SELECT (mantida) |
| `addresses` | sem grant; sem policy (app não usa) | sem policy (mantém) |
| `create_order` (RPC) | **EXECUTE (mantém)** — única porta de escrita; SECURITY DEFINER | EXECUTE |
| `v_order_reconciliation` | sem grant (42501) | `security_invoker=true` (lê via RLS do admin) |
| `application_logs` | INSERT (mantém) — logEvent | SELECT (mantém) |

---

## 4. Rollback (ordem)

1. `migrations/HARDEN-ORDERS-RLS-step2-rollback.sql` (restaura `Allow all` + grants do anon + view sem security_invoker) — **antes**, para o checkout anon seguir funcionando durante a reversão.
2. `migrations/HARDEN-ORDERS-RLS-step1-rollback.sql` (create_order→INVOKER). Restore point real = rollback SQL.

---

## 5. Pendências / notas

- **Acompanhamento self-service do cliente** = feature futura (ADR próprio), via RPC de escopo mínimo + prova de posse — **não** reabrir tabela (ratificado).
- **Fidelidade forense:** `application_logs.origin` passa a `postgres` nos logs de erro do create_order (era anon/authenticated) — errata opcional.
- **Premissa:** D-RPC pressupõe `relforcerowsecurity=false`; um `FORCE ROW LEVEL SECURITY` futuro exigiria policy explícita para o owner.
- **F2** segue bloqueado; **colisões de backfill** apenas registradas (sem correção automática).
- Merge do bloco F1 + HARDEN-ORDERS-RLS na `main` — pendente.

## 6. Errata-01 (pós-congelamento) — re-baseline do `test:rls` CK1

Descoberta no **baseline pré-merge do bloco F1** (2026-06-30): o `test:rls` (NORM-06.1) acusou **PASS=14 FAIL=1** porque a CK1 ainda exigia que o anon escrevesse `customers` **direto** — comportamento que o **D-GRANTS** desta fase revogou (`9aa9b50`). O `test:rls` nunca fora reexecutado após o HARDEN. A [Errata-01](HARDEN-ORDERS-RLS-errata-01.md) inverte a CK1 (PASS ⇔ `42501`; checkout migra para `test:orders-rls` AC1), restaurando `test:rls` **PASS=15 FAIL=0**. **Não toca produção** — só o teste. Provas de não-regressão do checkout: `test:orders-rls` AC1/AC2/GR1/AUD (PASS=16). Aplicada na `feature/norm-06-f1a` antes do merge.

> **🔒 RUNBOOK HARDEN-ORDERS-RLS ENCERRADO** — STATE: SUCCESS · Errata-01 aplicada (test:rls re-baselinado).
