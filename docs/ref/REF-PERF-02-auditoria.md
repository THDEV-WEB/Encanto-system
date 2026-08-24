# REF-PERF-02 — Lighthouse 90+

Puxada do roadmap paralelo ([[encanto-roadmap-paralelo-saas01]]), última frente do Grupo 1 — depois
de REF-DASHBOARD-01, REF-OBS-02, REF-SEC-02, REF-DEVEX-01 e REF-CI-02 (essa última puxada pelo dono
em outra sessão, em paralelo a esta). Autorizada com um pedido explícito de cuidado: as duas frentes
tocam área adjacente (performance/CI), e a REF-CI-02 estava em execução concorrente no mesmo
diretório de trabalho.

## Coordenação com a REF-CI-02 (execução concorrente)

Confirmado via `git status`/`git log` antes de qualquer edição: a outra sessão estava editando
`.github/workflows/ci.yml` e criando `package.json`/`lighthouserc.cjs` ao vivo. Diff conferido —
100% aditivo (job `lighthouse` novo no fim do arquivo, sem tocar no job `lint` da REF-DEVEX-01).
Para não colidir, esta REF evitou tocar em `ci.yml`/`package.json` enquanto a outra sessão estava
ativa; o trabalho de performance em si (código/CSS/assets) não depende desses arquivos. A REF-CI-02
fechou (commit `ba723ed`) antes do fim desta execução — só então o `lighthouserc.cjs` foi completado
(ver seção "Thresholds no CI" abaixo), já que o próprio arquivo deixado por ela dizia explicitamente
que os thresholds bloqueantes ficavam para esta REF decidir.

## Metodologia

Mesma da REF-PERF-01: build de produção servido via `vite preview`, Lighthouse mobile
(`--form-factor=mobile --throttling-method=simulate`), Edge/Chromium headless. Diferença importante
descoberta nesta REF: medir contra um build **sem** credenciais de Supabase (`npm run build` puro)
deixa o catálogo em estado degradado/vazio e produz números artificiais e ruidosos — mesmo achado já
registrado pela REF-CI-02 no `lighthouserc.cjs` ("27/100 vazio vs. score normal com catálogo real").
Todas as medições reais desta REF usaram `vite build --mode e2e` (credenciais do projeto Supabase
E2E dedicado, catálogo real seedado, nunca produção).

**Baseline real** (pós-fix de catálogo vazio, antes de qualquer mudança de código): Performance
**73/100**, CLS **0,393** (score 0,26 — de longe o maior peso negativo; FCP/LCP/TBT/SI já estavam
entre 0,83-0,93).

## Achado 1 — ícone do rodapé sem tamanho explícito

`ValionCredit.jsx` (assinatura "desenvolvido pela Valion" no rodapé) usa
`.valion-v-icon{height:1.55em;width:auto}` — o navegador não tem como saber a largura antes de
baixar a imagem, reserva 0px e dá um salto quando ela chega. Sozinho, o "cause" do Lighthouse
apontava este elemento como responsável por ~99% do CLS medido no 1º baseline (posteriormente
descoberto como uma atribuição imprecisa da própria ferramenta — ver Achado 2). Corrigido com
`aspect-ratio:200/166` (proporção real do `valion-mark.webp`, medida via `sharp`) — reserva a largura
certa a partir da altura em `em`, sem mudar nada visualmente. `src/index.css`.

## Achado 2 — troca Spinner → catálogo real (o verdadeiro dominante)

Corrigir o Achado 1 não fez o CLS cair a zero — caiu para o mesmo patamar de antes (~0,30), só que
agora sem "causa" nenhuma atribuída pelo Lighthouse (a atribuição ao ícone era um falso-positivo da
heurística da própria ferramenta, que aponta o elemento visível mais próximo de qualquer mídia sem
tamanho na página, não necessariamente o real causador). Investigação manual encontrou o real
culpado: `StoreApp.jsx` renderiza `{loading ? <Spinner/> : cats.map(...)}` — um `<Spinner/>` genérico
de ~180px (`.loading-state{padding:60px}` + ícone 32px) é substituído pela grade completa de
categorias/produtos assim que os dados chegam, um salto de várias centenas de pixels que empurra
tudo abaixo (inclusive o rodapé) — o mesmo padrão "conteúdo async sem placeholder do tamanho certo"
clássico de CLS.

**Fix**: novo componente `src/components/ui/CatalogSkeleton.jsx` — 2 seções falsas reaproveitando as
MESMAS classes CSS da grade real (`.products-section`/`.promo-banner`/`.products-grid`/
`.product-card`/`.product-img`/`.product-info`), com blocos cinza em shimmer (`@keyframes skel-pulse`,
respeitando `prefers-reduced-motion`) no lugar de texto/imagem real. Herda automaticamente colunas
responsivas e alturas aproximadas sem duplicar nenhum breakpoint. 2 seções (não 1) porque o projeto
E2E tem 8 categorias cadastradas — 1 seção só deixava a reserva de espaço curta demais. Troca feita
só no ponto exato do catálogo (`StoreApp.jsx` linha ~434); os outros 2 usos de `<Spinner/>` no mesmo
arquivo (fallback do `Suspense` de Checkout/SuccessPage, troca de TELA inteira, não conteúdo
in-place) foram deixados como estavam — não é o mesmo problema.

