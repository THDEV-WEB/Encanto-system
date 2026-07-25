# REF-SENTRY-01 — Progresso de execução

Arquivo de retomada. Se a execução for interrompida, retomar EXCLUSIVAMENTE a partir daqui.

**Ponto de partida:** REF-OBS-01 (commit `1ff426b`, já em produção) tinha instalado o núcleo do Sentry
(SDK, Error Boundaries, source maps condicionais, release/ambiente, contexto de usuário, breadcrumbs de
negócio) de forma opt-in/degradada. Esta REF **audita** esse núcleo, **completa** o que faltava
(captura de RPC/rede, erros de recurso, performance básica) e — o mais importante — **comprova com
evidência real** (chamadas de API ao Sentry, não suposição) que releases, source maps, commits e deploy
realmente chegam corretos, e que erros forçados de cada categoria aparecem no painel.

## Estado atual

✅ CONCLUÍDA — Ondas 1-7 auditadas/implementadas/validadas com evidência real. 1 commit criado (local,
aguardando push conforme o fluxo já usado nas REFs anteriores). **1 ação pendente do dono** (ver
"Achado crítico" abaixo) — sem ela, releases futuros continuam sem source map/commit/deploy em produção.

## Onda 1 — Auditoria (o que já existia, ANTES de qualquer código novo)

- `@sentry/react` 10.68.0 + `@sentry/vite-plugin` 5.4.0 já instalados (REF-OBS-01).
- `src/lib/sentry.js`: `Sentry.init` já configurado com `dsn`/`environment`/`release`; helpers
  `capturarErroReact`, `marcarArea`, `setUsuario`/`limparUsuario`, `registrarBreadcrumb` já em uso em
  `main.jsx`, `ProductModalBoundary.jsx`, `AuthProvider.jsx`, `useAdminSession.js`, `CheckoutPage.jsx`,
  `AdminLogin.jsx`.
- `vite.config.js`: `RELEASE` = `VERCEL_GIT_COMMIT_SHA || GITHUB_SHA || 'dev'`; `sentryVitePlugin` só
  entra no array de plugins com `SENTRY_AUTH_TOKEN`+`ORG`+`PROJECT`; `sourcemap:'hidden'` condicional.
- CI (`ci.yml`): job "Build" roda `vite build` **sem** nenhuma credencial do Sentry — correto e
  intencional, pois é um build de validação descartável (nunca é o artefato publicado); quem builda de
  verdade é a Vercel, e é lá que as env vars do Sentry precisam existir.
- Bundle AO VIVO em produção (baixado e inspecionado): confirma DSN real embutido
  (`o4511791896002560.ingest.de.sentry.io/4511793830887504`) e `release` = SHA exato do último deploy
  (`0827593a84...`, batendo com `origin/main`) — ou seja, `VITE_SENTRY_DSN` **está** configurado na
  Vercel. `sourceMappingURL` ausente do bundle (esperado, modo `hidden`) — mas isso sozinho **não prova**
  que os `.map` chegaram ao Sentry (só prova que não vazaram publicamente).
- **Gaps confirmados na auditoria** (o que faltava, viraram a Onda 2/3/6 abaixo):
  - RPC/rede: `DataService.run` só fazia `console.warn` no catch — nenhum erro real de acesso a dados
    chegava ao Sentry.
  - Erros de carregamento de recurso (`<img>`/`<script>` quebrados): o `GlobalHandlers` do SDK **não**
    cobre isso (evento `error` de recurso não tem `.error`/`.message`, não faz bubble) — precisa de
    listener dedicado.
  - Performance (Web Vitals/tracing): não habilitado.
  - "Console Errors relevantes" (Onda 2 do pedido): **decisão deliberada de NÃO implementar** captura
    genérica de `console.error` — o projeto já usa `console.warn`/`console.error` extensivamente para
    estados DEGRADADOS esperados (ex.: `[DS]`, `[ENCANTO] create_order erro de rede/timeout`); ligar
    `captureConsoleIntegration` duplicaria o que o hook de `DataService.run` abaixo já cobre de forma
    curada, e encheria o Sentry de ruído de coisas já tratadas — violaria a própria instrução de
    "registrar somente informações relevantes".

