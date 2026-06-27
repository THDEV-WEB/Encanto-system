# Arquitetura — Encanto (`encanto-react`)

Este documento descreve **como a arquitetura funciona hoje**. Ele **não substitui os ADRs**:
os ADRs respondem *"por que a arquitetura ficou assim?"* ([`adr/README.md`](adr/README.md));
este documento responde *"como ela funciona hoje?"*.

## Visão em camadas

```
                         main.jsx  (entry)
                             │
                             ▼
        ┌──────────────────────────────────────────────┐
        │  CAMADA DE INTERFACE (React)                 │
        │  App.jsx · AppShell.jsx · BackgroundLayer    │
        │  estado · eventos · render                   │
        │  contém o objeto DataService (DS)            │
        └───────────────┬───────────────┬──────────────┘
        importa/consome  │               │ usa (DS.*)
                         ▼               ▼
        ┌────────────────────────┐   ┌────────────────────────┐
        │ CAMADA DE DOMÍNIO      │   │ CAMADA DE DADOS        │
        │ (pura — folhas)        │   │ DataService (DS)       │
        │                        │   │      │ PostgREST       │
        │  pricing.js  (Financeiro)  │      ▼                 │
        │  addons.js   (Adicionais)  │  @supabase/supabase-js │
        │                        │   │      ▼                 │
        │  0 imports · sem React │   │  Supabase → Banco      │
        └───────────┬────────────┘   └───────────┬────────────┘
                    ▲  dados (args)               │ fetch
                    └──────────────────────────────┘
```

**Direção das dependências (regra de ouro):**
- A **UI consome o domínio** (import) e **usa a camada de dados** (DS).
- O **domínio é folha**: não importa UI, nem `DataService`, nem Supabase. A UI **busca** os dados via DS
  e os **passa ao domínio como argumentos**.
- A integração `pricing.js` ↔ `addons.js` é **somente por dados** — nunca por import.

> Nota: este diagrama corrige a intuição comum de "domínio → DataService → Supabase". No estado atual,
> os módulos de domínio **não** dependem do DataService; quem orquestra a busca de dados e os entrega ao
> domínio é a UI (`App.jsx`). Isso é **provado mecanicamente** pelo guard `npm run test:deps` (ADR NORM-05.2).

## Camada de Interface

- **React**, ponto de entrada `main.jsx` → `App.jsx` → `AppShell.jsx` → `BackgroundLayer.jsx`.
- **Responsabilidade:** estado de UI, eventos, renderização, orquestração (busca dados via `DataService` e
  os passa às funções de domínio), formatação para exibição (`utils/format.js`).
- **O que NÃO pode existir aqui:** regra de negócio de preço ou de adicionais embutida em componente.
  Toda regra financeira vive em `pricing.js`; toda regra de adicionais vive em `addons.js`. A UI só
  **consome** o resultado.

## Camada de Domínio

Módulos **puros e determinísticos**, sem React/DOM/IO, executáveis em Node (golden tests + benchmarks).

### `pricing.js` — Domínio Financeiro
- **Responsabilidade:** quanto custa um pedido — `precoUnitario`, `precoLinha`, `totalCarrinho`,
  `emPromocao`, `precoVitrine`, `somaAdicionais`, `precoBaseItem`.
- **Contrato (congelado):** funções puras; nunca arredonda (formatação só em `fmt`); `Number()` cru sem
  `||0`; `||` nunca `??`; ordem do fold imutável. Detalhes no header de `src/utils/pricing.js`.
- **Garantias:** golden test (`npm run test:pricing`) + benchmark (`npm run bench:pricing`).

### `addons.js` — Domínio de Adicionais
- **Responsabilidade:** como funcionam os adicionais — `resolverAdicionais`, `agruparPorGrupo`,
  `gruposDoProduto`, `selecionarFonteAdicionais`, `ehAdicionalGratis`, `cotaGratis`,
  `resolverPrecoAdicionais`, taxonomia `GRUPOS`.
- **Contrato (congelado):** puro; data-in → data-out; imutável; sem saída visual (taxonomia crua, sem
  rótulo/emoji — isso é UI); API pública congelada (guard de exports). Detalhes no header de
  `src/utils/addons.js`.
- **Garantias:** golden test (`npm run test:addons`) + benchmark (`npm run bench:addons`) + guards de
  não-regressão (anti dupla-fonte, anti seam, independência de banco).

### Isolamento e integração
- `pricing.js` e `addons.js` são **folhas** (0 imports), **não se conhecem** e **não conhecem a UI/dados**.
- A integração entre eles é **por dados**: `addons` resolve o `preco` de cada adicional;
  `pricing.somaAdicionais` apenas soma. Provado por `test:deps` (NORM-05.2).

## Camada de Dados

```
DataService (DS)  →  @supabase/supabase-js (PostgREST)  →  Supabase  →  Banco (Postgres)
```

- **`DataService` (DS):** hoje é um objeto dentro de `App.jsx` que encapsula o acesso ao banco (queries,
  RPC `create_order`, paginação anti-truncamento, cache). Candidato natural a módulo próprio numa
  modularização futura do `App.jsx`.
- **Fonte canônica:** a tabela `public.adicionais` é a **única fonte oficial** de adicionais (NORM-05).
  `MOCK_ADS` existe apenas como fallback offline, fixture de teste e referência de rollback.
- **Reforço:** os módulos de domínio **não dependem desta camada**. Eles recebem dados já carregados como
  argumentos; nunca chamam DS/Supabase/`fetch`.

## Governança da arquitetura

- Módulos de domínio são **puros** (sem React/DOM/IO).
- **Contratos congelados** no header de cada módulo de domínio.
- **API pública congelada** (guard de exports; alterar exige revisão — exceções deliberadas exigem ADR).
- **Benchmarks permanentes** e reproduzíveis (`bench:pricing`, `bench:addons`).
- **Golden tests cumulativos** — snapshots nunca são removidos por correção de bug; toda regressão vira
  novo snapshot.
- **Guards mecânicos** — imports, exports, não-regressão de fonte única, isolamento de dependências
  (`test:deps`).
- **ADR obrigatório** para mudanças estruturais.
- **Commits dedicados** para mudanças de domínio — nunca misturar regra de negócio com refactor visual.

## Arquitetura atual

- ✅ **Domínio Financeiro** (`pricing.js`) consolidado.
- ✅ **Domínio de Adicionais** (`addons.js`) consolidado.
- ✅ **Fonte única de adicionais** (banco) consolidada.
- ✅ **Dependências auditadas** — domínios isolados, sem ciclos, sem dependência invertida.
- ⏳ **Dívida restante (única):** reconciliação do modelo dual (`acai` × `simples/premium/frutas_premium/
  chocolates`), classificada como dívida de **dados/UX** — **não mais arquitetural**. Reservada para um
  NORM futuro específico (decisão de produto), sem misturar com refactors de domínio.

---

Mapa completo das decisões e seus commits/rollbacks: [`adr/README.md`](adr/README.md).
