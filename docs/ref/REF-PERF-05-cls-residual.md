# REF-PERF-05 — investigação e correção completa do CLS residual

Continua a [REF-PERF-04](REF-PERF-04-cls-residual.md), que corrigiu 3 mecanismos de CLS mas deixou um
resíduo binário (CLS 0,5010 ou 0,0736, nunca intermediário) não explicado. Esta REF foi autorizada em
duas etapas: primeiro auditoria pura (sem código), depois — com achados confirmados por evidência
direta — autorização para corrigir tudo que fosse comprovadamente produto.

## Causa raiz original (para contexto — não repetida em detalhe, ver REF-PERF-02/03/04)

O bootstrap do storefront buscava catálogo antes de resolver o tenant (REF-PERF-03), tinha 3
mecanismos de CLS não relacionados a isso (fonte bloqueante, logo sem espaço reservado, skeleton
subdimensionado — REF-PERF-04). Depois dessas correções, um resíduo de CLS binário permaneceu.

## Mecanismos confirmados nesta REF (3 no total, todos corrigidos)

### 1. `.header-logo`/`.status-actions` — altura variável entre "loja aberta" e "loja fechada"

**Achado da auditoria (Fase 1 da REF-PERF-05)**: `.status-actions` (pill de status + botão "Agendar
Pedido", quando fechado) não tinha altura reservada. Medido com Playwright forçando cada estado:
fechado (botão presente) = **65,375px** em mobile (≤480px, texto "detalhe" quebra linha) / 52,1875px
em telas largas; aberto (sem botão) = 21,1875px / menor nas telas largas. Confirmado via
`PerformanceObserver` como causa real e sempre-presente de ~0,0245 de CLS.

**Causa raiz do PORQUÊ isso acontece de verdade, não só em teoria**: `get_store_mode` real da Encanto
(projeto Supabase E2E, mesmo dado usado pelo Lighthouse do CI) está **forçado em `"OPEN"`**. O
cronograma real de segunda-feira só abre **10h-15h**. Os 6 sub-runs de Lighthouse já medidos na
REF-PERF-04 aconteceram todos numa **segunda-feira às 18:02-18:09** (horário de Brasília) — fora da
janela. `lerModoCache()` (cache local, vazio num navegador novo do Lighthouse) sempre chuta `AUTO`
antes da RPC resolver; com `AUTO`, o cronograma manda, e às 18h de segunda ele diz "fechado" — mostra
o botão. Quando `get_store_mode` confirma `OPEN` (forçado), o botão some. **Esse flip acontece em
100% dos 6 sub-runs já medidos**, não é probabilístico — o que varia é só a magnitude com que o
Lighthouse o registra.

**Correção**: `src/index.css` — `min-height` em `.status-actions` (66px ≤480px / 53px acima),
reservando a altura do estado "fechado" (o mais alto) sempre, com ou sem o botão.

**Validação**: `getBoundingClientRect()` de `.status-actions`/`.header-logo` idêntico
(y/top/bottom/height) nos dois estados, antes e depois — 0 diferença. `PerformanceObserver` confirma
0 entradas relacionadas a esses elementos depois do fix (era 0,0245 antes).

### 2. `LazySection.jsx` — placeholder de 240px sempre pintado antes do conteúdo real

**Achado**: `LazySection` (usado por CADA seção de categoria do catálogo) inicia com `visible=false`
(placeholder `minHeight:240px`) e só decide se deve mostrar o conteúdo real dentro de um `useEffect` —
que o navegador só executa **depois** do primeiro paint. Para qualquer seção perto do topo (a maioria,
dado o `rootMargin`/threshold generoso de `+400px`), isso garantia SEMPRE uma 2ª renderização (o
placeholder de 240px é pintado 1x, e só depois trocado pelo conteúdo real, que mede 250-700+px por
categoria) — mesmo sem nenhuma lentidão de rede.

**Correção**: trocar `React.useEffect` por `React.useLayoutEffect` — que roda **sincronamente antes**
do navegador pintar. Para seções já dentro do threshold, o placeholder nunca chega a ser pintado; o
conteúdo real já sai no 1º paint. Seções genuinamente abaixo da dobra continuam com o comportamento
assíncrono de sempre (IntersectionObserver, disparado por scroll do usuário).

**Validação**: `PerformanceObserver` — CLS do bloco de catálogo caiu de ~0,0922 (5/5 execuções antes)
para 0 entradas relacionadas (5/5 execuções depois).

### 3. `StoreApp.jsx` — gate de loading do catálogo não esperava `categories` E `products` juntos

**Achado (o mecanismo do CLS ~0,50, confirmado por reprodução direta)**: `useCategories()` e
`useProducts()` são 2 fetches **independentes** (decisão deliberada da REF-PERF-03 — cada hook espera
a resolução do tenant e busca por conta própria, sem fetch combinado). O gate de renderização
(`loading ? <CatalogSkeleton/> : cats.map(...)`) usava só o `loading` de `useProducts` — **nunca
esperava `categories` também**. Como as 2 requisições vão para o mesmo host com latência parecida, a
ORDEM em que terminam não é garantida; quando `products` termina antes de `categories`, existe uma
janela real em que `loading=false` mas `cats` ainda está vazio — `cats.map(...)` produz **zero
seções**, colapsando o catálogo inteiro por completo, até `cats` chegar um instante depois e as seções
reaparecerem. **2 saltos de layout reais**, medidos via `PerformanceObserver`: elemento afetado era
tudo que vem depois do catálogo (ex.: o rodapé `ValionCredit`, que saltava de invisível para
`{y:231, w:390, h:151,7}` e de volta para invisível em ~20-300ms) — até **0,3608 de CLS sozinho**,
batendo com o valor "ruim" (~0,50 combinado com os outros mecanismos) medido no CI desde a REF-PERF-04.

**Reproduzido 4 de 8 vezes localmente sem nenhum atraso artificial** (race genuína, mais frequente sem
throttling de CPU/rede — condizente com uma corrida de timing entre 2 requisições HTTP simultâneas
para o mesmo host, não com "rede lenta" per se).

**Correção**: `src/pages/StoreApp.jsx` — `const loading = catLoading || prodLoading;` combinando os 2
estados de loading antes de decidir trocar o skeleton pela grade real. Sem fetch novo, sem tocar a
ordem tenant→catálogo da REF-PERF-03 — só adia a troca até as DUAS fontes existirem juntas.

**Validação**: 10/10 execuções locais sem o blip (antes: 4/8, ~50%). Teste de estresse forçando
`categories` a resolver **1500ms depois** de `products` (pior caso muito além do observado em CI): 3/3
execuções limpas, CLS ≤0,0009.

## Lighthouse no CI real — resultado final (3 execuções, 9 sub-runs, commit `25492d5`)

| Sub-run | CLS | Performance |
|---|---|---|
| 1-1 | 0,0015 | 0,84 |
| 1-2 | 0,0010 | 0,92 |
| 1-3 | 0,0010 | 0,93 |
| 2-1 | 0,0015 | 0,91 |
| 2-2 | 0,0010 | 0,95 |
| 2-3 | 0,0015 | 0,95 |
| 3-1 | 0,0015 | 0,73 |
| 3-2 | 0,0015 | 0,92 |
| 3-3 | 0,0010 | 0,94 |

**CLS — melhor caso**: 0,0010. **Pior caso**: 0,0015. **Mediana**: 0,0015. **Variação total**: 0,0005
(9/9 sub-runs dentro de uma faixa de meio milésimo). **Runs com CLS > 0,1**: 0. **Runs > 0,2**: 0.
**Runs > 0,5**: 0.

**Comparativo direto com a REF-PERF-04** (mesma metodologia, mesmo CI, mesmo `numberOfRuns:3`):

| | REF-PERF-04 (6 sub-runs) | REF-PERF-05 (9 sub-runs) |
|---|---|---|
| Melhor caso | 0,003 | 0,0010 |
| Pior caso | 0,527 | 0,0015 |
| Mediana | ~0,074 | 0,0015 |
| Runs > 0,1 | 3 de 6 | 0 de 9 |
| Runs > 0,5 | 2 de 6 | 0 de 9 |

Performance geral também melhorou (mediana 0,92, contra 0,69 na REF-PERF-04) — efeito colateral
esperado: menos reflow = menos trabalho de layout/paint medido pelo próprio Lighthouse.

**Isto sim pode ser declarado como resolvido, com evidência**: os 3 mecanismos de produto identificados
e corrigidos nesta REF explicam, na prática, a totalidade da variância binária (0,50/0,07) registrada
desde a REF-PERF-04 — não sobrou nenhum sub-run acima de 0,1 nas 3 execuções reais de CI.

## Hipóteses testadas e descartadas nesta REF

- **Atraso isolado numa única RPC como gatilho suficiente**: testado (300ms e 2000ms em
  `get_store_mode`, isoladamente) — não reproduziu o salto grande sozinho.
- **CPU/rede throttling isolado (CDP, 4x + rede degradada) como gatilho suficiente**: testado —
  também não reproduziu sozinho. Curiosamente, o blip do mecanismo 3 aconteceu MAIS quando NÃO
  throttled (consistente com corrida de timing entre requisições rápidas e paralelas, não com rede
  lenta).
- **Imagens de produto sem dimensão reservada**: descartada — `.product-img` já usa
  `padding-top:72%` (aspect-ratio fixo), confirmado por CSS e comentário já existente desde o
  REF-IMG-01; imagens carregam sem CLS por design.
- **Logo do header (REF-PERF-04)**: não revisitado — mecanismo já corrigido, sem regressão encontrada.

## Limitação de ferramenta (não resolvida, documentada)

O audit `layout-shifts` do Lighthouse (atribuição de causa raiz) continuou quebrado em todas as
tentativas desta REF (`Cannot read properties of undefined (reading 'frame_sequence')`, mesmo bug do
trace engine já registrado nas REFs anteriores). Todo o diagnóstico desta REF veio de
`PerformanceObserver` instrumentado manualmente (temporário, removido antes do commit final) e
reprodução controlada — não da atribuição automática do próprio Lighthouse.

## Arquivos alterados

- `src/index.css` — `min-height` em `.status-actions` (mecanismo 1).
- `src/components/ui/LazySection.jsx` — `useEffect` → `useLayoutEffect` (mecanismo 2).
- `src/pages/StoreApp.jsx` — `loading` combinado de `useCategories`+`useProducts` (mecanismo 3).

Nenhuma migration, RLS, RPC ou arquitetura multi-tenant tocada. Nenhum threshold do Lighthouse,
configuração de CI ou auditoria alterada.

## Testes locais e E2E

- `npm run lint`: 0 erros, 53 warnings pré-existentes.
- `npm run typecheck`: limpo.
- `npm run test:domain`: passou.
- `npm run build`: passou.
- `npm run test:e2e` (suíte completa, 125 specs): **124/125 passou**. A única falha
  (`logout.spec.js:39`, limpeza de cache de visitante) é a mesma já confirmada pré-existente e não
  relacionada nas REF-PERF-03 e REF-PERF-04 (mesmo erro, mesma linha, reproduz no baseline). **0
  regressões causadas pelas 3 correções desta REF** — catálogo, checkout guest/logado, header, horário
  aberto/fechado, botão Agendar Pedido, PWA, multi-loja: todos verdes.

## Encerramento

**REF-PERF-05 = ENCERRADA.** Condição (A) do critério de fechamento foi atingida: todas as causas de
produto identificadas com evidência direta foram corrigidas e validadas — 0 sub-runs de Lighthouse
acima de 0,1 em 9 execuções reais de CI, contra 5 de 6 nas duas REFs anteriores combinadas. Nenhuma
causa residual ficou classificada como "ambiente/runner" ou "indeterminada" nesta rodada — as 3 causas
encontradas explicaram, na prática, a totalidade da variância observada.

Commits: `25492d5` (implementação + doc inicial) + commit de fechamento com os resultados reais do
Lighthouse (ver hash abaixo no relatório final), ambos em `origin/main`.
