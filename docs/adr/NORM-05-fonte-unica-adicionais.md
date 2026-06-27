# ADR NORM-05 — Fonte única de adicionais (banco)

**Status:** Aceito e aplicado (2026-06-27)
**Contexto rito:** NORM (normalização do catálogo). Sucede NORM-04/04.1 (domínio `addons.js`).
**Migração:** `migrations/NORM-05-fonte-unica.sql` · Rollback: `migrations/NORM-05-rollback.sql`
**Relaciona:** ADR NORM-04 (domínio de adicionais), `pricing.js` (precedente de domínio).

---

## 1. Decisão

A **tabela `public.adicionais` passa a ser a fonte ÚNICA e oficial** de adicionais. O hardcode
`c3→tabela / resto→MOCK_ADS` (`selecionarFonteAdicionais`) foi **removido**. Para tornar isso
possível sem mudar comportamento, o schema foi estendido para acomodar o modelo legado e os
20 itens do `MOCK_ADS` foram migrados verbatim.

### O que mudou
- **Schema (DDL aditivo):** `CHECK(grupo)` estendido para `{simples, premium, frutas_premium,
  chocolates, acai, marmita, bebida}`; nova coluna `subgrupo_label text`.
- **Dados:** 20 linhas migradas (`acai`×15 + `marmita`×5) com `aplica_categoria_id=NULL` (valem p/
  todas as categorias, mesma semântica do MOCK), `ordem` preservando a ordem de exibição do MOCK, e
  `subgrupo_label` (Premium/Frutas/Chocolates) nos pagos do açaí. Banco: 15 → **35 linhas**.
- **Código:** `selecionarFonteAdicionais` perde o ramo c3 e o parâmetro `mockAds` (ver §4).

### Por que é zero comportamento
Provado por auditoria adversarial (workflow, 1 agente por grupo de categorias, executando o resolver
em Node) + golden: para **toda categoria** (c1/c3/c4/c5/c7/c8/c9/c10 + prod=null), a saída **agrupada
(o que o cliente vê)** — lista, ordem, tipo, preço e `subgrupo_label` — é idêntica antes (pool 15) e
depois (pool 35). O `grupo` + `aplica_categoria_id` separam naturalmente c3 (simples/premium, aplica c3)
de não-c3 (acai/marmita, aplica NULL). O fallback offline segue `DS.getAds() ?? MOCK_ADS`.

## 2. Contrato de schema (congelado)

A partir do NORM-05, estas colunas de `public.adicionais` fazem parte do **contrato do domínio**:

| Coluna | Papel |
|---|---|
| `grupo` | taxonomia (CHECK dos 7 valores) |
| `subgrupo_label` | subdivisão visual dos pagos (ex.: açaí Premium/Frutas/Chocolates) |
| `aplica_categoria_id` | escopo de categoria (`NULL` = todas) |
| `ordem` | ordem de exibição (sort do `agruparPorGrupo`) |
| `tipo` | `gratis`\|`pago` (CHECK) |
| `preco` | valor numérico |

**Alterar qualquer destas colunas exige:** migração dedicada (`migrations/`), atualização dos snapshots
(golden + `docs/norm05-db-snapshot.md`), revisão manual e **commit exclusivo**. Ninguém altera o schema
"aproveitando uma refatoração". O guard `npm run verify:norm05` falha imediatamente se o CHECK, a coluna
`subgrupo_label` ou as colunas obrigatórias mudarem.

## 3. Política do legado (`MOCK_ADS`)

`MOCK_ADS` **deixa de ser fonte oficial**. Após o NORM-05:
- **Banco = fonte oficial.** Qualquer alteração futura em adicionais ocorre **primeiro no banco**.
- `MOCK_ADS` existe apenas como: (a) **fallback offline** (`DS.getAds() ?? MOCK_ADS`), (b) **fixture de
  teste** (`addons.golden.mjs`, `verify:norm05`), (c) **referência de rollback**.
- Não se mantém duas fontes de verdade. O modelo dual (c3 `simples` × não-c3 `acai`) agora vive no banco
  como **dívida de DADOS documentada**; sua reconciliação é um NORM futuro (decisão de produto), não casual.

## 4. Exceção ao Freeze da API Pública (NORM-05)

O **NORM-04.1 congelou a API pública** do módulo `addons.js` (não alterar assinaturas; não alterar tipos
de retorno; não alterar a API pública sem revisão).

O **NORM-05 introduz uma única exceção deliberada**:

```
selecionarFonteAdicionais(prod, dbAds, mockAds)
                ↓
selecionarFonteAdicionais(prod, dbAds)
```

**Justificativa:**
- o NORM-05 elimina a existência de duas fontes de dados;
- `mockAds` deixa de existir como dependência operacional (o caller já faz `DS.getAds() ?? MOCK_ADS`);
- a assinatura anterior continha um parâmetro redundante;
- a simplificação reduz acoplamento e torna a API coerente com a arquitetura de fonte única.

Esta mudança é uma **exceção controlada** ao freeze da API pública e **não estabelece precedente** para
futuras alterações de assinatura. O comportamento de `selecionarFonteAdicionais` é preservado para todas
as entradas alcançáveis (c3 e não-c3, online e offline); `dbAds` não-array → `[]` (idêntico ao antigo
ramo c3). A partir desta revisão, **o novo contrato da API volta a ficar congelado** (o guard de exports
do `addons.golden` continua exigindo revisão para qualquer add/remove/rename).

