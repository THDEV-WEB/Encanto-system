# ADR NORM-04 — Domínio de Adicionais (`addons.js`)

**Status:** Aceito (design congelado; implementação pendente de aplicação)
**Data:** 2026-06-27
**Contexto rito:** NORM (normalização do catálogo). Sucede NORM-03/03.1 (`pricing.js`).
**Relaciona:** [NORM-01A] modelo canônico · [NORM-06A] categories×collections · pricing.js (precedente de módulo de domínio).

---

## 1. Contexto

As regras de adicionais vivem espalhadas em `App.jsx`: `getFonteAdicionais`, `getAdicionaisProd`,
`getAdsByGrupo`, `marmitaPermitido`/`MARMITA_PERMITIDOS`, `MOCK_ADS`, `CAT_ADDON_GROUP`, o predicado
de grátis (`allGratis`), a derivação de cota grátis (`gratis_max`) e o engine de franquia grátis
(`selComPreco`, Tier 3 adiado do NORM-03). São 3 resolvers parcialmente redundantes + helpers,
acoplados ao componente React.

Depois do NORM-03, `pricing.js` virou um módulo de domínio com contrato congelado, golden test em
Node puro e benchmark. **NORM-04 replica essa filosofia para os adicionais**: `addons.js` deixa de ser
util e passa a ser o módulo de domínio que responde *"como funcionam os adicionais do Encanto"* — assim
como `pricing.js` responde *"quanto custa um pedido"*.

### Realidade de produção (auditada no banco, 2026-06-27)

- `adicionais` (15 linhas) — **todas `aplica_categoria_id='c3'`**; `grupo ∈ {simples, premium, frutas_premium, chocolates}`. Os `simples` são `tipo='gratis'` com `preco=2.00`.
- `products.grupos_ad`: **só c3** tem (`{simples,premium,frutas_premium,chocolates}`); **c9 (Batidinhas) tem `{}`** (vazio → sem adicionais); demais categorias têm `null` → caem no `CAT_ADDON_GROUP`.
- **Modelo dual:** c3 real usa grupo `'simples'`; o MOCK/offline (`pmc*`, sem `grupos_ad`) cai em `CAT_ADDON_GROUP['c3']=['acai']`. Em produção, **apenas c3 usa a tabela real**; todas as outras categorias usam `MOCK_ADS` mesmo online (hardcode em `getFonteAdicionais`).

## 2. Decisão

`addons.js` é um **módulo de domínio puro**, irmão de `pricing.js`, com o contrato abaixo congelado no
header do arquivo e validado por execução (golden em Node).

### Contrato (9 pontos)

1. **Puro/determinístico** — recebe dados, devolve dados; sem efeito colateral, estado ou ambiente.
2. **Dependências proibidas** — React, hooks, JSX, componentes, Context, Router, `window`, `document`,
   `localStorage`, `sessionStorage`, Supabase, DataService, estado global, DOM, qualquer API visual.
3. **Data-in → data-out** — não sabe quem chamou, de onde vieram os dados, nem quem consome. A escolha
   da **fonte** (tabela vs MOCK) acontece **fora** do módulo.
4. **Imutabilidade** — nunca muta o input; `sort` sempre sobre cópia (`[...].sort()`); sempre devolve
   novos arrays/objetos.
5. **Sem saída visual** — devolve só dados (ad objects, **chaves** de grupo cruas, números). Nunca
   JSX/HTML/emoji/rótulo/badge/chip/ícone/CSS. `GRUPO_LABEL` (emoji + `isCombo`) e copy/i18n vivem na UI.
6. **Executável fora do React** — roda em Node puro (`tests/addons.golden.mjs`), sem navegador/DOM/Supabase/mocks.
7. **Reuso total** — mesmo módulo serve ProductModal, Carrinho, Checkout, Admin, Monte, Batidinhas,
   futuras Collections, Recommendation/Event Engine, scripts Node, workers, API e app mobile, sem alteração.
8. **Camadas sem ciclos** — `addons.js` é folha: não importa `pricing.js` nem nada do app. Integra com
   pricing **por dados** (`addons` resolve `ad.preco`; `pricing.somaAdicionais` o soma). Todos dependem
   de `addons.js`; ele de ninguém.
9. **Justificativa** — ver §4.

### Decisões específicas (travadas com o usuário)

