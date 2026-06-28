# Errata-01 da F1A (NORM-06) — Expressão de geração de slug

- **Tipo:** **ERRATA de implementação.** Corrige a expressão SQL de geração de slug usada na F1A.
- **ADR:** [NORM-06](NORM-06-collections.md) permanece **🔒 CONGELADO** — esta errata **não reabre o ADR**.
- **Descoberta:** durante a **execução controlada** da F1A (Execution Gate / pré-Etapa 1), o guard de slug (read-only) revelou slugs quebrados antes de qualquer escrita no banco.
- **Rastreabilidade:** registrada como documento próprio + commit dedicado na branch `feature/norm-06-f1a`.

## 1. Escopo (o que esta errata NÃO faz)

- **não altera a arquitetura;**
- **não altera o escopo;**
- **não altera decisões** (D-DEST, STI, contrato do Collection Engine, fases, RLS provisória, etc.);
- **corrige apenas a implementação da expressão SQL** de slug.

## 2. Expressão incorreta (NÃO usar)

```sql
lower(regexp_replace(unaccent(nome), '[^a-z0-9]+', '-', 'g'))
```

## 3. Causa técnica (registrar para não reintroduzir)

> A expressão original aplicava `regexp_replace()` **antes** de `lower()`, fazendo com que caracteres **maiúsculos** fossem tratados como inválidos pela classe `[a-z0-9]` e substituídos por hífens.

Consequência: cada nome **perdia suas letras maiúsculas** (inclusive a inicial) e ganhava um **hífen no lugar** (ex.: hífen à esquerda + perda da 1ª letra).

⚠️ **Não "otimizar" reordenando `lower()` para fora do `regexp_replace()`** — isso **reintroduz exatamente este bug**. O `lower(unaccent(...))` precisa vir **antes** do `regexp_replace`.

## 4. Expressão corrigida (AUTORITATIVA para a F1A)

```sql
trim(both '-' from regexp_replace(lower(unaccent(nome)), '[^a-z0-9]+', '-', 'g'))
```

- `lower(unaccent(nome))` **primeiro** (minúsculas e sem acento) → depois `regexp_replace` → depois `trim` dos hífens das pontas (defensivo).
- Esta expressão **supersede** a de [NORM-06 §6/§7](NORM-06-collections.md) **para fins de execução**. O **guard** e o **backfill** DEVEM usar **byte-a-byte a mesma forma** (preserva a regra "guard e backfill usam a mesma expressão").

## 5. Evidência (read-only, 9 categorias — 2026-06-28)

| nome | slug INCORRETO (ADR) | slug CORRETO (errata) |
|---|---|---|
| Cardápio de Marmitas | `-ardapio-de-armitas` ❌ | `cardapio-de-marmitas` |
| Destaques | `-estaques` ❌ | `destaques` |
| Copos Prontos | `-opos-rontos` ❌ | `copos-prontos` |
| Monte seu Copo | `-onte-seu-opo` ❌ | `monte-seu-copo` |
| Batidinhas | `-atidinhas` ❌ | `batidinhas` |
| Combos | `-ombos` ❌ | `combos` |
| Pedido Fitness | `-edido-itness` ❌ | `pedido-fitness` |
| Bebidas | `-ebidas` ❌ | `bebidas` |
| Promoção do Dia | `-romocao-do-ia` ❌ | `promocao-do-dia` |

**0 colisões** em ambas as formas (não quebraria o `UNIQUE`), mas a incorreta gravaria **slugs lixo** (hífen à esquerda + perda de maiúsculas) — `slug` é usado para URL/SEO (NORM-06A).

## 6. Verificação obrigatória do guard (casos conhecidos)

O Guard de Slug (Etapa 1) passa a validar **explicitamente** (além de 0 colisões) que a geração produz **exatamente** o esperado:

| Nome | Slug esperado |
|---|---|
| Cardápio de Marmitas | `cardapio-de-marmitas` |
| Destaques | `destaques` |
| Monte seu Copo | `monte-seu-copo` |
| Promoção do Dia | `promocao-do-dia` |

Implementado em [`scripts/norm06-f1a-slug-guard.mjs`](../../scripts/norm06-f1a-slug-guard.mjs) (`npm run guard:slug`): colisões + casos conhecidos + defensivo (nenhum slug vazio ou com hífen nas pontas); **exit ≠ 0** em qualquer falha.

## 7. Efeito no Execution Plan

- **Etapa 1 (Guard de Slug)** usa esta expressão corrigida e o script acima (colisões **e** casos conhecidos).
- **Etapa 2 (DDL)** — o `UPDATE categories SET slug = …` usa **byte-a-byte** a expressão da §4 desta errata.
- Nenhuma outra etapa muda.
