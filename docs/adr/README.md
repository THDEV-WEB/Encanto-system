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
| [NORM-06](NORM-06-collections.md) | Implementação do catálogo: Collections (só Collections; RLS e legado extraídos) | 🔒 Congelado para implementação — D-DEST aprovada; pronto para F1A | — |
| [NORM-07](NORM-07-collection-engine.md) | Collection Engine (resolver members-only; hidratação na camada superior) | Reservado | — |
| [NORM-08](NORM-08-search-engine.md) | Search Engine | Reservado | — |
| [NORM-09](NORM-09-event-engine.md) | Event Engine | Reservado | — |
| NORM-06.1 / HARDEN-RLS | RLS de coluna local (anon=só disponíveis · authenticated=todos) — **extraído do NORM-06** | Reservado (fase própria) | — |
| HARDEN-LEGACY | Remoção de legado (`DROP image_url`, `DROP destaque`) após estabilização — **extraído do NORM-06** | Reservado (fase própria) | — |

**Runbooks de execução:** [NORM-06 · F1A — Execution Plan](NORM-06-F1A-execution-plan.md) — checklist operacional **obrigatório** da F1A (procedimento institucional: pré-condições → 11 etapas em ordem imutável → abort em qualquer falha; não altera arquitetura).

**Erratas:** [NORM-06 · F1A — Errata-01 (slug)](NORM-06-F1A-errata-01-slug.md) — correção da expressão SQL de slug (bugfix de implementação descoberto na execução; **não** altera arquitetura/escopo/decisões; ADR permanece congelado).

## Sequência da evolução arquitetural

```
NORM-03 → 03.1   (pricing.js — domínio financeiro)
   → NORM-04 → 04.1   (addons.js — domínio de adicionais)
      → NORM-05 → 05.1   (fonte única no banco; seam c3 removido)
         → NORM-05.2   (isolamento dos domínios provado — trilha encerrada)
```

**Dívida remanescente (única):** reconciliação do modelo dual (`acai` × `simples/premium/frutas_premium/
chocolates`) — agora dívida de **dados/UX**, não arquitetural. Reservada para um NORM futuro específico.
