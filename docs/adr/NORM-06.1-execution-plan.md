# NORM-06.1 · HARDEN-RLS — Execution Plan (runbook + ledger de evidências)

- **Tipo:** runbook de execução controlada. **Pertence a:** [ADR NORM-06.1 (congelado)](NORM-06.1-harden-rls.md). Equivale à fase **F1C** do NORM-06.
- **Modo:** acelerado, com revisão adversarial e governança plena (padrão F1A/F1B).
- **Resultado:** ✅ **APLICADA em 2026-06-30** e **MERGEADA na `main`** (merge `f25e7cb`, 2026-06-30, baseline oficial — ver [MERGE-F1 ledger](MERGE-F1-execution-plan.md)).

---

## 0. Pré-requisito de segurança BLOQUEANTE (saga)

| Momento | Evento | Evidência |
|---|---|---|
| 2026-06-29 | Sonda `POST /auth/v1/signup` (email +tag) **criou** usuário `authenticated` (HTTP 200) → signups **HABILITADOS** | usuário-sonda removido (`auth.users`=1) |
| 2026-06-30 | **Remediação** via Management API `PATCH /v1/projects/{ref}/config/auth {disable_signup:true}` (mantém `external_email_enabled=true`) | config antes `disable_signup=false` → depois `true` |
| 2026-06-30 | **Revalidação** `POST /auth/v1/signup` (email válido) → **`422 signup_disabled`** | "Signups not allowed for this instance" |
| 2026-06-30 | **Anonymous** `POST /auth/v1/signup {}` → **`422 anonymous_provider_disabled`** | `external_anonymous_users_enabled=false` |
| — | Banco: `auth.users`=1 (só admin), 0 anônimos, 0 SSO, só identity `email` | **`authenticated` == só admin** |

> O token de Management foi lido de `db.env` (`SUPABASE_ACCESS_TOKEN`), nunca exposto. Recomenda-se **revogar** o token após a fase.

---

## 1. Revisão adversarial (3 lentes) — achados e resolução

| Sev. | Achado | Resolução |
|---|---|---|
| 🔴 **BLOCKER** | **F1B FOR SHARE × RLS**: sob role `authenticated`, `SELECT … categories … FOR SHARE` retorna 0 linhas (sem policy lockável) → triggers STI veem categoria "(inexistente)" → **quebram escrita do admin que referencia categoria** (verificado: `UPDATE products SET categoria_id…` falha com `STI I2 (inexistente)`) | **F1B-ERRATA-01**: 4 funções STI → `SECURITY DEFINER` (FOR SHARE roda como dono, bypassa RLS). Decoupla STI da RLS; preserva TOCTOU; corrige o bug |
| 🔴 **BLOCKER** | `test:rls` AW2: UPDATE anon sem policy = 0 linhas, **não** 42501 → falso-FAIL | AW2 passou a asserir `rowCount=0` |
| 🟠 major | anonymous sign-in não verificado | verificado (acima): `422 anonymous_provider_disabled` |
| 🟠 major | CS1/CS3 INSERT: trigger dispara antes do RLS WITH CHECK → não isola "RLS permitiu" | backstop por BW1-3 (provam RLS permite escrita authenticated); documentado |
| 🟡 minor | CS1/CS4 dependiam de `c5` ter produtos | tornados **herméticos** (categoria+produto temp) |
| 🟡 minor | nomes de policy (pt × en) | padronizados p/ nome de tabela (`Auth insert categories`…) |
| 🟡 minor | ADR §3 tabela divergia do SQL (`product_collections_public_read`) | corrigido p/ `Leitura pública coleções` |
| 🟡 minor | ADR marcado "BLOQUEADO" | status sincronizado p/ desbloqueado/aplicado |
| 🟡 minor | `snapshot.mjs` não captura policies | restore point real = rollback SQL (registrado); `pg_policies` §0 capturado |
| ⚪ nit | CK1 mascarava erro não-RLS | passou a exigir sucesso real |

---

## 2. F1B-ERRATA-01 (SECURITY DEFINER) — bugfix de fase commitada

Discovery + correção de um bug **vivo** que a F1B (commit `bbc0eb9`) introduziu: o `FOR SHARE` (fix de TOCTOU) não enxerga a categoria sob RLS quando o escritor é `authenticated`. `test:f1b` não pegou porque rodou como `postgres` (bypassa RLS).

