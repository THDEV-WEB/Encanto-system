# REF-APP-01 · Onda 0 — Reestruturação da regra D do `test:deps` (PROPOSTA)

- **Status:** 🟦 **PROPOSTA — NÃO APLICADA.** Documento de desenho da Onda 0 (pré-condição obrigatória B1 da REF-APP-01). Nenhuma alteração em `tests/deps.audit.mjs` foi feita. Aguarda autorização explícita para aplicar.
- **Pertence a:** [REF-APP-01 (DESENHO congelado)](REF-APP-01-modularizacao-appjsx.md) · achado **B1**.
- **Escopo:** **um único arquivo** — `tests/deps.audit.mjs`. Não toca código de produção, domínio, schema, ADRs nem comportamento. É mudança de **teste/governança**.
- **Motivo:** o `test:deps` (regra D) hoje exige que o domínio seja importado **exclusivamente** por `App.jsx`. Isso inviabiliza qualquer refatoração incremental: o primeiro componente extraído que importe `pricing`/`addons` reprova a suíte.

---

## 1. Estado atual (verificado no fonte)

[`tests/deps.audit.mjs`](../../tests/deps.audit.mjs) prova mecanicamente o isolamento dos domínios (`utils/pricing.js`, `utils/addons.js`) com 6 regras:

| Regra | Garante | Linha |
|---|---|---|
| **A** | domínio é **folha pura** (zero imports) | 31-33 |
| **B** | domínio não importa o outro domínio | 35-37 |
| **C** | domínio não importa visual/app/React/CSS/Supabase/format/logo | 39-42 |
| **D** | domínio importado **só por `App.jsx`** — `assert.deepStrictEqual(importers, ['App.jsx'])` | 44-48 |
| **E** | grafo **acíclico** (DFS) | 50-58 |
| **F** | `App.jsx` **consome** os dois domínios (direção correta) | 60-64 |

**O problema é só a regra D.** A intenção original (NORM-05.2, comentário L6) era barrar **dependência invertida** ("alguém além do App.jsx passar a importar um domínio"). Mas a implementação fixou o **conjunto exato** `['App.jsx']`, o que confunde dois conceitos distintos:
- **dependência invertida real** (domínio importando app/visual, ou ciclo) → já provada por **A** (folha) + **C** (sem imports proibidos) + **E** (sem ciclo);
- **governança de consumidores** (quem pode importar o domínio) → o que a regra D realmente faz, mas de forma rígida demais.

Como A+C+E já garantem que o domínio permanece folha e fora de ciclo, **a unicidade `['App.jsx']` não acrescenta proteção estrutural** — só impede que novos consumidores legítimos existam, que é exatamente o que a modularização precisa criar.

---

## 2. Objetivo da Onda 0

Reestruturar **apenas a regra D** para um modelo **compatível com modularização incremental**, **preservando integralmente** as regras A/B/C/E/F (prova primária de isolamento) e mantendo uma **trava de governança** contra consumidores não previstos.

---

## 3. Modelos avaliados

### Modelo A — Allowlist explícita fechada **(RECOMENDADO)**
A regra D passa a asserir que o conjunto de importers de cada domínio é **subconjunto** de uma allowlist versionada de consumidores legítimos (`DOMAIN_CONSUMERS`), e que nenhum importer é ele próprio um domínio. Adicionar um consumidor vira uma **edição consciente e revisada** do teste.

- ✅ Preserva a governança original da regra D (sem consumidor-surpresa).
- ✅ Compatível com extração incremental (a checagem é de subconjunto).
- ✅ Mantém A/B/C/E/F como prova estrutural intacta.
- ⚠️ A allowlist precisa de disciplina para não "apodrecer" (tratado por D3, abaixo).

### Modelo B — Contrato estrutural por domínio (sem lista)
A regra D é substituída por um invariante puramente estrutural, sem enumerar consumidores: "todo importer de domínio está sob `src/` **e** o domínio permanece folha (A) **e** o grafo é acíclico (E)".

- ✅ Não exige manutenção de lista.
- ❌ **Vácuo:** o `deps.audit` só varre `src/`, então "importer está sob `src/`" é sempre verdadeiro; e "folha + acíclico" já são A + E. Ou seja, a regra D vira um **no-op** — perde-se totalmente a trava de governança contra um import de domínio surgindo num lugar inesperado.

### Veredito
**Modelo A (allowlist).** Mantém a única coisa que a regra D agregava (governança de consumidores) numa forma incremental, enquanto A/B/C/E/F continuam sendo a prova mecânica de que o domínio é folha pura e fora de ciclo. O Modelo B enfraquece o invariante sem ganho real.

---

## 4. Proposta concreta (Modelo A) — substituir SÓ o bloco da regra D

> Diff conceitual — **não aplicado**. Substitui as linhas 44-48; A/B/C/E/F **inalteradas**.

