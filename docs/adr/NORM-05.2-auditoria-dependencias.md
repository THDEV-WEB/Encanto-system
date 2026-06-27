# ADR NORM-05.2 — Auditoria de Dependências (isolamento dos domínios)

**Status:** Aceito e aplicado (2026-06-27) — **encerra oficialmente a trilha de domínios**
**Contexto rito:** NORM. Sucede NORM-05/05.1 (fonte única de adicionais).
**Guard permanente:** `tests/deps.audit.mjs` (`npm run test:deps`).

---

## 1. Objetivo

Provar **mecanicamente** que os módulos de domínio (`pricing.js`, `addons.js`) estão isolados do resto do
sistema, e congelar essa garantia num guard que falha se o isolamento quebrar no futuro.

## 2. Grafo de dependências (derivado do `src/`)

```
main.jsx ──→ App.jsx
App.jsx  ──→ logo.js · AppShell.jsx · utils/format.js · utils/pricing.js · utils/addons.js
                                       (+ externos: react, @supabase/supabase-js, ./index.css)
AppShell.jsx ──→ BackgroundLayer.jsx
BackgroundLayer.jsx · logo.js · utils/format.js · utils/pricing.js · utils/addons.js ──→ (folhas)
```

```
utils/pricing.js  ←  App.jsx          (único importador)
utils/addons.js   ←  App.jsx          (único importador)
```

## 3. Achados (todos VERDES)

| # | Verificação | Resultado |
|---|---|---|
| 1 | Grafo de dependências entre módulos | DAG mapeado acima |
| 2 | Ausência de ciclos | ✅ acíclico (DFS) |
| 3 | Quem importa `pricing.js` | ✅ só `App.jsx` |
| 4 | Quem importa `addons.js` | ✅ só `App.jsx` |
| 5 | Dependência invertida | ✅ nenhuma (domínios não importam nada) |
| 6 | `App.jsx` apenas consome o domínio | ✅ consumidor; nunca o inverso |
| 7 | Módulo visual importado por domínio | ✅ nenhum (domínios = folhas puras, 0 imports) |
| 8 | Domínio conhece outro domínio | ✅ não — `pricing` e `addons` não se importam |

`pricing.js` e `addons.js` têm **zero imports** (folhas puras). `format.js` também é folha pura, mas é
**UI-adjacent** (`fmt` formata moeda) — por isso o domínio nunca o importa (regra C do guard).

## 4. Guard permanente (`tests/deps.audit.mjs`)

Análise estática pura (sem banco) que re-deriva o grafo a cada execução e **falha** se:
- **(A)** um domínio deixar de ser folha pura (passar a importar algo);
- **(B)** um domínio importar o outro domínio;
- **(C)** um domínio importar visual/app/React/CSS/Supabase/`format`/`logo`;
- **(D)** alguém além do `App.jsx` importar um domínio (dependência invertida);
- **(E)** surgir um ciclo no grafo;
- **(F)** `App.jsx` deixar de consumir os dois domínios.

Imprime o grafo (módulo → importa) e quem importa o domínio. Roda com `npm run test:deps`.

## 5. Conclusão

A camada de domínio (`pricing.js` + `addons.js`) está **isolada e à prova de regressão**: folhas puras,
sem ciclos, sem dependência invertida, sem acoplamento visual/IO, e sem conhecimento mútuo. A integração
acontece exclusivamente no `App.jsx` (consumidor) e **por dados** (não por import) entre os domínios.

Com isto, a **trilha de domínios encerra oficialmente**: `pricing.js` (NORM-03/03.1), `addons.js`
(NORM-04/04.1), fonte única no banco (NORM-05/05.1) e isolamento provado (NORM-05.2). A única dívida
remanescente (modelo dual `acai`×`simples`) é exclusivamente de dados/UX, para um NORM futuro específico.
