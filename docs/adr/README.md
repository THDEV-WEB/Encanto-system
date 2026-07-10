# ADRs — Índice oficial das decisões arquiteturais

Porta de entrada da documentação de arquitetura do **Encanto** (`encanto-react`). Cada ADR responde
**"por que a arquitetura ficou assim?"**. Para **"como a arquitetura funciona hoje?"**, ver
[`../ARCHITECTURE.md`](../ARCHITECTURE.md).

Convenção: campos sem valor aplicável usam `—`. Hashes e arquivos são reais (não inventar).

## Trilha de domínios (NORM-03 → NORM-05.2) — implementada

| ADR | Tema | Status | Depende de | Substitui | Relacionado | Próximo | Commit | Rollback |
|---|---|---|---|---|---|---|---|---|
| **NORM-03** | Engine de preço única (`pricing.js`) — domínio financeiro | Aplicado | — | (preço inline em ~7 sítios) | NORM-04 | NORM-03.1 | `e9a460b` | `git revert e9a460b` |
| **NORM-03.1** | Hardening financeiro: contrato congelado + benchmark permanente | Aplicado | NORM-03 | — | NORM-04.1 | NORM-04 | `6f46fde` | `git revert 6f46fde` |
| **[NORM-04](NORM-04-dominio-adicionais.md)** | Domínio de adicionais (`addons.js`) — resolvers + grátis unificados | Aplicado | NORM-03 | (getFonteAdicionais/getAdicionaisProd/getAdsByGrupo) | NORM-01A, NORM-06A | NORM-04.1 | `44a3f3a` | `git revert 44a3f3a` |
| **NORM-04.1** | Hardening adicionais: bench + guard de exports + política golden | Aplicado | NORM-04 | — | NORM-03.1 | NORM-05 | `dc5d5e6` | `git revert dc5d5e6` |
| **[NORM-05](NORM-05-fonte-unica-adicionais.md)** | Fonte única de adicionais (banco) — remove o seam c3 | Aplicado | NORM-04 | (MOCK_ADS como fonte; seam c3) | NORM-04 | NORM-05.1 | `7cab109` | `migrations/NORM-05-rollback.sql` + `git revert 7cab109` |
| **NORM-05.1** | Hardening fonte única: guards de não-regressão + governança | Aplicado | NORM-05 | — | NORM-04.1 | NORM-05.2 | `e36fefb` | `git revert e36fefb` |
| **[NORM-05.2](NORM-05.2-auditoria-dependencias.md)** | Auditoria de dependências — isolamento provado dos domínios | Aplicado | NORM-03, NORM-04, NORM-05 | — | — | — (encerra a trilha) | `9d4edce` | `git revert 9d4edce` |

**Sub-fases sem arquivo de ADR dedicado** (documentadas inline, propositalmente):
- **NORM-03 / NORM-03.1** → no header de [`../../src/utils/pricing.js`](../../src/utils/pricing.js) (banner DOMÍNIO FINANCEIRO + contrato).
- **NORM-04.1** → no ADR [NORM-04](NORM-04-dominio-adicionais.md) §6.1.
- **NORM-05.1** → no ADR [NORM-05](NORM-05-fonte-unica-adicionais.md) §9.

## Outros ADRs (desenho / reservado — não implementados)

Decisões de produto/arquitetura registradas como design, ainda **não implementadas**.

| ADR | Tema | Status | Commit (impl.) |
|---|---|---|---|
| [NORM-01A](NORM-01A-modelo-canonico-catalogo.md) | Modelo canônico do catálogo | Desenho | — |
| [NORM-06A](NORM-06A-modelo-grupos-catalogo.md) | Modelo categories × collections (v4) | Desenho (congelado) | — |
| [NORM-06](NORM-06-collections.md) | Implementação do catálogo: Collections (só Collections; RLS e legado extraídos) | **Bloco F1 ENCERRADO e MERGEADO na `main`** (merge `f25e7cb`, 2026-06-30, baseline oficial): F1A (estrutura) · F1B (invariantes STI I1–I4) · F1B-Errata-01 · F1C=NORM-06.1; tag F1A `norm-06-f1a-complete`. **F2+ pendente** (F2 bloqueado por 2 colisões `unique_nome_categoria`) | F1A: `c1e6850`…`4177a45`; F1B+: ver git log; merge `f25e7cb` |
| [NORM-07](NORM-07-collection-engine.md) | Collection Engine (resolver members-only; hidratação na camada superior) | Reservado | — |
| [NORM-08](NORM-08-search-engine.md) | Search Engine | Reservado | — |
| [NORM-09](NORM-09-event-engine.md) | Event Engine | Reservado | — |
| [NORM-06.1](NORM-06.1-harden-rls.md) / HARDEN-RLS | RLS do catálogo: escrita `authenticated` em categories/adicionais/product_collections + substitui `pc_public_read`; **preserva leitura pública** (D1, diverge da §3.2) | **APLICADA (2026-06-30) · MERGEADA na `main`** (merge `f25e7cb`) — signups+anon desabilitados; `test:rls` PASS=15 — [ledger](NORM-06.1-execution-plan.md) | merge `f25e7cb` |
| NORM-06 · F1B-Errata-01 | Funções STI `SECURITY DEFINER` — corrige escrita `authenticated` sob RLS (FOR SHARE não enxergava categoria); decoupla STI da RLS; EXECUTE mínimo | **APLICADA (2026-06-30)** com a NORM-06.1 | ver git log (branch) |
| [HARDEN-ORDERS-RLS](HARDEN-ORDERS-RLS.md) | Fecha exposição pública dos pedidos: `create_order`→SECURITY DEFINER; anon sem leitura direta de `orders`/`customers`/`order_items`/`v_order_reconciliation` (grants revogados); view→`security_invoker`. Preserva checkout + admin | **APLICADA (2026-06-30) · MERGEADA na `main`** (merge `f25e7cb`) — `test:orders-rls` PASS=16; Errata-01 (re-baseline `test:rls` CK1) — [ledger](HARDEN-ORDERS-RLS-execution-plan.md) | merge `f25e7cb` |
| HARDEN-LEGACY | Remoção de legado (`DROP image_url`, `DROP destaque`) após estabilização — **extraído do NORM-06** | Reservado (fase própria) | — |