```js
/* ── (D) governança de consumidores do domínio (sem dependência invertida) ──
   Antes: assert.deepStrictEqual(importers, ['App.jsx']) — rígido, inviabiliza modularização.
   Agora: importers ⊆ allowlist versionada; nenhum importer é domínio.
   A prova de "domínio = folha pura, fora de ciclo" segue em A/C/E (inalteradas). */
const DOMAIN_CONSUMERS = [
  'App.jsx',                                          // raiz (regra F)
  // Consumidores legítimos de domínio — cada entrada é adicionada NO COMMIT que cria o módulo:
  'pages/StoreApp.jsx',
  'hooks/useCart.js',                                 // → pricing
  'hooks/useAdicionais.js',                           // → addons
  'components/ProductCard.jsx',                        // → pricing
  'components/ProductModal/ProductModalInner.jsx',     // → addons
  'components/CartSidebar.jsx',                         // → pricing
  'components/ProductGrid.jsx',                         // (se/quando criado)
  'components/checkout/CheckoutPage.jsx',              // → pricing
  'components/admin/AdminProducts.jsx',                // → pricing
  'components/admin/AdminAdicionais.jsx',             // → addons
];
for (const d of DOMAIN) {
  const importers = files.filter(f => importsOf[f].some(s => isRel(s) && resolveRel(f, s) === d));
  // (D1) sem consumidor-surpresa: todo importer está na allowlist
  check(`${d}: importers ⊆ allowlist (sem consumidor-surpresa)`, () => {
    const fora = importers.filter(f => !DOMAIN_CONSUMERS.includes(f));
    assert.deepStrictEqual(fora, [], `consumidores não autorizados: ${JSON.stringify(fora)}`);
  });
  // (D2) sem dependência invertida real: nenhum importer é ele próprio um domínio
  check(`${d}: nenhum importer é módulo de domínio`, () => {
    const dom = importers.filter(f => DOMAIN.includes(f));
    assert.deepStrictEqual(dom, [], `domínio importando domínio: ${JSON.stringify(dom)}`);
  });
}
// (D3) higiene anti-apodrecimento: nenhuma entrada morta na allowlist
//      (cada consumidor listado já importa um domínio → a lista cresce commit-a-commit)
check('allowlist de consumidores sem entrada morta', () => {
  const todos = new Set(DOMAIN.flatMap(d => files.filter(f => importsOf[f].some(s => isRel(s) && resolveRel(f, s) === d))));
  const mortas = DOMAIN_CONSUMERS.filter(c => !todos.has(c));
  assert.deepStrictEqual(mortas, [], `entradas mortas: ${JSON.stringify(mortas)}`);
});
```

**Sobre o D3 (decisão de disciplina):** há duas formas de operar a allowlist —
- **(i) crescer commit-a-commit (recomendado):** cada extração que passa a importar um domínio adiciona **a si mesma** à allowlist **no mesmo commit**. Assim D3 fica ligado e pega tanto entradas mortas quanto consumidores-surpresa. A allowlist começa só com `App.jsx` (estado atual) e cresce.
- **(ii) pré-listar todos os consumidores futuros:** popular a allowlist de uma vez. Nesse caso **o D3 é omitido** (senão falha por entradas ainda não criadas), ficando só D1+D2.

A forma (i) dá governança máxima e foi a usada na validação abaixo.

---

## 5. Validação (PoC read-only — já executada, sem tocar o teste real)

Um PoC replicou a derivação de grafo do `deps.audit` e aplicou a regra D proposta contra o `src/` **atual**:

```
grafo ATUAL:  utils/pricing.js ← App.jsx   ·   utils/addons.js ← App.jsx
D1 (subset):       pricing: fora-da-allowlist=[] ✓   addons: fora-da-allowlist=[] ✓
D2 (não-domínio):  pricing: [] ✓   addons: [] ✓
TESTE NEGATIVO:    importers simulados=[App.jsx, utils/hacky-leak.js]
                   → D1 detecta fora-da-allowlist=[utils/hacky-leak.js] ✓ (FALHA corretamente)
RESULTADO: D1+D2 PASSAM no grafo atual ✓
```

Ou seja: a regra proposta **passa hoje** (equivalente à regra D atual quando só `App.jsx` consome) **e** continua **pegando um import de domínio inesperado** (governança preservada), mas **deixa de bloquear** os consumidores legítimos que a modularização vai criar.

### Plano de validação ao APLICAR a Onda 0 (quando autorizada)
1. Editar **somente** o bloco da regra D em `tests/deps.audit.mjs` (A/B/C/E/F intactas — diff revisado por humano).
2. `npm run test:deps` **verde** (regras A–F passam; relatório do grafo inalterado).
3. `npm run test:pricing` + `npm run test:addons` **verdes** (inalterados — domínio intocado).
4. **Teste negativo manual:** adicionar temporariamente um import de domínio num arquivo fora da allowlist → `test:deps` **falha** (D1) → reverter.
5. `npm run build` verde.
6. `git diff` mostra mudança **só** em `tests/deps.audit.mjs`. Commit dedicado.
7. Atualizar o cabeçalho/comentário do teste documentando que **A/B/C/E/F continuam a prova primária** de isolamento e que a regra D agora é governança por allowlist.

**Rollback:** `git revert <commit>` (um arquivo, isolado). Sem efeito em produção/banco.

---

## 6. O que esta Onda 0 NÃO faz

- Não extrai nenhum componente nem move código de `App.jsx`.
- Não toca `pricing.js`/`addons.js`/`format.js` (continuam folhas; regras A/B/C intactas).
- Não cria o golden de payload do checkout (B2) nem o smoke render test (R9) — esses entram no congelamento da **fase de execução**, depois.
- Não autoriza a execução da REF-APP-01.

---

> 🟦 **ONDA 0 — PROPOSTA. Aguardando autorização para aplicar a reestruturação da regra D.** Após aplicada, o usuário autoriza o congelamento da fase de execução da REF-APP-01.