- **D1 — Seam de fonte externalizado.** Os resolvers (`resolverAdicionais`, `agruparPorGrupo`) recebem a
  fonte **já resolvida** (data-in puro, ponto 3). A escolha `c3→tabela / resto→MOCK_ADS` fica isolada em
  `selecionarFonteAdicionais(prod, dbAds, mockAds)`, marcada **SEAM NORM-05**. Isso unifica a assimetria
  estrutural (hoje `getAdicionaisProd` resolve a fonte por dentro e `getAdsByGrupo` não) **sem mudar
  comportamento**, e destrava o NORM-05 (fonte única) de graça.
- **D2 — Nomenclatura de domínio.** `resolverAdicionais`, `agruparPorGrupo`, `selecionarFonteAdicionais`,
  `cotaGratis`, `ehAdicionalGratis`, `resolverPrecoAdicionais`, `gruposDoProduto`.
- **D3 — Fronteira de preço em addons.** `resolverPrecoAdicionais` + `ADICIONAL_SIMPLES_PRECO` pertencem a
  `addons` (regra de elegibilidade/franquia grátis, não de soma). `pricing.somaAdicionais` permanece cego
  à origem. **Saída de addons sempre Number finito** — nunca delega NaN para pricing (pin cruzado em teste).
- **D4 — Taxonomia crua em addons; rótulo na UI.** `addons` exporta `GRUPOS` (`Object.freeze`); `GRUPO_LABEL`
  (emoji) permanece em `App.jsx`/UI, mapeando sobre as chaves que `agruparPorGrupo` devolve.

## 3. Dívidas explícitas (registradas, não escondidas)

- **SEAM NORM-05** — `selecionarFonteAdicionais` hardcoda `c3`. NORM-05 unifica a fonte (migra `MOCK_ADS`→tabela, remove o hardcode).
- **Modelo dual** — `CAT_ADDON_GROUP['c3']=['acai']` está desalinhado dos dados reais de c3 (`simples/...`).
  É bug de **dados**, não de arquitetura. Congelado em teste de regressão (caso P6), não reconciliado dentro de `addons.js`.
- **Defaults herdados** — `grupo||'acai'` e `ordem??0`. Comportamento congelado no golden; `'acai'`-default é dívida, não invariante.
- **Whitelist textual marmita** — `MARMITA_PERMITIDOS` casa por substring no nome (frágil a rename). Futuro: flag `ad.aplica_marmita`.

## 4. Justificativa

O contrato evita: acoplamento com React, acoplamento com Supabase, dependências circulares, dificuldade
de testes, dificuldade de reuso, necessidade de carregar React em scripts Node, necessidade de reescrever
regras para API e para app mobile, e o crescimento de **um segundo `App.jsx`** cheio de dependências cruzadas.

Esta decisão não melhora só o NORM-04. Ela prepara diretamente:
- **NORM-05** (fonte única de adicionais) — o seam já está isolado num único ponto.
- **NORM-06** (Collections) — o resolver puro é reusável pela engine de coleções.
- **Modularização completa do `App.jsx`** — extrair domínio antes de quebrar o componente.
- **API e app mobile futuros** — mesmas regras, sem React, executáveis em qualquer runtime JS.

## 5. Estratégia de testes (`tests/addons.golden.mjs`, Node puro)

- **Snapshot por caso** — 11 casos discriminantes (P1 c3-real flat+agrupado, P2 c1→MOCK, P3 c9 `[]`,
  P5 c5 marmita filtra Queijo/Bacon, P6 c3 sem `grupos_ad`→`acai` [trava o bug dual], P7 prod=null,
  P8 ad sem grupo, ehGratis, resolverPrecoAdicionais mix, cotaGratis por tamanho).
- **Propriedades** — pureza (`structuredClone`+`deepStrictEqual` no input), idempotência (2 chamadas = mesma lista/ordem), subconjunto (saída ⊆ fonte).
- **Freeze de taxonomia** — todo `a.grupo` dos dados reais ∈ `GRUPOS`.
- **Guard de imports** — regex na fonte do módulo: sem `react`/`./components`/`format.js`/`supabase`/DataService; sem emoji nem `'Adicionais'`.
- **Pin cruzado addons×pricing** — `somaAdicionais(resolverPrecoAdicionais(sel, cota, ehGratis))` sempre Number finito.

## 6. Benchmark

**Incluído** (NORM-04). `scripts/bench/addons.bench.mjs` (`npm run bench:addons`) mede
`resolverAdicionais`/`agruparPorGrupo`/`resolverPrecoAdicionais` por N=100k com warmup + sink anti-DCE,
sobre fonte realista (~15 reais + 20 mock). Baseline permanente para flagrar regressão de complexidade
silenciosa. Não otimiza — apenas congela referência (espelha `pricing.bench.mjs`).

