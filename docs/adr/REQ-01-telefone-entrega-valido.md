# REQ-01 — Telefone válido para entrega (requisito funcional oficial)

- **Status:** ✅ **APROVADO — requisito funcional oficial do produto** (2026-07-05, aprovado pelo usuário, "Opção A"). Vigente a partir da Fase 1 de estabilização.
- **Tipo:** Requisito funcional de negócio (não é NORM/HARDEN/REF — nova categoria REQ).
- **Origem:** derivado da estabilização de produção (Fase 1). Antes disso **não havia** requisito de formato de telefone documentado; a regra real do backend (`normalize_phone`) é mais leniente (aceita ≥1 dígito). Esta decisão **oficializa** um formato mais estrito, por escolha de negócio (só aceitar telefone de entrega real).

---

## 1. Requisito

O checkout do Encanto **exige um telefone de entrega válido**: **DDD + número = 10 ou 11 dígitos** (após remover não-dígitos).

- Telefone com **menos de 10 dígitos** é **inválido** e **não pode finalizar pedido**.
- Justificativa: garantir contato/entrega reais; evitar pedidos com telefone inutilizável.

## 2. Enforcement atual (Fase 1)

- **Frontend — `CheckoutPage.submit`** ([src/App.jsx](../../src/App.jsx), commit `9b8f7ac`):
  ```js
  const digits = form.telefone.replace(/\D/g, '');
  if (digits.length < 10) { setErr('Informe um telefone válido com DDD (mínimo 10 dígitos).'); return; }
  ```
  Feedback via estado inline `err` (padrão do `AdminLogin`), sem `alert()`.
- **Backend — `normalize_phone` / `create_order`:** **inalterado nesta fase** (aceita ≥1 dígito; rejeita só zero-dígito). O frontend é, portanto, **mais estrito** que o backend — nenhum telefone inválido chega à RPC.

## 3. Fonte de verdade & divergência conhecida (aceita nesta fase)

Atualmente a validação é **dupla e divergente**: frontend (≥10 díg., regra oficial) × backend (`normalize_phone`, ≥1 díg.). A divergência é **conhecida e aceita** temporariamente porque o frontend mais estrito já **impede 100%** dos telefones inválidos de chegarem ao backend. A convergência é a pendência **PEND-PHONE-SSOT** (§6).

## 4. Fixture de teste canônico (go-forward)

- **Telefone-teste canônico válido:** `38999990000` (DDD 38 + 9 díg. = 11; formato válido; já usado no golden B2). Scripts de teste usam variantes sintéticas ≥10 díg. (`3890000000x`).
- **Supersede** o smoke-test manual histórico **"pedido real (telefone 44)"**: daqui em diante, qualquer smoke-test de "pedido real" usa um telefone **válido (≥10 díg.)**.
- **Registro histórico preservado:** as referências a "telefone 44" nos ledgers **congelados** (NORM-05, NORM-06, NORM-06-F1A, HARDEN-ORDERS-RLS) **não são reescritas** — são evidência factual de fases já concluídas. Este REQ as supersede apenas para execuções futuras.

## 5. Dados históricos

Pedidos **pré-existentes** com telefone curto (ex.: o pedido real "44" de 2026-06) **não são invalidados retroativamente**. O requisito é **go-forward**; nenhuma migração/limpeza de dados é feita aqui (evita risco de perda de dados).

## 6. 🔧 Pendência arquitetural — PEND-PHONE-SSOT (fase futura, NÃO agora)

Registrada para uma fase futura apropriada (não implementar agora):

1. **Alinhar `normalize_phone()` à regra oficial** (≥10 díg., DDD + número) — hoje ela aceita ≥1 dígito.
2. **Centralizar a validação numa ÚNICA fonte de verdade** compartilhada entre frontend e backend (ex.: uma spec/função de validação única, ou CHECK/constraint no schema espelhando a regra), eliminando a divergência do §3.
3. Ao alinhar o backend, reavaliar o tratamento de dados históricos curtos.

> ⚠️ **Não é uma refatoração desta fase.** Alteração estrutural (tocar `normalize_phone`/schema) exige fase própria com autorização.

## 7. Testes & Rollback

- **Fixtures executáveis** atualizados para telefone válido (`scripts/harden-orders-rls-test.mjs`, `scripts/norm06-1-rls-test.mjs`) — sem alterar asserções (que checam `ok`/`order_id`/`rowCount`, nunca o valor do telefone). Suíte re-executada verde.
- **Rollback:** documentação + fixtures → `git revert` do commit. Sem mudança de schema/banco/`normalize_phone`.

> ✅ **REQ-01 — requisito funcional oficial.** Enforcement no frontend (Fase 1). Convergência frontend↔backend = **PEND-PHONE-SSOT** (fase futura).