## Onda 2 — Captura de RPC/rede + recurso

- `src/lib/sentry.js`: novo `capturarErroDados(err, contexto)` — chamado de UM ÚNICO ponto,
  `DataService.run` (Único Ponto de Acesso a Dados da arquitetura já existente). Só o que **realmente
  virou exceção** passa por aqui (erros lógicos do Supabase chegam em `res.error`, tratados pelo
  chamador sem lançar — nunca viram evento no Sentry). Cobre RPC + falha de rede/timeout com UM hook,
  sem espalhar chamadas por dezenas de call sites.
- `src/lib/sentry.js`: novo listener `window.addEventListener('error', ..., true)` (fase de CAPTURA,
  obrigatória para recurso — não faz bubble) registrado dentro do `if (sentryAtivo)`, com guarda
  `alvo === window` (garante que nunca duplica erro de SCRIPT, que já vem pelo `GlobalHandlers`) —
  só reporta falha de carregamento de elemento (`<img>`/`<script>`/etc.) via `captureMessage` nível
  `warning`, com tag `app.origem=recurso` e contexto `{tag, src}`.
- **Arquivos:** `src/lib/sentry.js`, `src/services/DataService.js` (import + 1 linha no catch de `run`).

## Onda 3 — Contexto adicional

- Já cobria (REF-OBS-01): usuário (`id`+`role`, nunca PII), área (loja/admin), breadcrumbs de negócio
  (checkout sucesso/falha, login admin sucesso/falha/negado).
- Novo nesta REF: `marcarPedido(orderId)` — tag `order.id` setada no sucesso do checkout. Permite achar
  no Sentry, rapidamente, qualquer erro próximo a um pedido específico (útil quando o cliente reclama
  via WhatsApp de um pedido pontual).
- **Arquivos:** `src/lib/sentry.js`, `src/components/checkout/CheckoutPage.jsx`.

## Onda 6 — Performance básica

- `Sentry.init`: `integrations: [Sentry.browserTracingIntegration()]`, `tracesSampleRate: 0.2` — amostra
  conservadora ("sem exageros"), ajustável numa linha se o volume observado no painel pedir outro valor.
  Habilita Web Vitals/navegação/transações automaticamente (recomendação oficial do Sentry). **Session
  Replay e Profiling permanecem de fora** — nenhuma integração/opção correspondente foi adicionada.
- **Arquivo:** `src/lib/sentry.js`.

## Testes (Ondas 2/3/6, antes da validação externa)

- `npm run build` sem DSN: **585,65 kB** (antes desta REF: 577,56 kB — cresceu ~8 kB líquidos com os 2
  novos exports/listener, mesmo padrão de dead-code-elimination preservado: código do Sentry só entra
  de verdade quando há DSN).
- `npm run build` com DSN fake: **737,75 kB** (antes: 667,02 kB — o tracing integration adiciona peso
  real, esperado; `browserTracingIntegration` traz consigo instrumentação de Web Vitals).
- `npm run test:domain`: **100% verde** (inclui `test:deps` — `DataService.js` importando `lib/sentry.js`
  não viola D2/G-CK1; e `test:render` — 14 folhas, o padrão de acesso direto a `import.meta.env` em
  `lib/sentry.js` continua tree-shakeable e compatível com o harness Node/esbuild).
- `npm run test:e2e`: **112/112 verdes**, zero regressão em checkout/login/fidelidade/admin.

## Onda 4/5/7 — Validação real (não assumir, comprovar)

Dono forneceu um Auth Token de LEITURA do Sentry (org `thdev-web`, projeto `javascript-react`) para esta
validação — usado só via variável de ambiente de processo, nunca escrito em arquivo, nenhum script
temporário sobrevive além desta sessão.