## Resultado medido

5 rodadas Lighthouse mobile consecutivas (mesmo build, mesmo servidor local) após os 2 fixes:

| Rodada | Score | CLS |
|---|---|---|
| 1 | 92 | 0,108 |
| 2 | 72 | 0,369 |
| 3 | 71 | 0,556 |
| 4 | 94 | 0,108 |
| 5 | 94 | 0,001 |
| **Mediana** | **92** | **0,108** |

A variação real (71-94) não é bug de código — é jitter de rede genuíno contra o projeto Supabase E2E
(uma API remota de verdade na internet, não mockada): quando o fetch demora mais, o salto
skeleton→conteúdo real acontece mais tarde e por vezes se fragmenta em mais de um evento de shift
(confirmado inspecionando `layout-shifts` da rodada mais ruidosa: 2 shifts genéricos de ~0,27+0,18 em
vez de 1 só). Isso é esperado de uma medição local contra uma API remota; em produção (Vercel + mesma
região do Supabase) a variância tende a ser menor. **Meta de 90+ atingida na mediana** (37→68 na
REF-PERF-01, 68→92 nesta REF).

Oportunidade remanescente, não perseguida: `unused-javascript` (~78 KiB no bundle principal). Não é
uma métrica pontuada da categoria Performance (é diagnóstico/oportunidade, não conta pra nota) —
perseguir isso agora não move o score e arriscaria mexer no code-splitting já validado da
REF-PERF-01 por zero ganho de nota. Registrado aqui como nota, não como pendência.

## Thresholds no CI (`lighthouserc.cjs`)

Arquivo criado pela REF-CI-02 com `numberOfRuns:1` e sem `assert`, deixando explícito que threshold
bloqueante ficava para esta REF decidir. Completado com os dados acima:
- `numberOfRuns: 1 → 3` — LHCI agrega pela MEDIANA quando > 1, reduzindo bastante a chance de um
  outlier de rede reprovar o CI sozinho (a mesma variância 71-94 medida localmente se aplica ao
  runner do GitHub, que também busca dados reais do projeto E2E pela internet).
- `assert.assertions['categories:performance']`: `minScore: 0.8` — confortavelmente abaixo da
  mediana medida (0,92), acima do pior caso isolado observado (0,71), pensado pra pegar regressão
  real sem tornar o CI instável por variação de rede que não é bug de código.
- Sem assert em accessibility/best-practices/seo — fora do escopo desta REF (só performance foi
  auditada/otimizada aqui).

**Limitação de validação local**: `npm run lighthouse` (o script da REF-CI-02, via `@lhci/cli`) roda
até completar a auditoria completa (confirmado nos logs — dezenas de linhas `Auditing: ...`
executadas, config aceita e usada), mas trava depois, ao tentar derrubar o processo do Chrome/Edge,
com `EPERM` no cleanup do diretório temporário — reproduzido com Edge E com o Chromium do Playwright,
portanto não é specific a um binário. É um bug conhecido do `chrome-launcher` no Windows (falha
intermitente de permissão ao apagar o profile temporário, comum com antivírus/indexação de arquivos
ativos), não relacionado à correção da minha config — o healthcheck e o parsing do `lighthouserc.cjs`
passaram, e o comando chegou a rodar a auditoria completa antes de travar na limpeza. Não deve se
repetir no runner `ubuntu-latest` do GitHub Actions (Linux não tem esse comportamento do
`chrome-launcher`), mas fica registrado como uma verificação que não pude confirmar 100%
localmente — vale conferir o primeiro run real do job `lighthouse` no CI após o próximo push.

## Testes

`npm run lint` (0 erros) + `npm run typecheck` (0 erros) + `npm run test:domain` (suíte completa,
exit 0) + `npm run build` (produção, normal) todos verdes após as mudanças de código. Validação de
performance em si feita via 10+ rodadas Lighthouse standalone (fora do CI, ver seções acima).

## Why

Dono autorizou como última frente do Grupo 1 do roadmap, pedindo cuidado explícito com a REF-CI-02
concorrente. Meta "Lighthouse 90+" já estava definida desde a auditoria original do roadmap
(2026-08-08), como continuação natural da REF-PERF-01 (37→68).

## How to apply

Se o catálogo real de produção tiver uma distribuição de categorias muito diferente da fixture E2E
(muito mais ou muito menos produtos visíveis por padrão), o `CatalogSkeleton` pode precisar de
recalibração (nº de seções/cards) — o objetivo nunca foi ser pixel-perfect pra cada tenant, só
reduzir a MAGNITUDE do salto o suficiente pra manter CLS na faixa "boa" (<0,1) ou "razoável" (<0,25)
na maioria dos casos reais. Se o CI acusar o `EPERM` do `chrome-launcher` também no runner Linux
(improvável, mas não custa checar no primeiro push), a correção é trocar `chromeFlags` pra incluir
`--disable-dev-shm-usage` (mitigação comum em containers) — não tentar reproduzir/debugar isso no
Windows local, é perda de tempo dado que já é um bug documentado do próprio `chrome-launcher`.