**Runbooks de execução:** [NORM-06 · F1A — Execution Plan](NORM-06-F1A-execution-plan.md) (estrutura; 11 etapas) · [NORM-06 · F1B — Execution Plan](NORM-06-F1B-execution-plan.md) (invariantes STI I1–I4; revisão adversarial, D-I4-ADIC, ledger de evidências, achado de colisão do F2). Procedimentos institucionais: pré-condições → etapas em ordem imutável → abort em qualquer falha; não alteram arquitetura.

**Erratas:** [NORM-06 · F1A — Errata-01 (slug)](NORM-06-F1A-errata-01-slug.md) — correção da expressão SQL de slug (bugfix de implementação descoberto na execução; **não** altera arquitetura/escopo/decisões; ADR permanece congelado). · [HARDEN-ORDERS-RLS — Errata-01 (re-baseline test:rls CK1)](HARDEN-ORDERS-RLS-errata-01.md) — inverte a asserção CK1 da NORM-06.1 (anon `INSERT customers` direto agora **negado 42501** pelo D-GRANTS; checkout migra para `test:orders-rls` AC1); **não** altera produção/arquitetura; restaura `test:rls` **PASS=15** (descoberta no baseline pré-merge do bloco F1).

**Fase de frontend (REF — arquitetura, fora da trilha NORM):** ▶️ [REF-APP-01 — Modularização do `App.jsx`](REF-APP-01-modularizacao-appjsx.md) — **TECNICAMENTE CONCLUÍDA (Ondas 0–9 aplicadas; `App.jsx` = orquestrador mínimo)**: diagnóstico do monólito (3866 linhas → ~48 módulos), ordem em ondas, riscos, validação e estratégia zero-mudança-funcional. **INV-CK (invariante estrutural ✅ ACEITO, risco eliminado por regra — `937b6e6`):** submit = orquestração; cálculo/formatação/derivação do pedido só no order-domain (`utils/orderPayload.js`, fonte única de verdade); DataService só persistência; sem duplicação — barrado por `test:deps` **G-CK1 (=D2) + G-CK2 (checkout ∌ domínio) + G-CK3 (order-domain puro)**, inertes-prontos. **Bloqueio: nenhuma Onda 1 até INV-CK aceito + order-domain validado + risco eliminado (os três satisfeitos).** **Decisões pré-execução ratificadas (2026-06-30):** B4 = consolidações adiadas p/ REF-APP-02 (REF-APP-01 100% move-puro); R9 = render net `test:render` adotado (snapshot de markup via react-dom/server p/ folhas; esbuild compila JSX); `import './index.css'` → mover p/ `main.jsx`. Falta só o congelamento da execução. Pré-condição obrigatória (achado B1): ✅ [REF-APP-01 · Onda 0 — deps.audit](REF-APP-01-onda-0-deps-audit.md) — **APLICADA (`1b55379`)**: regra D do `test:deps` reestruturada (importer rígido `['App.jsx']` → **D1 allowlist evolutiva + D2 estrutural por camada** [services/lib/data/constants não importam pricing/addons/format] **+ D3 higiene**), A/B/C/E/F inalteradas; `test:deps`/`test:pricing`/`test:addons`/`build` verdes. **🚀 EXECUÇÃO INICIADA — [REF-APP-01 · Onda 1 (DOMÍNIO PURO)](REF-APP-01-onda-1-execution.md) APLICADA** (`8703394`…`175542a`, 2026-06-30): 6 módulos extraídos do `App.jsx` (`lib/supabase`, `utils/ids`, `utils/catalog`, `data/mockCatalog`, `constants/catalogConfig`, `constants/storage`); **`App.jsx` 3866→3452 linhas**; move-puro provado byte-a-byte + auditoria adversarial **LIMPO**; suíte completa verde; restore `backup/main-pre-onda-1` (`0be695d`). `constants/orderStatus.js` (dedup B4) e `constants/checkout.js` (`pays`/`steps`, locais ao checkout) diferidos. **Ondas 2–9 APLICADAS (2026-07-06→10):** Onda 2 (`DataService.js`, `3643c9d`/`09aff7c`), Onda 3 (hooks, `4d30541`…`a5194e8`), rede R9 (`test:render`, `39615c9`), Onda 4 (folhas visuais, `e1164cd`…`f4c5b12`), Onda 5 (checkout · Trilha B: `SuccessPage` `3350ab3`, order-domain `utils/orderPayload.js` `e5ae1a2`, `CheckoutPage` `e4985e8`, limpeza 5.4 `796098c`), Onda 6 (admin catálogo/auth/upload: `AdminLogin`/`AdminCategorias`/`ImageUploader`/`AdminProducts` → `components/admin/`, `789459d`…`4c721a8`) e Onda 7 (admin operações + barrel `AdminPanel`: `AdminAdicionais`/`AdminPedidos`/`AdminDashboard`/`AdminStatus`/`AdminFidelidade`/`AdminHealth` → `components/admin/`, depois barrel `AdminPanel`, `333e1d5`…`7f07bfb`), Onda 8 (componentes isolados da loja: `SearchBar` `2ea1e03`, `AddressModal` `0acea12` → `components/`) e Onda 9 (núcleo `StoreApp` → `pages/StoreApp.jsx`, `61010f7`/`c465579`); `App.jsx` 3866→124 linhas — **orquestrador mínimo** (router + 3 tokens estruturais, zero lógica de domínio); suíte 7/7 verde; sem push. **REF-APP-01 tecnicamente CONCLUÍDA** (consolidação/dedup B4 = REF-APP-02, não iniciada). Pré-requisito do congelamento da execução: 🟦 [REF-APP-01 · B2 — Golden de checkout](REF-APP-01-B2-checkout-golden.md) — **PROPOSTA**: payload mínimo de `create_order` (`buildOrderArgs`/`buildWhatsAppMessage` puros) + golden `test:checkout` **sem banco** (snapshot do payload+msg, reconciliação Σ(price×qty)=total, product_id uuid/mock, idempotência, pureza); validado por PoC. Independente do NORM-06.