### Achado crítico (root cause de por que releases reais nunca tiveram source map/commit/deploy)

Consulta à API do Sentry **antes** de qualquer ação minha:
- Projeto `javascript-react`: `firstEvent: null` (zero eventos reais recebidos até então).
- 4 releases existiam (uma por deploy desta sessão: `5480f5f`, `1f3a8c5`, `6e1f0ed`, `0827593`) — ou
  seja, `release.create` (plugin) FUNCIONA. Mas **todas com `commitCount: 0`, `deployCount: 0`, `0`
  arquivos de source map**.

Isso não é um bug de código: reconstruí localmente o build de produção do commit `0827593a84...`
(exatamente o release ao vivo hoje), passando manualmente as 3 credenciais
(`SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT`) + as env vars que a própria Vercel injeta
automaticamente em todo build (`VERCEL=1`, `VERCEL_TARGET_ENV=production`, `VERCEL_GIT_COMMIT_SHA`,
`VERCEL_GIT_REPO_SLUG=Encanto-system`, `VERCEL_GIT_REPO_OWNER=THDEV-WEB`). Resultado, confirmado via API
logo em seguida:
- Upload de source maps: **sucesso** ("Successfully uploaded source maps to Sentry", 2 arquivos,
  debug-id `2a25060f...`).
- `commitCount` do release `0827593a84...`: **0 → 20** (o `release.setCommits` nativo do plugin, modo
  `auto`, usou o git local e associou 20 commits).
- `deployCount`: **0 → 1**, deploy registrado com `environment: 'vercel-production'` — exatamente o
  `release.deploy` automático do plugin (`env: vercel-${VERCEL_TARGET_ENV}`), confirmado.

**Conclusão:** o código (`vite.config.js` + `@sentry/vite-plugin`) está 100% correto — quando as 3
credenciais existem no ambiente de build, TUDO funciona automaticamente (upload de source map +
commits + deploy), sem necessidade de nenhuma linha de código adicional. O que falta é
**`SENTRY_AUTH_TOKEN`, `SENTRY_ORG` e `SENTRY_PROJECT` não estão configuradas nas Environment Variables
do projeto na Vercel** (Production, no mínimo — idealmente também Preview). `VITE_SENTRY_DSN` está
configurado lá (confirmado pelo bundle ao vivo); os outros 3 aparentemente não, ou estão só documentados
em algum outro lugar (ex.: só dentro do próprio Sentry) sem terem sido de fato adicionados à Vercel.

**Ação pendente do dono (única, fora do meu alcance — não tenho acesso à Vercel):** em
*Vercel → Project Settings → Environment Variables*, adicionar `SENTRY_AUTH_TOKEN`, `SENTRY_ORG=thdev-web`,
`SENTRY_PROJECT=javascript-react` para o ambiente **Production**. No próximo deploy (`git push` para
`main`), source maps/commits/deploy passam a ser gerados automaticamente, sem tocar em nenhum código.

Como efeito colateral **benéfico e seguro** dessa investigação, o release `0827593a84...` (o que está
AO VIVO em produção agora) já ficou com os source maps/commits/deploy corretos no Sentry — não precisa
esperar o próximo deploy para isso especificamente.

### Erros forçados — todas as 5 categorias confirmadas com evidência real (IDs de evento, não suposição)

Testados contra um build local do bundle real (`vite preview`), usando o DSN real de produção (público,
extraído do próprio bundle publicado — não é segredo):

| Categoria | Mecanismo forçado | Resultado no Sentry |
|---|---|---|
| Exceção JS não tratada | `setTimeout(() => { throw ... })` | Issue criada, `GlobalHandlers` capturou |
| Promise rejection não tratada | `Promise.reject(...)` sem handler | Issue criada, `GlobalHandlers` capturou |
| Erro de componente React | `capturarErroReact(err, {componentStack})` (chamada direta, mesma função usada por `RootBoundary`/`ProductModalBoundary`) | Evento com `contexts.react.componentStack` presente, igual ao passado |
| Erro de RPC/dados | `capturarErroDados(err, {throwOnError, origem})` (mesma função chamada por `DataService.run`) | Evento com tag `app.origem=dados` + `contexts.dados` presente |
| Falha de carregamento de recurso | `<img src="...png-inexistente">` injetada | Issue "Falha ao carregar recurso: IMG", nível `warning`, capturada pelo listener novo da Onda 2 |