## 6.1 Endurecimentos congelados (NORM-04 hardening)

- **API pública congelada.** Toda função exportada é API pública do domínio. Sem migração explícita:
  não renomear, não mudar assinatura/tipo de retorno, não trocar Array↔Object↔Map↔Set, não mudar a
  ORDEM dos itens retornados, não mudar semântica. Consumidores: ProductModal, Carrinho, Checkout, Monte,
  Batidinhas, Collections, Admin, API futura, app mobile, scripts Node, workers.
- **Contrato de retorno previsível** (consumidor nunca precisa de `if(resultado)`): `resolverAdicionais`/
  `selecionarFonteAdicionais`/`resolverPrecoAdicionais` → Array (mesmo vazio `[]`); `agruparPorGrupo` →
  Object; `gruposDoProduto` → Array; `cotaGratis` → Number; `ehAdicionalGratis`/`marmitaPermitido` → boolean.
  `resolverPrecoAdicionais` devolve `preco` sempre Number **finito**.
- **Complexidade congelada.** Não adicionar novos loops aninhados sem benchmark + revisão arquitetural
  (evitar `filter→map→filter→reduce→sort→O(n²)`).
- **Imutabilidade reforçada.** O golden usa `deepFreeze` nas fixtures **antes** da chamada: qualquer
  `push`/`splice`/`sort`/atribuição no input lança na hora — impede a mutação, não só a detecta.
- **Guard de domínios.** Teste mecânico (regex nas linhas de import) falha se `addons.js` importar
  `pricing.js`/`react`/`format.js`/`supabase`/`DataService`. Integração addons×pricing **só por dados**.
- **Regra institucional.** Assim como `pricing.js` é o domínio financeiro, `addons.js` é oficialmente o
  domínio de adicionais. Alteração exige `test:addons` + `test:pricing` + `build` + revisão manual +
  commit dedicado. Nunca alterar junto com CSS/layout/componentes React/mudanças visuais/refactors de UI.
- **Política de snapshots.** Todo bug de produção corrigido no domínio gera **obrigatoriamente** um novo
  snapshot em `tests/addons.golden.mjs`. A suíte cresce com o sistema.
- **Guard de exportações (NORM-04.1).** O golden congela a API pública: `Object.keys(módulo).sort()` deve
  bater com a lista esperada. Adicionar, remover ou renomear export **falha o teste** — obriga revisão explícita.
- **Benchmark reproduzível (NORM-04.1).** `bench:addons` imprime Node/plataforma/arquitetura/dataset/iterações/
  warmup/data, para que a baseline seja comparável entre máquinas e ao longo do tempo.

## 6.2 Política de evolução da suíte Golden

A suíte Golden do domínio é **cumulativa** e os snapshots representam **comportamento congelado**:

- **Nunca** remover snapshots antigos só porque um bug foi corrigido — eles documentam o comportamento que deve permanecer válido.
- Toda regressão descoberta gera um **novo** snapshot (não a edição de um existente).
- Snapshots existentes só mudam mediante mudança de comportamento **intencional e revisada** (com justificativa no commit/ADR).
- Fluxo oficial:

```
Bug encontrado
      ↓
Novo snapshot (reproduz o bug)
      ↓
Correção
      ↓
Snapshot permanece permanentemente (vira regressão guard)
```

Mesmo conceito de suítes de compiladores, bancos de dados e runtimes: a malha de testes só cresce.

## 7. Alternativas rejeitadas

- **Mover os 3 resolvers verbatim** (com `c3` hardcoded dentro de `getAdicionaisProd`) — menor churn, mas
  mantém a assimetria e viola o ponto 3. Rejeitada em favor de D1.
- **`resolverPrecoAdicionais` em `pricing.js`** — produz preço, mas a regra é de adicional (franquia), não
  de soma; colocá-la em pricing acoplaria os dois domínios. Rejeitada em favor de D3.
- **`id` como desempate no `sort`** — melhoraria estabilidade, mas **mudaria comportamento**. Fora do NORM-04;
  registrada como melhoria futura candidata.

## 8. Consequências

- (+) Domínio de adicionais testável, reusável e sem React; seam de fonte isolado para o NORM-05.
- (+) Grafo de dependências acíclico (`addons` e `pricing` folhas irmãs).
- (−) Churn nos call sites do `App.jsx` (renomeação + composição da fonte) — mitigado por golden + build verde.
- (−) `MOCK_ADS` e o literal `c3` ainda vivem no código (dívida explícita até NORM-05).
