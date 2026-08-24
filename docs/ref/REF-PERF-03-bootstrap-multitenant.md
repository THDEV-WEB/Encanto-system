# REF-PERF-03 — bootstrap multi-tenant do storefront (tenant → catálogo)

Fecha a pendência registrada no addendum de 2026-08-24 em
[REF-PERF-02-auditoria.md](REF-PERF-02-auditoria.md#addendum-2026-08-24--regressão-de-clsperformance-encontrada-na-ref-ci-hardening-01)
(REF-CI-HARDENING-01): regressão intermitente de CLS/performance no job Lighthouse do CI, ligada ao
bootstrap do `StorefrontProvider`. Objetivo explícito desta REF: eliminar a causa raiz do carregamento
redundante do catálogo, não apenas recuperar o badge verde — o badge já tinha voltado a verde (run
`32765615876`) antes desta REF começar, por variância, não por correção.

## Causa raiz

O storefront buscava o catálogo (categorias/produtos/adicionais) **antes** de saber qual tenant
mostrar, e corrigia depois com uma segunda busca completa — sem nenhuma proteção de layout na
segunda troca.

## Cadeia causal (arquitetura anterior)

```
App.jsx monta: <StorefrontProvider><AuthProvider><StoreApp/></AuthProvider></StorefrontProvider>

T0 — StorefrontProvider dispara (async, não bloqueia o render):
  db.rpc('get_store_by_domain', {p_hostname})

T0 (em paralelo) — StoreAppContent já monta os 3 hooks do catálogo, que buscam IMEDIATAMENTE,
  sem esperar a resolução do tenant:
  useCategories()  → DS.getCats()   [FETCH 1: categorias SEM store_id]
  useProducts()    → DS.getProds()  [FETCH 2: produtos SEM store_id]
  useAdicionais()  → DS.getAds()    [FETCH 3: adicionais SEM store_id]

T1 — get_store_by_domain resolve com sucesso:
  setResolvedStore(linha); DS._invalidateProductsCache(); emitStorefrontResolved()

T1 (síncrono, 3 assinantes disparam juntos):
  useProducts.js (module-level): _prodCache.clear()
  useCategories: load()            [FETCH 4: categorias COM store_id]
  useProducts: setResolvedTick+1 → dispara useEffect → [FETCH 5: produtos COM store_id]
  useAdicionais: load()            [FETCH 6: adicionais COM store_id]
```

**Até 6 requests de catálogo + 1 RPC = 7 round-trips por carregamento**, quando 4 bastariam se o
tenant já estivesse resolvido antes do 1º fetch.

### Achado 1 (já documentado) — timing de rede move o CLS

`lighthouserc.cjs` já registrava a causa dominante com números reais (5 rodadas locais, catálogo
single-tenant estável): CLS 0,108 (rodada boa) a 0,556 (rodada com fetch lento) — o timing de quando
o `CatalogSkeleton` é substituído pela grade real, por si só, já move a métrica. Mitigação parcial já
existente (REF-PERF-02): skeleton dimensionado para aproximar 8 categorias reais medidas.

### Achado 2 (novo nesta auditoria) — segunda troca sem NENHUMA proteção de layout

Ao contrário da 1ª busca (passa por `loading=true` → `CatalogSkeleton`), a 2ª busca (disparada por
`onStorefrontResolved`) **nunca** setava `loading=true` de novo — confirmado lendo o `useProducts.js`
anterior: no branch de cache-miss que roda logo após `_prodCache.clear()`, `setLoading(true)` nunca
era chamado. O array antigo continuava em tela até a nova resposta chegar e **substituir
silenciosamente**, sem placeholder nenhum.

### Achado 3 (novo, evidência real do banco) — por que é intermitente em CI e não em produção

Consulta somente-leitura ao projeto Supabase E2E dedicado (2026-08-24):

| Loja | status | domínio | categorias ativas | produtos disponíveis |
|---|---|---|---|---|
| encanto | ativo | `encanto.valionsistemas.com.br` | 8 | 8 |
| bar-da-sogra-e2e | **ativo** | null | 0 | 0 |
| loja-inativa-e2e | suspenso | null | — | — |

`bar-da-sogra-e2e` está ativo mas vazio hoje — não contamina o catálogo neste momento. Mas
`.github/workflows/ci.yml` **não tem `needs:` entre os jobs** (`lint`/`build`/`domain-tests`/`e2e`/
`lighthouse` rodam em paralelo). O job `lighthouse` builda e mede contra o **mesmo projeto E2E
compartilhado** que o job `e2e` está escrevendo/limpando ao mesmo tempo, em runners separados.
`localhost` (hostname real do preview do Lighthouse) não bate com nenhum `stores.dominio`, então
`get_store_by_domain` cai no `default_store_id()` via `COALESCE` — em CI, o "wave A sem filtro" fica
sujeito à RLS pública (`store_ativo(store_id)`, união de qualquer loja ativa), enquanto specs como
`platform-console.spec.js`/`admin-empresa-identidade-visual.spec.js` provisionam lojas novas e ativas
dinamicamente durante o job `e2e`. Se o timing dos dois jobs coincidir, o wave A do Lighthouse pode
legitimamente ver um catálogo diferente do wave B — explicando picos de CLS que não existem em
produção (só a Encanto tem domínio real hoje) nem seriam reproduzíveis num teste local isolado.

### Achado 4 (correção de segurança, efeito colateral positivo) — exposição cross-tenant na falha

O código antigo, ao falhar (`!db`, erro da RPC, ou exceção), simplesmente retornava sem fazer nada —
o comentário original ("mantém o fallback... DEFAULT no servidor") estava **desatualizado**: como
`getResolvedStoreId()` ficava `null`, o filtro `.eq('store_id', ...)` nunca era aplicado, e a RLS
pós-REF-SAAS-01 · Onda 6.1 permite **qualquer loja ativa** (não só a padrão). Ou seja: em qualquer
falha da RPC, o storefront mostrava o catálogo **misturado de todas as lojas ativas da plataforma**.
Esta REF fecha essa janela (ver "Decisão sobre timeout/fallback" abaixo).

## Arquitetura nova (tenant → catálogo)

```
App.jsx monta (casca/layout imediatos, sem bloqueio):
  <StorefrontProvider><AuthProvider><StoreApp/></AuthProvider></StorefrontProvider>

T0 — StorefrontProvider dispara: Promise.race([
       db.rpc('get_store_by_domain', {p_hostname}),
       timeout(RPC_TIMEOUT)   // 12000ms, constante já existente em lib/supabase.js
     ])

T0 (em paralelo) — os 3 hooks do catálogo MONTAM mas NÃO buscam ainda — assinam
  storefrontResolvedBus e esperam.

T1 — resolução se encerra (settled), em QUALQUER um dos 4 desfechos possíveis:
  sucesso        → emitStorefrontResolved(true)
  !db (offline)  → emitStorefrontResolved(false)
  erro/linha vazia → emitStorefrontResolved(false)
  timeout (RPC_TIMEOUT) → emitStorefrontResolved(false)

T1 (síncrono, 3 assinantes disparam exatamente 1x cada, para sempre nesta sessão):
  ok=true  → useCategories/useProducts/useAdicionais buscam FILTRADO [FETCH 2, 3, 4]
  ok=false → caem direto no MOCK local (nunca fazem fetch ao vivo sem filtro)
```

**4 round-trips no melhor e no pior caso determinístico** (1 RPC + 3 fetches, sempre 1x), nunca 7.
Nenhuma troca silenciosa: o único fetch de cada domínio já nasce corretamente filtrado (ou vira mock),
sempre coberto pelo `loading=true`/`CatalogSkeleton` já existente.

## Por que o 1º fetch sem tenant foi eliminado (não só o refetch depois dele)

A REF-PROD-GOLIVE-01 já tinha percebido o problema e reagido a ele (refetch + invalidação de cache
quando a loja resolve) — mas isso trata o **sintoma** (dado errado em cache), não a **causa**
(existir, em primeiro lugar, uma janela em que o app não sabe qual tenant mostrar e busca mesmo
assim). Eliminando o fetch pré-resolução, a janela deixa de existir: não há mais dado "possivelmente
errado" para invalidar depois, nem uma segunda troca de conteúdo em tela.

## Decisão sobre timeout/fallback

Documentada e resolvida **antes** da implementação, por exigência explícita do dono do produto
("prefiro um bootstrap corretamente determinístico a um timeout artificial").

1. **Comportamento antigo na falha**: retornava mudo, sem emitir nenhum sinal — o comentário
   original assumia que "sem filtro" ainda era seguro, premissa que ficou desatualizada desde que a
   RLS pública passou a permitir qualquer loja ativa (REF-SAAS-01 · Onda 6.1). Achado 4 acima.
2. **`default_store_id()`**: função SQL interna, usada só dentro do `COALESCE` do próprio
   `get_store_by_domain` — não existe RPC pública equivalente. A única forma seura de saber "qual
   loja" é essa RPC ter sucesso; não há atalho client-side.
3. **Comportamento correto por caso**: sucesso → filtra e busca 1x (determinístico, seguro). Erro,
   linha vazia (nunca deveria acontecer pelo contrato da função, mas tratado defensivamente) ou
   timeout → **nunca** fetch ao vivo sem filtro; cai no MOCK local (mesmo fallback que `DS.getCats()`
   já usa hoje quando `db` está totalmente offline — não é um comportamento novo inventado, é a
   extensão de um padrão já existente para um caso que antes não passava por ele).
4. **Fallback é seguro?** Sim — nenhum código novo faz uma consulta multi-tenant sem filtro em
   qualquer cenário. A única alternativa a "cair no mock" seria "buscar sem filtro e deixar a RLS
   decidir", que é exatamente o comportamento inseguro que esta REF elimina.
5. **O timeout é necessário?** Sim, mas não é um valor novo/arbitrário desta REF: reaproveita
   `RPC_TIMEOUT` (`lib/supabase.js`, 12000ms, configurável via `VITE_RPC_TIMEOUT`), já usado com o
   mesmo padrão `Promise.race` em `DataService.savePedido`, `addressRepository.js` e
   `gazetteerCorrector.js`. Sem esse timeout, uma RPC que nunca resolve (rede degradada) deixaria os
   hooks esperando para sempre — pior para o cliente do que cair no catálogo mock depois de 12s.
   Retry automático foi considerado e descartado: não é um padrão usado em nenhum outro ponto do
   projeto para RPCs, e adicionaria complexidade fora do escopo desta REF.

## Alternativas descartadas

- **A. Manter 2 waves, só adicionar `loading=true` na 2ª busca**: reduz o risco de shift visível mas
  mantém o desperdício de rede (sempre o dobro de requests) e não ataca a causa raiz. Descartada como
  solução principal.
- **B. Bloquear o render inteiro no `get_store_by_domain`**: mais simples, mas reintroduz o custo de
  boot que a REF-PERF-01 investiu tempo real em eliminar. Rejeitada.
- **C. Combinar `get_store_by_domain` + catálogo numa única RPC nova**: teoricamente ótimo (1 round
  trip em vez de 2), mas exige contrato de backend novo — fora do gate autorizado desta REF ("não
  alterar migrations/RLS/RPCs sem novo gate"). Descartada por ora, fica registrada como opção futura.

## Arquivos alterados

- `src/providers/StorefrontProvider.jsx` — `Promise.race` com `RPC_TIMEOUT`; emite
  `emitStorefrontResolved(true|false)` nos 4 desfechos possíveis (antes só emitia no sucesso).
- `src/services/storefrontResolvedBus.js` — sinal passou a carregar um booleano (settled/succeeded);
  novos getters `hasStorefrontSettled()`/`storefrontResolutionSucceeded()` para hooks que montam
  depois do sinal já ter disparado (evento é 1x por sessão).
- `src/hooks/useCategories.js`, `src/hooks/useProducts.js`, `src/hooks/useAdicionais.js` — pararam de
  buscar no mount; passaram a esperar o sinal de resolução (settled) antes do 1º fetch. Em falha, caem
  direto no mock local em vez de tentar um fetch ao vivo sem filtro. `useProducts.js` perdeu o
  `resolvedTick`/2º wave e o `_prodCache.clear()` disparado por resolução (ficou sem propósito: nunca
  mais há dado pré-resolução no cache para purgar).

Nenhuma migration, RLS ou RPC nova — só reordenação do fetch no frontend, conforme autorizado.

## Métricas antes/depois

**Nº de requests de catálogo por carga** (medido diretamente via Playwright contando requests reais
contra o projeto Supabase E2E — `vite build --mode e2e` + `vite preview`, mesmo domínio de cada
código):

| | antigo (baseline) | novo (REF-PERF-03) |
|---|---|---|
| `get_store_by_domain` | 1 | 1 |
| `categories` | 2 | 1 |
| `products` | 2 | 1 |
| `adicionais` | 2 | 1 |
| **total** | **7** | **4** |

Sequência antiga observada: `categories, products, adicionais, get_store_by_domain, categories,
adicionais, products` (3 domínios buscados 2x cada, a 2ª leva já com a resolução em andamento/pronta).
Sequência nova observada: `get_store_by_domain, categories, products, adicionais` — exatamente a ordem
tenant → catálogo pretendida, 1x cada, sem exceção.

**Lighthouse**: a execução múltipla local (`@lhci/cli`, `numberOfRuns:3`) esbarrou num bug conhecido
do `chrome-launcher` neste ambiente Windows — trava na limpeza do diretório temporário do Chrome
(`EPERM` no `rmSync`) **depois** de todas as auditorias já terem terminado (`Generating results...`),
reproduzido de forma idêntica 2x, independente do código sendo medido — não é um problema desta REF
nem do código alterado. A medição comparativa de Lighthouse fica para o CI real (Ubuntu), que já roda
`@lhci/cli` de forma confiável desde a REF-CI-02/REF-PERF-02 — ver resultado do push abaixo.

## Impacto no multi-tenancy

- Resolução por domínio preservada integralmente (`get_store_by_domain`, `store.status !== 'ativo'` →
  tela de loja indisponível, tudo em `StoreApp.jsx`, não tocado).
- RLS não alterada.
- Nenhuma RPC nova.
- Isolamento tenant a tenant **reforçado**, não enfraquecido: a única mudança de comportamento em
  produção é que uma falha de resolução agora cai em mock local em vez de arriscar um catálogo
  misturado (Achado 4) — estritamente mais seguro que o comportamento anterior.
- Cache do Admin (`adminStore.js`) e testes que fazem mock de `get_store_by_domain` via
  `page.route` (ex.: `minha-conta-multi-loja.spec.js`) não foram tocados — só o storefront consome
  `storefrontResolvedBus` (confirmado por grep antes da implementação).

## Validação final

- `npm run lint`: 0 erros, 53 warnings pré-existentes (mesmo número de antes da REF).
- `npm run typecheck`: limpo.
- `npm run test:domain`: passou.
- `npm run build`: passou.
- `npm run test:e2e` (suíte completa, projeto Supabase E2E dedicado): **124/125 passou**. A única
  falha (`logout.spec.js:39` — limpeza de cache de visitante) foi confirmada **pré-existente e não
  relacionada**: reproduzida de forma idêntica no baseline (código stashed, sem nenhuma mudança desta
  REF), via `git stash`. Fora do escopo desta REF, não corrigida aqui.
- Contagem de requests de catálogo: medida diretamente (ver tabela acima), 7→4 confirmado.
- Lighthouse: confirmado no CI real (commit `f8c2416`, run `32771180052`, 2 execuções completas —
  attempt 1 e um re-run via API do mesmo commit, 3 sub-runs cada = **6 pontos de dado**). Ver seção
  abaixo — resultado é honesto, não totalmente positivo.

## Lighthouse no CI real — 2 execuções, 6 sub-runs (resultado completo, sem seleção)

| Execução | Sub-run | Performance | CLS | LCP | Ordem/contagem de requests de catálogo |
|---|---|---|---|---|---|
| 1 (attempt 1) | 1 | 0.67 | 0,004 | 3101ms | `get_store_by_domain` → categories/products/adicionais, 1x cada |
| 1 (attempt 1) | 2 | 0.86 | 0,003 | 3955ms | idem |
| 1 (attempt 1) | 3 | 0.69 | **0,479** | 3498ms | idem |
| 2 (re-run) | 1 | 0.60 | **0,527** | 3650ms | idem |
| 2 (re-run) | 2 | 0.65 | **0,526** | 3826ms | idem |
| 2 (re-run) | 3 | 0.87 | 0,051 | 3821ms | idem |

**O que ficou confirmado (o que esta REF se propôs a corrigir):**
- Em **nenhum** dos 6 sub-runs houve request de catálogo sem `store_id` — o wave sem filtro foi
  eliminado de fato, confirmado nos dados reais de rede do próprio CI, não só localmente.
- Em **nenhum** dos 6 sub-runs houve fetch duplicado de categoria/produto/adicional — sempre 1x cada,
  sempre depois do `get_store_by_domain` resolver, exatamente a ordem tenant → catálogo pretendida.
- Os 2 jobs (`e2e` e `lighthouse`) do CI passaram nas 2 execuções (5/5 jobs verdes cada vez).

**O que NÃO ficou resolvido — leitura honesta, não superestimada:**
- O CLS continua com variância forte: 3 dos 6 sub-runs ficaram acima de 0,47 (pior que o limite
  "bom" de 0,1 do próprio Lighthouse), praticamente no mesmo patamar do pior caso já documentado antes
  desta REF (0,477–0,556). A mediana/"representative run" escolhida pelo LHCI em cada execução (0,86 e
  0,87) ficou acima do threshold de performance (0,80), então o job continuou verde — mas isso é a
  MESMA razão pela qual o badge já tinha voltado a verde antes desta REF começar (variância favorável
  no agregado de 3, não ausência do problema).
- O timing das requests de catálogo NÃO explica a variância: nos 2 sub-runs de CLS mais alto da
  execução 2, o `get_store_by_domain` resolveu tão rápido quanto no sub-run de CLS mais baixo (155ms e
  157ms respectivamente) — ou seja, a causa do salto de layout não está no mecanismo que esta REF
  mexeu. É consistente com o Achado 1 (já documentado antes desta REF, explicitamente fora do escopo
  aprovado): o `layout-shifts` audit do Lighthouse (atribuição de causa raiz) errou de forma
  consistente nos 6 sub-runs (`Cannot read properties of undefined (reading 'frame_sequence')` — bug
  conhecido do trace engine desta versão do Lighthouse, não algo desta REF), então não foi possível
  confirmar o elemento exato responsável nesta rodada.

**Conclusão honesta**: esta REF eliminou de forma verificável (dado real de rede, não suposição) a
causa arquitetural que se propôs a eliminar — o wave duplicado, a troca silenciosa sem `loading`, e a
janela de exposição cross-tenant na falha. **Isso não é a mesma coisa que "resolver a intermitência do
CLS"** — o CLS elevado persiste, em magnitude parecida à de antes, e por uma causa ainda não
confirmada (provavelmente o Achado 1, timing de rede do único fetch restante, ou ruído do próprio
runner do GitHub Actions — nenhuma das duas hipóteses foi tocada ou deveria ter sido tocada pelo
escopo autorizado aqui). Fica registrado como pendência para uma REF futura de performance
(sugestão: REF-PERF-04), assim como a Lighthouse/CLS original ficou registrada ao final da
REF-CI-HARDENING-01.
