# MERGE-F1 — Integração do bloco F1 + HARDEN-ORDERS-RLS na `main` (ledger)

- **Operação:** merge de `feature/norm-06-f1a` → `main`, estabelecendo a **nova baseline oficial** do projeto.
- **Data:** 2026-06-30. **Resultado:** ✅ **SUCCESS** — merge `f25e7cb`.
- **Autoridade:** ADR = autoridade máxima (estratégia escolhida para preservar rastreabilidade integral).

---

## 1. O que foi integrado (19 commits)

**Bloco F1 estrutural (encerrado):**
- **F1A** — estrutura: colunas STI em `categories`, tabela `product_collections`, índices, constraints (UNIQUE/CHECK/FK), `slug` (Errata-01).
- **F1B** — invariantes STI I1–I4: 4 triggers `BEFORE` (`trg_sti_*`) com `FOR SHARE` anti-TOCTOU + D-I4-ADIC.
- **F1B-Errata-01** — funções STI `SECURITY DEFINER` (corrige escrita `authenticated` sob RLS; decoupla STI da RLS; EXECUTE mínimo).
- **F1C = NORM-06.1 / HARDEN-RLS** — escrita `authenticated` no catálogo + leitura pública preservada (substitui `pc_public_read`).

**Hardening complementar (domínio de pedidos):**
- **HARDEN-ORDERS-RLS** — `create_order`→SECURITY DEFINER; anon sem leitura direta de `orders`/`customers`/`order_items`/`v_order_reconciliation`; view→`security_invoker`.
- **HARDEN-ORDERS-RLS-Errata-01** — re-baseline do `test:rls` CK1 (anon `INSERT customers` direto agora negado pelo D-GRANTS; checkout migra para `test:orders-rls` AC1).

**Fora deste merge (por decisão):** F2 (backfill) e seguintes — **F2 bloqueado** pelas 2 colisões de `unique_nome_categoria` (apenas registradas, sem correção automática).

---

## 2. Estratégia: `--no-ff` (justificativa)

`main` era **ancestral estrito** de `feature/norm-06-f1a` (`git merge-base --is-ancestor` exit 0) e **não havia divergido** (0 commits exclusivos) → merge **garantidamente sem conflitos**.

Escolheu-se **`--no-ff`** (e **não** fast-forward nem squash) para:
- **preservar o histórico granular** dos 19 commits (cada migration/ADR/runbook/harness/rollback rastreável individualmente);
- **marcar explicitamente o ponto de integração** (commit de merge com 2 pais) como baseline;
- **rollback trivial** (reset ao pai ou `git revert -m 1`).

Squash foi descartado (destruiria a rastreabilidade); FF puro foi descartado (perderia o marcador de integração).

---

## 3. Ledger de execução (todas SUCCESS)

| Etapa | Estado | Evidência |
|---|---|---|
| 0. Baseline pré-merge (feature) | SUCCESS | build OK; goldens/deps/verify/guard OK; `test:f1b` PASS=23; `test:orders-rls` PASS=16 |
| 0.1 **Bloqueio detectado** | RESOLVIDO | `test:rls` PASS=14 **FAIL=1** (CK1 obsoleto) → [HARDEN-ORDERS-RLS-Errata-01](HARDEN-ORDERS-RLS-errata-01.md); commit `d7c64dc`; `test:rls` volta a **PASS=15** |
| 1. Restore point | SUCCESS | branch `backup/main-pre-f1-merge` → `4ae6c8d` (main pré-merge) |
| 2. Merge `--no-ff` | SUCCESS | `f25e7cb` (estratégia `ort`, sem conflitos); 31 arquivos, +2852/−37 |
| 3. Build (main) | SUCCESS | `vite build` exit 0 |
| 4. Suíte (main) | SUCCESS | pricing/addons/deps/verify:norm05/guard:slug OK · `test:f1b` PASS=23 · `test:rls` PASS=15 · `test:orders-rls` PASS=16 |
| 5. Auditoria 7 pontos | SUCCESS | ver §4 |
| 6. fsck | SUCCESS | `git fsck --full --strict` sem erros; 0 dangling |
| 7. Registro | SUCCESS | este ledger + status nos índices/ADRs |