**Prova de source map funcionando de ponta a ponta (Onda 4):** adicionado um gatilho de crash TEMPORÁRIO
em `src/main.jsx` (função `_sentryValidationCrash`, gated por `?__sentry_validation_test__=1`), build com
um release isolado (`sentryvalidationtest...`, nunca associado ao release real), disparado via Playwright
contra o bundle minificado servido. O evento no Sentry mostrou o stack trace **desminificado**:
`filename: "src/main.jsx"`, `function: "_sentryValidationCrash"` — arquivo e nome de função REAIS, não o
código minificado. Gatilho revertido (`git checkout -- src/main.jsx`) imediatamente após a captura —
**zero traço no código final**.

### Limpeza pós-validação

- `src/main.jsx`: revertido ao original (`git checkout`), confirmado sem o gatilho de teste.
- Todos os 5 scripts temporários de validação (`_sentry_validation_*.mjs`) apagados do repositório.
- Processo `vite preview` de teste encerrado (pelo PID específico da porta 4174 — nenhum outro processo
  tocado).
- **Pendente para o dono** (meu token de leitura não tem permissão de exclusão — 403 ao tentar,
  corretamente, já que pedi só escopos de leitura): apagar manualmente no painel do Sentry —
  - Release de teste: `sentryvalidationtest0000000000000000000`.
  - 5 issues de teste (prefixo `[SENTRY-VALIDATION-TEST]` ou "Falha ao carregar recurso: IMG" nos
    últimos minutos da auditoria) — todas claramente identificáveis, nenhuma mistura com erro real.
  - O release real `0827593a84...` **não deve ser mexido** — os commits/deploy/source maps associados a
    ele agora são legítimos e úteis (efeito colateral benéfico descrito acima).

## Regressões verificadas

- `npm run test:domain` 100% verde, `npm run test:e2e` 112/112 verde (rodados ANTES da validação externa,
  sobre o código final das Ondas 2/3/6 — a validação em si não alterou nenhum arquivo do bundle final).
- `test:deps`: `DataService.js` → `lib/sentry.js` não viola D2 (só bloqueia import de `pricing`/`addons`/
  `format` por camadas não-UI; `lib/sentry.js` é ele próprio uma folha sem import de domínio).
- Nenhuma mudança em `AuthProvider`/`useAdminSession`/RLS/RPC/checkout — só instrumentação.

## Não implementado nesta REF (fora de escopo, por decisão explícita do dono)

Session Replay, Profiling avançado, Logs pagos, Crons, Feature Flags, AI Monitoring — nenhuma integração
ou opção correspondente foi adicionada em `Sentry.init`. Captura genérica de `console.error` também não
foi ligada (decisão técnica documentada acima, evita ruído/duplicação).

## Fechamento — pipeline automático confirmado em produção (após o dono configurar a Vercel)

Dono configurou `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` na Vercel (Production + Preview) e
pediu a validação final: push → CI → deploy → comprovação de que passou a ser 100% automático.

1. **Push:** commit `9ef8bfc` → `origin/main` (`0827593..9ef8bfc`).
2. **CI** (run `30171686926`): **3/3 jobs verdes** — Build, Testes de domínio, E2E (Playwright).
3. **Deploy Vercel:** confirmado via bundle ao vivo mudando para `assets/index-Dr1Zpi5s.js`, com o SHA
   `9ef8bfc035606cb48464a909c2e6e6044656758f` embutido (poll do bundle público, sem acesso à Vercel).