## Addendum (2026-08-24) — regressão de CLS/performance encontrada na REF-CI-HARDENING-01

🟡 **PENDÊNCIA — REF FUTURA DE PERFORMANCE** (sugestão de título: REF-PERF-03 — otimização do
bootstrap multi-tenant / CLS). Não corrigida aqui — só diagnosticada e registrada.

### Achado

Job `Lighthouse CI` do pipeline ficou vermelho de forma sustentada entre 2026-08-17 e 2026-08-24
(run `32740291005`, commit `a30eea3`): performance **0,65 / 0,66 / 0,69** (mediana 0,69) contra
threshold `minScore 0,8`, com **CLS 0,477** nos 3 runs — bem acima da faixa "boa" (<0,1) que esta
própria REF-PERF-02 tinha estabelecido (baseline final: CLS 0,108, performance mediana 92/100).

### Causa observada

Rede capturada pelo próprio relatório Lighthouse (`network-requests` audit) mostra o catálogo do
storefront sendo buscado em **três ondas** no boot:

1. `categories`/`products`/`adicionais` **sem** `store_id` (~416ms) — dispara em paralelo a
   `get_store_by_domain`;
2. a MESMA leva de queries sem `store_id`, duplicada (~529ms) — indício de um efeito/hook rodando
   2x;
3. só depois de `get_store_by_domain` resolver (~757-766ms), a leva final **com**
   `store_id=eq.be2efc10-...` (~767-916ms) — o catálogo troca de conteúdo nesse ponto.

Essa troca de conteúdo em pleno carregamento é consistente com o CLS medido. Confirmado via
`docs/ARCHITECTURE.md`/`REF-SAAS-01-onda6-1` que o mecanismo é `StorefrontProvider` resolvendo a
loja por domínio (`get_store_by_domain`) e atualizando o singleton de `storefrontStore.js`
(`buildStorefrontRpcParam`/`buildStorefrontColumn`) de forma assíncrona, sem gate de renderização
até a resolução terminar — decisão original documentada como deliberada (não bloquear o 1º render,
ver `services/storefrontStore.js` cabeçalho) mas cujo efeito colateral em CLS não tinha sido medido
até agora.

**Achado adicional (revalidação em 2026-08-24, run `32765615876`, mesmo código, sem nenhuma
alteração de storefront/tenant):** o problema é **intermitente**, não constante. Os 3 runs dessa
execução saíram performance 0,58 / 0,89 / 0,91 (mediana 0,89, passou no threshold) com **CLS 0,052**
nos 3 — ou seja, o mesmíssimo código, sem nenhuma mudança, produziu CLS bom desta vez. Isso indica
uma condição de corrida sensível a timing (provavelmente latência do runner do GitHub Actions
naquele instante), não uma regressão determinística a cada boot — o que explica por que o CI ora
falha ora passa no job Lighthouse sem nenhum código relacionado ter mudado entre os dois runs.

### Contexto arquitetural

A regressão apareceu depois da evolução da resolução multi-tenant por domínio (REF-SAAS-01 Onda
6.1, `get_store_by_domain`) — a auditoria original desta REF-PERF-02 (CLS 0,108) foi validada ANTES
dessa mudança entrar no storefront. Relação observada, não afirmada como única causa: pode haver
fator adicional de latência de rede/CI contribuindo para a variância.

### Decisão arquitetural registrada

- A regressão de CLS/performance **não será corrigida como parte da REF-CI-HARDENING-01**.
- O problema será tratado posteriormente numa REF própria de performance/arquitetura.
- **Não** será reduzido o threshold do Lighthouse, desabilitada a auditoria, nem introduzido
  workaround só para recuperar o status verde do CI.
- A futura correção deve preservar a resolução correta de tenant e eliminar/reduzir o carregamento
  duplicado sem comprometer o isolamento multi-tenant. Alternativas de design a avaliar (nenhuma
  escolhida agora): gate de renderização até `store_id` resolver; evitar o 1º fetch sem tenant;
  reorganizar a sequência de bootstrap; outra estratégia equivalente.

### Evidência

- Run vermelho: `32740291005` (commit `a30eea3`, 2026-08-24T14:41), 3/3 CLS 0,477, mediana perf 0,69.
- Run verde/intermitente: `32765615876` (commit `d5c5f3e`, 2026-08-24T19:00), 3/3 CLS 0,052, mediana
  perf 0,89 — código de storefront/tenant idêntico entre os dois runs.
- Baseline anterior (esta própria REF-PERF-02): CLS 0,108, mediana perf 92/100.
- Componentes envolvidos, identificados com segurança: `src/providers/StorefrontProvider.jsx`,
  `src/services/storefrontStore.js`, hooks de catálogo (`useCategories`/`useProducts`/`useAdicionais`).