---

## 4. Auditoria pós-merge (7 pontos — todos APROVADOS)

| # | Critério | Evidência objetiva |
|---|---|---|
| 1 | `main` idêntica ao estado aprovado | `git diff main feature/norm-06-f1a` = **0 arquivos**; `tree(main)` == `tree(feature)` = `c9fe9f8` |
| 2 | histórico íntegro + coerente (`--no-ff`) | merge `f25e7cb` com **2 pais**: `^1`=`4ae6c8d` (main antiga = backup), `^2`=`d7c64dc` (feature tip) |
| 3 | migrations/ADRs/runbooks/harnesses/rollbacks rastreáveis | **18 migrations** (9 aplicação + **9 rollback pareados**), **18 docs ADR**, **7 harnesses** — todos versionados na `main` |
| 4 | build verde na `main` | `vite build` exit 0 |
| 5 | suíte verde na `main` | f1b=23 · rls=15 · orders-rls=16 · +5 goldens/guards OK |
| 6 | tags corretas, nenhuma ref perdida | `norm-06-f1a-complete` (obj `03d7784`) → commit `4177a45` **intacta** e alcançável; inventário de refs só mudou `main` (`4ae6c8d`→`f25e7cb`) |
| 7 | working tree limpa | `git status` = "nothing to commit, working tree clean" |

**Inventário de refs (pós-merge):** `main` `f25e7cb` · `feature/norm-06-f1a` `d7c64dc` · `backup/main-pre-f1-merge` `4ae6c8d` · tag `norm-06-f1a-complete` `03d7784`.

---

## 5. Rollback (documentado)

Restore point preservado: **`backup/main-pre-f1-merge` → `4ae6c8d`**.

**Reverter o merge (git):**
- **Opção A (descartar a integração, mantém ref de segurança):** `git checkout main && git reset --hard backup/main-pre-f1-merge` → `main` volta a `4ae6c8d`. A branch `feature/norm-06-f1a` e a tag permanecem intactas.
- **Opção B (reverter preservando histórico):** `git revert -m 1 f25e7cb` → cria commit que desfaz o conteúdo do merge mantendo o registro.

**Importante — o git NÃO desfaz o banco.** As migrations já estão **aplicadas no banco vivo** (F1A/F1B/Errata/NORM-06.1/HARDEN-ORDERS-RLS). Reverter o git **não** reverte o schema/RLS/funções. Para reverter o **banco**, aplicar os rollbacks SQL **na ordem inversa de aplicação**, cada um conforme seu próprio ledger:
1. `migrations/HARDEN-ORDERS-RLS-step2-rollback.sql` → `...step1-rollback.sql` (nesta ordem — restaura checkout anon antes de reverter a RPC).
2. `migrations/NORM-06.1-step1-rollback.sql`.
3. `migrations/NORM-06-F1B-errata-01-securitydefiner-rollback.sql` → `...F1B-step1-rollback.sql`.
4. `migrations/NORM-06-F1A-step4-rollback.sql` → `step3` → `step2` (rollbacks da F1A).

> Reverter git e banco são operações **independentes**; o rollback de produção (banco) é o de maior risco e deve seguir os ledgers individuais de cada fase.

---

## 6. Conclusão

A `main` (`f25e7cb`) é a **nova baseline oficial**, funcionalmente idêntica ao estado aprovado da `feature/norm-06-f1a`, com histórico íntegro, suíte e build verdes, tags preservadas e working tree limpa. **F2+ permanece fora**, com o **F2 bloqueado** pela resolução humana das 2 colisões de `unique_nome_categoria`.

> **🔒 RUNBOOK MERGE-F1 ENCERRADO** — STATE: SUCCESS · `main` = `f25e7cb`.