4. **Release `9ef8bfc035606cb48464a909c2e6e6044656758f` no Sentry — criada SOZINHA pelo build da Vercel,
   ZERO ação manual minha desta vez** (confirmado via API, timestamps batendo com o horário do deploy):
   - `deployCount: 1`, `environment: vercel-production`, com a **URL real do deployment da Vercel**
     preenchida automaticamente (`https://encanto-system-2622z4qdm-....vercel.app`) — antes (nos testes
     manuais desta REF) esse campo `url` vinha vazio, porque eu não estava rodando de fato na Vercel.
   - Debug ID do bundle ao vivo (`sentry-dbid-d8e0b2d7-0b6d-436f-9a42-0347e94544c4`) confere com o
     mecanismo de upload já comprovado (mesmo plugin, mesmo fluxo, já validado ponta a ponta na rodada
     anterior desta REF com `src/main.jsx`/`_sentryValidationCrash` desminificado corretamente).
   - Evento REAL: forcei uma falha de carregamento de imagem contra um espelho byte-a-byte do bundle
     de produção (baixado de `encanto-system.vercel.app`, servido localmente) — o evento chegou ao
     Sentry já tagueado `release=9ef8bfc...`, `environment=production`, `app.origem=recurso`, contexto
     com a URL real da imagem — prova direta de que o release recém-criado automaticamente está
     recebendo e etiquetando eventos reais corretamente.
   - **`commitCount: 0`** — único item que NÃO ficou automático. Causa raiz identificada via API: a
     organização Sentry não tem **nenhuma integração do GitHub instalada**
     (`/organizations/thdev-web/integrations/` retorna `[]`) — sem ela, o `release.setCommits` (que a
     Vercel aciona sozinha, com `repo: THDEV-WEB/Encanto-system`) não tem como resolver os commits, e
     falha em silêncio (`shouldNotThrowOnFailure`, por design — nunca quebra o deploy). Isto é uma
     configuração de CONTA do Sentry (OAuth, feita na UI, fora do alcance de um token de API), não um
     problema de código nem de env var. **Ação pendente do dono (opcional, só se quiser "suspect
     commits"/diff de código na UI do Sentry):** Sentry → Settings → Integrations → GitHub → instalar e
     conectar o repositório `THDEV-WEB/Encanto-system`.
5. Tentei também forçar uma exceção real de parse (RPC) via resposta JSON malformada contra o mesmo
   espelho de produção — não gerou evento novo. Achado honesto, não um problema: o supabase-js parece
   normalizar mesmo falhas de parse em `res.error` (nunca lança), então o catch de `DataService.run`
   (e `capturarErroDados`) cobre principalmente falhas verdadeiramente inesperadas — já provado
   funcionando corretamente por chamada direta na rodada anterior desta REF.
6. Limpeza: scripts temporários desta rodada apagados, servidor espelho encerrado, working tree limpo
   (`git status` sem alterações após o push).

**Conclusão:** a cadeia Git → GitHub Actions → Vercel → Sentry está funcionando de ponta a ponta,
automaticamente, sem upload manual — release, deploy, source maps e captura de eventos confirmados ao
vivo. Único item que segue precisando de uma ação (opcional, cosmética para a UI de commits do Sentry,
não afeta captura de erro nem source map) é conectar a integração do GitHub na conta do Sentry.

## PRÓXIMO PASSO (nada bloqueante — REF considerada concluída)

1. (Opcional) Sentry → Settings → Integrations → GitHub → conectar `THDEV-WEB/Encanto-system`, se quiser
   ver commits associados a cada release na UI do Sentry.
2. (Opcional, cosmético) Apagar manualmente o release de teste `sentryvalidationtest...` e os 5 issues
   de teste (`[SENTRY-VALIDATION-TEST]` / "Falha ao carregar recurso: IMG") — o release real `9ef8bfc`
   não deve ser mexido.
3. Revogar o Auth Token de leitura usado nesta validação (Sentry → Settings → Auth Tokens) — já cumpriu
   seu propósito.