- **Arquivos:** `migrations/NORM-06-F1B-errata-01-securitydefiner.sql` (+rollback).
- **Mudança:** as 4 funções `trg_sti_*` viram `SECURITY DEFINER SET search_path = pg_catalog, public`; `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated, service_role` (privilégio mínimo).
- **Verificado pós-errata:** authenticated UPDATE/INSERT de produto com categoria business **funciona**; escrita inválida → STI com `tipo=collection` (não "(inexistente)"); TOCTOU preservado (C1 verde); trigger dispara mesmo com EXECUTE revogado.
- **Auditoria SECURITY DEFINER:** `secdef=true` · `owner=postgres` · `search_path=pg_catalog, public` · **sem SQL dinâmico** · EXECUTE `{postgres=X/postgres}` (mínimo).

---

## 3. Ledger de execução (todas SUCCESS)

| Etapa | Estado | Evidência |
|---|---|---|
| 0. Gate + backup | SUCCESS | signup+anon desabilitados (revalidados); `snapshot-NORM-06_1-RLS-2026-06-30T01-27-35-857Z.json`; `pg_policies` §0 capturado |
| 1. F1B-Errata-01 | SUCCESS | 4 funções SECURITY DEFINER + REVOKE; bug corrigido (verificado sob authenticated) |
| 2. Re-validação F1B (authenticated+anon) | SUCCESS | `test:f1b` **PASS=23** (SHA256 `bc5a5b80…`): postgres-suite + RA1-5 (bug-repro corrigido, create funciona, STI correto, anon negado, D1) |
| 3. Aplicação NORM-06.1 | SUCCESS | `NORM-06.1-step1.sql` atômico; 9 DROP/CREATE policies |
| 4. Validação de schema | SUCCESS | 4 policies em categories/adicionais/product_collections; `pc_public_read` removida → `Leitura pública coleções`; products/orders/customers inalterados |
| 5. Build | SUCCESS | `npm run build` exit 0; assets byte-idênticos à F1A/F1B (`src/` intocado) |
| 6. Testes da fase | SUCCESS | `test:rls` **PASS=15** (SHA256 `fbd967e4…`): D1, anon-no-write, authenticated-write, **não-bypass STI (CS1-4)**, checkout intacto; net-zero |
| 7. Funcional | SUCCESS | pedido tel 44 preservado; contagens == baseline; 0 violações de invariante |
| 8. Auditoria SECURITY DEFINER | SUCCESS | owner/search_path/sem-SQL-dinâmico/EXECUTE mínimo (§2) |
| 9. Commit + docs | SUCCESS | 2 commits (errata; NORM-06.1) + ADR + README + memória |

---

## 4. Estado-alvo aplicado (policies do catálogo)

| Tabela | READ | WRITE |
|---|---|---|
| `products` | `Leitura pública produtos` public USING(true) — inalterado (D1) | `authenticated` ins/upd/del — inalterado |
| `categories` | `Leitura pública categorias` public USING(true) | **+ `authenticated` ins/upd/del** |
| `adicionais` | `Leitura pública adicionais` public USING(true) | **+ `authenticated` ins/upd/del** |
| `product_collections` | `Leitura pública coleções` public USING(true) (permanente) | **+ `authenticated` ins/upd/del** |
| `orders`/`customers`/`order_items` | `Allow all` public — **inalterado (D2)** | inalterado |

---

## 5. Rollback (ordem)

Bloco F1 entrelaçado — reverter na ordem:
1. `migrations/NORM-06.1-step1-rollback.sql` (remove policies novas; restaura `pc_public_read`).
2. `migrations/NORM-06-F1B-errata-01-securitydefiner-rollback.sql` (funções STI → INVOKER). ⚠️ re-quebra escrita authenticated que referencia categoria.
3. `migrations/NORM-06-F1B-step1-rollback.sql` (remove triggers STI).
Restore point real = rollback SQL (fase é 100% policies/funções; `snapshot` só evidencia net-zero de dados).

---

## 6. Pendências

- **HARDEN-ORDERS-RLS** (próprio): `orders`/`customers`/`order_items` ainda `Allow all public` (anon lê/edita todos os pedidos) — D2.
- **Revogar** o `SUPABASE_ACCESS_TOKEN` do `db.env` após a fase.
- Merge do bloco F1 (F1A+F1B+errata+NORM-06.1) na `main` — planejado, ainda pendente.

> **🔒 RUNBOOK NORM-06.1 ENCERRADO** — STATE: SUCCESS.