**Re-freeze definitivo (NORM-05.1):** a alteração da assinatura de `selecionarFonteAdicionais()` foi uma
exceção **única e deliberada** para eliminar a dupla fonte de dados durante o NORM-05. A partir do commit
do NORM-05.1, o contrato público do módulo **volta a permanecer congelado**. Novas alterações de assinatura
exigem um **novo ADR específico** — esta exceção não se repete sem registro próprio.

## 5. Política da suíte Golden (reforço)

Mantida a política do NORM-04.1: a suíte é **cumulativa**; snapshots são comportamento congelado; toda
divergência descoberta gera um **novo** snapshot; snapshots antigos não são removidos por correção de bug.
No NORM-05, **um** snapshot foi atualizado (mudança de contrato intencional e revisada do seam:
`'fonte ≠c3 = MOCK'` → `'fonte = dbAds (sem seam c3)'`) e **três** foram adicionados (pool unificado:
c3→15, não-c3 açaí→15 migradas, marmita→5). Os snapshots do resolver/agrupado permaneceram inalterados.

## 6. Verificação e DoD

- **Backup** antes de tudo: `snapshot.mjs pre-norm-05` (restore point completo, inclui pedido real "44").
- **Migração idempotente:** re-rodar = `INSERT 0`.
- **`verify:norm05`** (guard de banco): schema + equivalência banco×legado (20 migradas ≡ MOCK_ADS) +
  resolver smoke + gera `docs/norm05-db-snapshot.md`.
- **`test:addons` / `test:pricing` / `build`** verdes; **`bench:addons`** executado.
- **Pedido real "44"** preservado (migração só INSERE adicionais; `orders`/`order_items` intocados).

## 7. Rollback

1. `migrations/NORM-05-rollback.sql` — `DELETE WHERE aplica_categoria_id IS NULL AND grupo IN
   ('acai','marmita','bebida')` (escopo seguro: pré-NORM-05 não havia linhas aplica-NULL) → restaura o
   CHECK restritivo → `DROP COLUMN subgrupo_label`.
2. `git revert <commit>` (restaura o seam c3 e os snapshots anteriores).
3. Último recurso: restore do snapshot `pre-norm-05`.

## 8. Consequências

- (+) Fonte única; sem hardcode de categoria no código; admin gerencia todos os adicionais.
- (+) Schema e equivalência guardados por teste; snapshot SQL versionado torna mudanças evidentes.
- (−) O modelo dual (acai/simples) agora vive no banco — dívida de dados explícita para um NORM futuro.
- (−) `subgrupo_label` e o literal de grupos legados existem no schema até a reconciliação.

## 9. NORM-05.1 — Endurecimento pós-migração

Endurecimento arquitetural (zero comportamento; só guards + documentação), no padrão NORM-03.1/04.1.

### 9.1 Banco como FONTE CANÔNICA (oficial)
A tabela `public.adicionais` passa a ser oficialmente a **única fonte canônica** dos adicionais do sistema.
Qualquer dado equivalente em mocks ou estruturas temporárias (`MOCK_ADS`) deve ser tratado **apenas** como
fixture de teste, fallback controlado (offline) ou mecanismo de desenvolvimento — **nunca como fonte de
verdade**. Essa distinção evita que o sistema volte a possuir duas verdades.

### 9.2 Guards mecânicos de não-regressão (em `addons.golden.mjs`, E3)
Lendo o código de `addons.js` (ignorando comentários), o golden falha se alguém:
- **reintroduzir a dupla fonte** — `?? MOCK_ADS` / `|| MOCK_ADS` / parâmetro `mockAds`;
- **recriar o seam por categoria** — literal de categoria (`'c3'` etc.) no resolver;
- **acoplar o domínio ao banco** — `Supabase`/`createClient`/`DataService` ou IO (`.from()`/`.rpc()`/`fetch()`).
Somados ao guard de imports (E) e ao guard de exports (E2), protegem o objetivo do NORM-05 por execução.

### 9.3 Suíte de verificação NORM-05 é CUMULATIVA
A suíte de verificação do NORM-05 (golden + `verify:norm05`) é cumulativa. Sempre que surgir um bug
relacionado à fonte única: **bug encontrado → novo caso de teste → correção → o teste permanece para
sempre**. Casos antigos nunca são removidos por um bug ter sido corrigido. O `verify:norm05` imprime um
relatório reproduzível (Node/plataforma/arquitetura/UTC/linhas/categorias/tempo) para comparação histórica.

### 9.4 Dívida remanescente — exclusivamente dados/UX
O único débito arquitetural remanescente é o **modelo dual**: `acai` × `simples/premium/frutas_premium/
chocolates`. Após o NORM-05 isso **deixou de ser problema arquitetural** (a fonte é única, o domínio é puro,
o seam morreu) e passou a ser **exclusivamente modelagem de dados e UX**. A reconciliação deverá acontecer
em um **NORM futuro específico**, com decisão de produto sobre a UI do açaí, e **não deve ser misturada**
com refactors do domínio ou outras fases.