**Fases do NORM-06:** ✅ **F1A (estrutura)** — colunas STI em `categories`, tabela `product_collections`, índices, constraints (UNIQUE/CHECK/FK), `slug` (Errata-01) e RLS provisória — **CONCLUÍDA** (2026-06-28; tag `norm-06-f1a-complete`). ✅ **F1B (invariantes STI I1–I4)** — 4 triggers `BEFORE` (`trg_sti_*`) com `FOR SHARE` anti-TOCTOU + D-I4-ADIC; `test:f1b` PASS=23 (negativos + positivos + concorrência + role-aware) — **CONCLUÍDA** (2026-06-29; evidências no runbook F1B). ✅ **F1C / NORM-06.1** (hardening de RLS, substitui `pc_public_read`; `test:rls` PASS=15) — **CONCLUÍDA** (2026-06-30). **Bloco F1 (F1A + F1B + F1B-Errata-01 + F1C/NORM-06.1) + HARDEN-ORDERS-RLS INTEGRADOS à `main`** no merge `f25e7cb` (2026-06-30 — nova baseline oficial). ⏳ **F2+** (backfill Destaques — **resolver antes as 2 colisões de `unique_nome_categoria`** —, DataService, Admin, UI) seguem **pendentes**, em fases próprias (F2 bloqueado).

**Requisitos funcionais (REQ — regras de negócio oficiais):** ✅ [REQ-01 — Telefone válido para entrega](REQ-01-telefone-entrega-valido.md) — **APROVADO (2026-07-05)**: checkout exige telefone **DDD + número = 10/11 dígitos**. Enforcement no **frontend** (`CheckoutPage`, `digits.length<10`, commit `9b8f7ac` da Fase 1 de estabilização); backend `normalize_phone` **inalterado** (aceita ≥1 díg. → frontend mais estrito impede inválidos). Fixtures executáveis atualizados p/ telefone válido; smoke-test histórico "telefone 44" **superseded** (ledgers congelados não reescritos). **Pendência arquitetural PEND-PHONE-SSOT** (fase futura, não agora): alinhar `normalize_phone` à regra oficial + centralizar validação numa **única fonte de verdade** frontend↔backend.

## Sequência da evolução arquitetural

```
NORM-03 → 03.1   (pricing.js — domínio financeiro)
   → NORM-04 → 04.1   (addons.js — domínio de adicionais)
      → NORM-05 → 05.1   (fonte única no banco; seam c3 removido)
         → NORM-05.2   (isolamento dos domínios provado — trilha encerrada)
```

**Dívida remanescente (única):** reconciliação do modelo dual (`acai` × `simples/premium/frutas_premium/
chocolates`) — agora dívida de **dados/UX**, não arquitetural. Reservada para um NORM futuro específico.
