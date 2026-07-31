# REF-CAP-01 — Aplicativo Android Nativo (Capacitor)

**Status:** 🚧 Em execução. Fase 1 (auditoria) apresentada e **aprovada pelo dono em 2026-07-30**. Onda 1
(Dual Build) implementada, testada e validada (este commit). Ondas 2–8 pendentes.
**Depende de:** [REF-MOBILE-01](REF-MOBILE-01-fundacao-mobile.md) (fundação PWA — manifest/ícones/Service
Worker; sua D9 já reservava a estratégia "Capacitor-Ready" que esta REF agora executa) e
[REF-BRAND-01](REF-BRAND-01-dominio-institucional.md) (`base:'/encanto/'`, sub-path institucional —
motivo direto do conflito resolvido na D1 abaixo).
**Relacionado:** NÃO substitui o navegador nem o PWA — adiciona uma **terceira** forma oficial de uso
(APK Android nativo). Não contempla publicação em loja (Play Store); reservado para REF futura.

## Objetivo

Gerar um aplicativo Android nativo via Capacitor, preservando 100% da arquitetura, regras de negócio,
Supabase, autenticação por e-mail, Sentry, CI existente e a estrutura de `StoreApp`. Ao final, o Encanto
passa a ter três formas de uso oficiais: 🌐 Navegador, 📲 PWA, 📦 APK Android.

## Motivação adicional

Testes reais da REF-MOBILE-01 mostraram que, em alguns aparelhos, a instalação do PWA pode disparar um
alerta do Google Play Protect ("aplicativo criado para versões antigas do Android"). Causa real: o
mecanismo do próprio navegador ao empacotar o PWA como WebAPK, não o projeto — mas um APK gerado
diretamente pelo Capacitor elimina essa dependência, porque `compileSdkVersion`/`targetSdkVersion`/Gradle
passam a ser configurados diretamente por nós (Onda 3), em vez de herdados da decisão do navegador.

## Auditoria (Fase 1 — aprovada pelo dono em 2026-07-30)

Levantamento completo do repositório (sem nenhuma mudança de código), cobrindo cada item pedido:

- **Arquitetura de navegação:** sem `react-router`; SPA 100% *state-driven* (`useAdminSession` →
  `mode:'store'|'login'|'admin'`), com uma única exceção de hash (`#admin-encanto`) para entrada no
  admin. Ideal para Capacitor — zero rota de servidor para preservar.
- **OAuth Google — risco crítico:** `AuthService.signInWithGoogle()` faz `signInWithOAuth` com redirect
  **dentro da própria WebView**. Google **bloqueia ativamente** login OAuth quando detecta User-Agent de
  WebView embutida (política desde 2021) — vai falhar tal como está hoje dentro do APK. Mitigação
  planejada para a Onda 4: abrir o OAuth no navegador do sistema (`@capacitor/browser`) + capturar o
  retorno via deep link (`App.addListener('appUrlOpen', …)`) + `dbCliente.auth.exchangeCodeForSession
  (code)` manual. `flowType:'pkce'` (já ativo em `dbCliente.js`) sustenta essa troca manual sem mudar o
  fluxo de e-mail OTP (`signInWithEmailOtp`/`verifyEmailOtp`, sem redirect, não afetado).
- **`base:'/encanto/'` vs. `webDir` do Capacitor — risco crítico, resolvido nesta onda:** o build web
  gera referências absolutas `/encanto/...` (necessário para o proxy institucional). O Capacitor serve o
  **conteúdo** de `webDir` na raiz local do WebView — as duas convenções colidiam (assets 404ariam dentro
  do APK). Ver D1.
- **Redirect do Supabase Auth:** vai precisar de nova entrada no allow-list de Redirect URLs (mesmo
  mecanismo já usado em REF-AUTH-01/REF-BRAND-01) — configuração do projeto, não código.
- **Botão físico "voltar":** sem tratamento, o Capacitor fecha o app por padrão (sem histórico de
  navegação, já que tudo aqui é *state*, não URL) — precisa de listener dedicado na Onda 4.
- **Toolchain Android:** confirmado — **não há Java, Android SDK, Gradle nem `adb`** nesta máquina.
  Recomendação: gerar o APK via GitHub Actions (`ubuntu-latest`, que já vem com Android SDK
  pré-instalado), workflow **novo**, sem alterar `.github/workflows/ci.yml` existente.
- **Geolocalização:** `navigator.geolocation` (busca de endereço, `useAddressSearch.js`) funciona na
  WebView, mas precisa de `ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION` declaradas no
  `AndroidManifest.xml` (Onda 4).
- **Upload:** `<input type="file">` (`ImageUploader.jsx`, admin) funciona nativamente na WebView do
  Capacitor, sem plugin adicional.
- **Impressão:** comanda térmica via iframe/`window.print()` (`printComanda.js`) — sem diálogo nativo
  garantido em WebView Android sem plugin dedicado; validação própria na Onda 4 (o APK inclui o admin).
- **Service Worker:** sem função útil dentro de um APK empacotado localmente (não existe "novo deploy via
  rede" nesse modelo) — desativado condicionalmente na D1, sem alterar o comportamento web/PWA.
- **Ícones/assets:** `public/icon-encanto.png` (680×680) suficiente para gerar todo o conjunto Android via
  `@capacitor/assets` (Onda 5).
- **iOS futuro:** exige Mac/Xcode — fora do alcance desta máquina; a camada Capacitor/JS é reutilizável,
  mas não desbloqueada por esta REF (Android-only).

## Decisões

### D1 — Dual Build: `mode` do Vite dentro de UM SÓ `vite.config.js`, nunca um arquivo paralelo

**Problema:** o build web (`base:'/encanto/'`, `outDir:'dist/encanto'`, Service Worker via
`vite-plugin-pwa`) é incompatível com o modelo de `webDir` do Capacitor por dois motivos independentes:

1. `base:'/encanto/'` faz o `index.html` referenciar assets em `/encanto/assets/...`. O Capacitor serve o
   **conteúdo** da pasta apontada por `webDir` na raiz do WebView local (`https://localhost/`) — um
   arquivo em `dist/encanto/assets/x.js` fica acessível em `https://localhost/assets/x.js`, não em
   `https://localhost/encanto/assets/x.js`. Sem correção, **todo JS/CSS 404aria dentro do APK**.
2. Um Service Worker Workbox pressupõe "nova versão = novo fetch de rede" — dentro de um APK empacotado
   localmente essa premissa não existe (nova versão = novo APK instalado). Gerar um `sw.js` dentro do
   `webDir` do Capacitor seria, na melhor hipótese, inerte; na pior, uma fonte de confusão de cache.

**Alternativas consideradas:**
- Um `vite.config.capacitor.js` totalmente separado — descartado: duplicaria plugins/lógica do Sentry/
  release e criaria risco real de as duas configs divergirem em silêncio ao longo do tempo (exatamente o
  tipo de duplicação que o dono pediu para evitar).
- Trocar `base` só via variável de ambiente lida em runtime — descartado: o Capacitor precisa do build já
  pronto com o `base` certo; não há "runtime" para decidir isso depois de gerado.

**Decisão:** um único `vite.config.js`, usando a função de configuração do Vite (`defineConfig(({mode}) =>
…)`) com um único gate: `mode === 'capacitor'` (invocado via `vite build --mode capacitor`, novo script
`npm run build:capacitor`). Fora desse modo explícito — todo o resto do projeto, sem exceção (`npm run
build`/`dev`/`preview`/E2E) — o resultado é **byte a byte idêntico** a antes desta REF (confirmado:
mesmos hashes `index-C4le4we3.css`/`index-CdahV6I0.js`). Dentro do modo `capacitor`:
- `base:'/'` e `outDir:'dist/capacitor'` (pasta irmã de `dist/encanto`, nunca sobrepõe).
- Service Worker desativado via `VitePWA({ disable: true, … })` — a MESMA chave que já desliga o plugin em
  dev (`devOptions.enabled:false` já era o padrão). Importante: o plugin continua **presente** no array de
  `plugins` (só desativado), porque `src/hooks/usePwaUpdate.js` faz `import('virtual:pwa-register')` — é
  o próprio `vite-plugin-pwa` quem fornece esse módulo virtual. Removê-lo do array por completo (tentativa
  inicial) quebra o build (`Rollup failed to resolve import "virtual:pwa-register"`). Com `disable:true` o
  módulo virtual continua resolvendo como stub *no-op* — o hook roda normalmente e nunca ativa nada, zero
  mudança de código em runtime.

**Validação:**
- `npm run build` (web): hashes de JS/CSS idênticos aos do build anterior a esta REF — zero regressão.
- `npm run build:capacitor`: `dist/capacitor/` gerado com `base:'/'`; nenhum `sw.js`/`workbox-*.js`
  gerado; `index.html` referenciando `/assets/...` (sem prefixo `/encanto/`).
- `npm run preview:capacitor` (novo script, `vite preview --mode capacitor`) servindo `dist/capacitor/`:
  confirmado via `curl` + inspeção de `Content-Type`/`Content-Length` que `/assets/index-*.js` e
  `/assets/index-*.css` respondem como arquivos reais (não fallback de SPA), e que o antigo caminho
  `/encanto/assets/...` e `/sw.js` **não existem de verdade** (a resposta 200 que aparentam é só o
  fallback de SPA do `vite preview` servindo `index.html` — em uma WebView real do Capacitor, sem esse
  middleware, seriam 404 verdadeiros).
- `npm run test:domain`: 309/309 asserções, sem regressão.

**Achado observado, deliberadamente adiado para a Onda 5:** os `<link rel="icon">`/`<link rel=
"manifest">`/`<link rel="apple-touch-icon">` em `index.html` têm o prefixo `/encanto/` **escrito à mão**
no texto-fonte (não gerado pelo mecanismo de `base` do Vite) — dentro do build Capacitor eles continuam
apontando para `/encanto/favicon-...`, que não existe na raiz servida. Na prática isso é inofensivo: um
WebView nativo sem chrome de navegador não exibe favicon nenhum, e o ícone real do app Android vem de
recursos nativos (`mipmap-*`, gerados por `@capacitor/assets` na Onda 5), não desses `<link>`. Registrado
aqui para transparência; não é um bloqueio da Onda 1.

### D2 — `appId` do Android: `br.com.valionsistemas.encanto`

**Decisão:** reverse-DNS **estrito** do domínio institucional que o dono realmente possui
(`valionsistemas.com.br` → `br.com.valionsistemas`), com o app como último segmento (`.encanto`) — mesmo
padrão recomendado pela própria documentação do Android para quem já tem um domínio próprio. Alternativas
mais comuns na prática (`com.valionsistemas.encanto`, ignorando o `.br`) foram descartadas por serem menos
formalmente corretas sem nenhum ganho real.

**Por que decidir agora, e não perguntar:** o `applicationId` é tecnicamente barato de trocar **nesta
fase** (nenhum APK publicado, nenhuma instalação real em campo) — mudar depois de publicado é que seria
caro (Play Store trataria como um app novo). Registrado aqui de forma explícita e reversível, não como
decisão de produto silenciosa.

### D3 — Onda 3 ("versões modernas") já vem satisfeita pelo template do Capacitor 8.x

A auditoria da Fase 1 previu uma Onda 3 dedicada a atualizar `compileSdkVersion`/`targetSdkVersion`/
AndroidX/Gradle manualmente. Na prática, `npx cap add android` do Capacitor **8.4.2** (a versão mais
recente, instalada nesta REF) já gera o projeto com:

- `compileSdkVersion`/`targetSdkVersion` = **36** (Android 16, a API mais recente) — resolve diretamente a
  motivação do Play Protect.
- `minSdkVersion` = **24** (Android 7.0) — piso razoável, cobre a esmagadora maioria dos aparelhos ativos.
- Android Gradle Plugin **8.13.0** + Gradle wrapper **8.14.3** (`android/gradle/wrapper/gradle-wrapper.
  properties`) — ambos atuais.
- `android.useAndroidX=true` (`android/gradle.properties`) + todas as libs AndroidX em versões recentes
  (`variables.gradle`).
- `sourceCompatibility`/`targetCompatibility` Java **21** (`capacitor.build.gradle`).

**Decisão:** não fazer nenhum bump manual de versão — usar os defaults do template tal como vieram, já que
são objetivamente as versões recomendadas atuais (evidência: geradas pela ferramenta oficial na hora,
não uma suposição). Onda 3 do plano original **fica sem trabalho adicional**; ver progress doc.

### D4 — `npx cap sync android` NÃO exige JDK/Android SDK (correção de uma suposição da auditoria)

A Fase 1 apontou a ausência de Java/Android SDK/Gradle nesta máquina como bloqueio para "Onda 2". Testado
na prática: `npx cap add android` + `npx cap sync android` rodaram **sem erro e sem nenhuma dependência de
JDK** — são só cópia de arquivos (web assets → `android/app/src/main/assets/public`) e geração de config
Gradle (`capacitor.settings.gradle`/`capacitor.build.gradle`), nunca uma invocação real do
`./gradlew`/compilador Java. **A ausência de toolchain só bloqueia a COMPILAÇÃO de verdade** (`./gradlew
assembleDebug`, abrir no Android Studio, ou `npx cap run android`) — ou seja, a Onda 6 (gerar o APK), não
a integração em si. Mantém-se a recomendação de usar CI (Onda 6) para a compilação real.

### D5 — Google OAuth nativo: Browser do sistema + Deep Link + troca PKCE manual

**Documentado ANTES de qualquer implementação, por pedido explícito do dono.** Cobre o ponto mais delicado
de toda a REF — o único que toca o fluxo de autenticação do cliente.

**Estado atual (web/PWA, permanece 100% intocado):** `AuthService.signInWithGoogle()`
(`src/services/AuthService.js:25`) chama `dbCliente.auth.signInWithOAuth({provider:'google', options:
{redirectTo}})`, que redireciona o próprio navegador para o Google e de volta. `dbCliente` (`lib/
dbCliente.js`) já usa `detectSessionInUrl:true` + `flowType:'pkce'` — a troca do `?code=` por sessão
acontece **sozinha**, lida pela biblioteca ao recarregar a página. Único ponto de chamada em todo o
projeto: `providers/AuthProvider.jsx:53` (`entrarComGoogle`).

**Problema:** dentro da WebView do Capacitor esse redirect é bloqueado pelo próprio Google (política
anti-WebView-embutida, ver Fase 1). Não é algo que se contorna com configuração — precisa de um transporte
diferente.

**Decisão — 3 peças novas, isoladas atrás de uma checagem de plataforma:**

1. **Detecção de plataforma:** `Capacitor.isNativePlatform()` (de `@capacitor/core`, já instalado) decide
   o ramo dentro do próprio `AuthService.signInWithGoogle()` — nenhuma outra camada (`AuthProvider`,
   `AuthContext`, `LoginScreen`) precisa saber que o Capacitor existe. No navegador/PWA, a função continua
   fazendo exatamente o que faz hoje.
2. **No Capacitor:** `signInWithOAuth({provider:'google', options:{redirectTo: DEEP_LINK_URL,
   skipBrowserRedirect:true}})` — `skipBrowserRedirect` é a opção oficial do supabase-js para os casos em
   que a própria lib NÃO deve tentar navegar (`window.location.href=url`); em vez disso devolve a URL de
   consentimento do Google em `data.url`. Essa URL é aberta com `@capacitor/browser`
   (`Browser.open({url: data.url})`) — o **navegador do sistema** (Custom Tabs no Android), não a WebView
   do app, o que evita o bloqueio do Google.
3. **Captura da volta:** `@capacitor/app` (`App.addListener('appUrlOpen', …)`), registrado ANTES de abrir
   o browser, escuta um esquema de URL customizado dedicado (proposto:
   `br.com.valionsistemas.encanto://login-callback` — mesmo prefixo do `appId`, D2). Ao disparar, extrai
   o `?code=` da URL recebida, fecha o browser (`Browser.close()`) e chama
   `dbCliente.auth.exchangeCodeForSession(code)` manualmente — método já suportado, porque `flowType:
   'pkce'` já está ativo. Esse método popula a MESMA sessão/`localStorage` que o fluxo automático do
   navegador populava antes — `onAuthStateChange`/`AuthContext`/`AuthProvider` a partir daqui não mudam
   nada.

**Impacto arquitetural:**
- 2 dependências novas: `@capacitor/browser`, `@capacitor/app` (plugins oficiais Capacitor, mesmo mantedor
  do `core`).
- `AndroidManifest.xml` (Onda 4): novo `intent-filter` no `MainActivity` para o esquema customizado —
  padrão documentado do próprio Capacitor para deep links, não uma Activity nova.
- Supabase Auth: nova entrada no allow-list de Redirect URLs para
  `br.com.valionsistemas.encanto://login-callback` — configuração do projeto (Management API/dashboard),
  mesmo mecanismo já usado em REF-AUTH-01/REF-BRAND-01; não é código.
- `signInWithEmailOtp`/`verifyEmailOtp` (sem redirect) — **inalterados**, não passam por nenhuma dessas 3
  peças.
- Sessão do Admin (`db`, `lib/supabase.js`) — **inalterada**, fluxo totalmente separado
  (`signInWithPassword`, sem OAuth).
- Cancelamento pelo usuário (fecha o browser sem concluir o login): `@capacitor/browser` expõe um evento
  `browserFinished` — usado para resolver a chamada com o mesmo formato de erro que a função já retorna
  hoje (`{data:null, error:{message:...}}`), sem exigir tratamento novo em `AuthProvider`.

**Alternativa considerada e descartada:** plugin de terceiros para login nativo do Google (ex.:
`@codetrix-studio/capacitor-google-auth`), que obtém o token direto do SDK do Google (sem abrir browser) e
chamaria `signInWithIdToken`. Rejeitada nesta REF por 2 motivos: (a) não é um plugin oficial do Capacitor —
mais superfície de manutenção/confiança; (b) exigiria um Client ID OAuth do tipo "Android" novo no Google
Cloud Console, com o fingerprint SHA-1 da chave de assinatura do APK cadastrado à parte — mais setup do
que reaproveitar o Client ID "Web" que o Supabase já usa hoje. A abordagem Browser+Deep Link+PKCE já era,
inclusive, a indicada no pedido original do dono para esta onda.

**Implementado** (confirmação do dono recebida): `src/services/AuthService.js` ganhou `signInWithGoogleNativo()`
(privada) + o branch `if (Capacitor.isNativePlatform())` dentro de `signInWithGoogle()`. `AndroidManifest.xml`
ganhou o `intent-filter` do esquema `br.com.valionsistemas.encanto://login-callback` no `MainActivity`
(mesma `<activity>`, `launchMode="singleTask"` já existente preservado). Build web com hash de bundle
diferente do anterior (esperado — `AuthService.js` é um arquivo real e compartilhado entre Web/Capacitor,
diferente da infra pura de build da Onda 1): `@capacitor/core`/`browser`/`app` somam **~10 KB gzip** ao
bundle web, mesmo nunca sendo usados ali (`Capacitor.isNativePlatform()` retorna `false` de imediato no
navegador). `test:domain` 309/309 — zero regressão. **Validação real do fluxo (abrir o Google, voltar via
deep link, trocar o código) só é possível num APK rodando em dispositivo físico — reservada para a Onda 6.**
Falta ainda, como passo do dono: a nova entrada no allow-list de Redirect URLs do Supabase Auth.

### D6 — Botão físico "voltar": resumo imperativo de estado, sem novo router

**Problema:** o app nunca usa History API (SPA 100% *state-driven*) — o comportamento *default* do
Capacitor pro botão voltar (`history.back()` se houver entrada, senão `App.exitApp()`) sempre cai no
segundo caso aqui, então **qualquer** modal/carrinho/painel admin aberto seria descartado e o app
fecharia, em vez de só fechar o que está por cima.

**Decisão:** um único listener central (`hooks/useCapacitorBackButton.js`, novo), registrado em `App.jsx`,
decide em ordem de prioridade: (1) `mode` `'admin'`/`'login'` → `verLoja()` (volta pra loja, não sai do
app); (2) dentro da loja, pergunta a um **resumo imperativo** do que está aberto — `StoreApp.jsx` ganhou
`forwardRef`/`useImperativeHandle` (`temAlgoAberto()`/`fecharTopo()`, cobrindo `page`
checkout/success, `modal` do produto, `cartOpen`, `showLoyalty`, na mesma ordem em que apareceriam por
cima) e `StoreMenu.jsx` idem (`temAlgoAberto()`/`fecharTudo()`, cobrindo o drawer e as 7 telas —
login/pedidos/conta/contato/sobre/termos/fidelidade); (3) nada aberto → `App.exitApp()` explícito (mesmo
efeito do default nativo). **Nenhum estado existente foi movido, renomeado ou lifted** — só um resumo
imperativo do que já existia foi exposto, a pedido de um único consumidor (o listener nativo). Fora do
Capacitor, o hook é no-op (`Capacitor.isNativePlatform()` nunca é `true` no navegador).

**Limitação conhecida, aceita conscientemente:** o painel Admin (`AdminPanel`) não expõe seu próprio
resumo imperativo — o botão voltar dentro do Admin sempre volta pra loja (`verLoja()`), sem fechar
primeiro um modal interno do Admin (ex.: um formulário de produto aberto). Ampliar essa cobertura ao Admin
é um refinamento de UX de baixo risco, não incluído aqui para não expandir o escopo desta onda além do que
foi pedido ("botão voltar" no contexto do app do cliente).

### D7 — Impressão nativa da comanda: plugin Capacitor LOCAL (Java) + `NativePrint`

**Problema, confirmado por pesquisa (não suposição):** uma `WebView` "crua" — a base de qualquer app
Capacitor — **não** liga `window.print()` a nenhum diálogo nativo de impressão. Isso é uma integração
própria do app Chrome (a API pública de `WebView` não expõe esse gancho); `printComanda.js` chama
`iframe.contentWindow.print()`, que funciona no navegador/PWA mas seria um no-op silencioso dentro do
Capacitor. A API oficial do Android pra imprimir conteúdo de `WebView` é
`WebView.createPrintDocumentAdapter()` + `PrintManager` — sempre disparada **nativamente**, nunca como
reação automática a `window.print()`.

**Decisão:** plugin Capacitor **local** (não é pacote npm — vive só dentro deste projeto Android),
`NativePrintPlugin.java`, registrado explicitamente em `MainActivity.java` (`registerPlugin(...)`, antes
de `super.onCreate()` — plugins locais não entram no scan automático que `@capacitor/app`/`@capacitor/
browser` recebem via `capacitor.plugins.json`). O plugin recebe o HTML já pronto (mesmo `html` que o
iframe recebia), carrega numa **`WebView` temporária e isolada** (nunca a `WebView` principal do app, que
mostraria o painel Admin inteiro, não a comanda) e, ao terminar de carregar (`onPageFinished`), aciona
`createPrintDocumentAdapter()`+`PrintManager` — o mesmo isolamento que o iframe oculto já garantia no
navegador, só que replicado nativamente. `src/lib/nativePrint.js` (novo) é a ponte JS
(`registerPlugin('NativePrint')` do `@capacitor/core`); `printComanda.js` ganhou um branch
`Capacitor.isNativePlatform()` no topo — o caminho do iframe/`window.print()` permanece **100% intocado**
para navegador/PWA.

**Risco assumido conscientemente e comunicado:** o código Java segue à risca a receita oficial documentada
pela própria Android (`developer.android.com/guide/topics/text/webview-printing`) e usa só APIs estáveis
(`PrintManager`, `WebView.createPrintDocumentAdapter`), mas **não pôde ser compilado nem executado nesta
máquina** (sem JDK/Android SDK, ver D4) — a mesma limitação de ambiente já aceita para toda a Onda 6.

**Atualização (Onda 6):** o risco de COMPILAÇÃO se confirmou infundado — o
[run 30582093288](https://github.com/THDEV-WEB/Encanto-system/actions/runs/30582093288) do
`android-apk.yml` compilou `NativePrintPlugin.java` sem nenhum erro na primeira tentativa (Gradle 8.14.3 +
AGP 8.13.0 + JDK 21, runner `ubuntu-latest`). Ainda pendente: a validação FUNCIONAL real (o diálogo
nativo de impressão do Android realmente aparece, com o conteúdo certo da comanda) — isso só é observável
instalando o APK num aparelho físico, fora do alcance deste ambiente.

### D8 — Assets nativos: `@capacitor/assets` (Easy Mode) a partir do ícone já existente

**Fonte:** `assets/logo.png` (novo, commitado como fonte-de-verdade pra regenerar no futuro) = cópia de
`public/icon-encanto.png` (680×680, mesmo símbolo isolado panela+açaí da REF-MOBILE-01 Onda 2/ajuste de
recorte). Conferido via `sharp` que o canal alfa é **constante 255** (sem transparência real, canto
superior-esquerdo `#A51B81`) — o ícone é uma arte 100% opaca, não uma logo com fundo transparente.

**Comando:** `npx capacitor-assets generate --android --iconBackgroundColor '#ffffff' --splashBackgroundColor
'#ffffff' --logoSplashScale 0.35` (light e dark mode com o mesmo branco — o app não tem uma identidade de
tema escuro definida em lugar nenhum, então não inventei uma aqui). `--android` explícito: gera só pra esse
platform (não existe `ios/` ainda, e não deve tocar o manifest PWA — o `--pwa` implícito é evitado assim).
`--logoSplashScale` (padrão da ferramenta é `0.2`) subido pra `0.35` depois de comparar visualmente as duas
opções — o padrão deixava o símbolo pequeno demais num canvas branco imenso; `0.35` dá presença de marca
sem dominar a tela.

**Validação visual, não só geração cega:** antes de finalizar, o ícone gerado (launcher, round, foreground,
splash) foi **lido e inspecionado como imagem** (não só checado que o arquivo existe) — o corte adaptativo
circular preserva o símbolo inteiro (mesmo recorte já validado na REF-MOBILE-01 pra sobreviver a máscaras),
e a composição do splash ficou limpa/profissional nas duas escalas testadas.

**Achado real, corrigido (bug pré-existente do template, não introduzido por esta onda):**
`android/app/src/main/res/values/colors.xml` **não existia** — `styles.xml` (gerado pelo próprio `cap add
android` na Onda 2) já referenciava `@color/colorPrimary`/`@color/colorPrimaryDark`/`@color/colorAccent`
sem NENHUM arquivo definindo essas 3 cores. Isso teria **quebrado o build Gradle** (`resource
color/colorPrimary not found`) assim que alguém tentasse compilar de verdade — só apareceria na Onda 6,
tarde demais pra debugar sem contexto. Corrigido criando `colors.xml`: `colorPrimary`/`colorAccent` =
`#6B1F5D` (mesmo `theme_color` do `manifest.json`/`index.html` — identidade única entre PWA e nativo);
`colorPrimaryDark` = `#531849` (variante ~22% mais escura, calculada — não existia um tom de roxo mais
escuro já estabelecido na marca pra reaproveitar; convenção Android usa esse tom na status bar).
Verificação adicional feita por precaução: toda referência `@color`/`@style`/`@drawable`/`@mipmap` em
`AndroidManifest.xml` + `res/` foi cruzada manualmente contra as definições existentes — nenhuma outra
lacuna encontrada.

**Nome do app:** já era `"Encanto"` desde a Onda 2 (`capacitor.config.json` → `appName` → `strings.xml`
`app_name`/`title_activity_main`) — nenhum trabalho adicional necessário aqui, só confirmado.

`npm audit`: `@capacitor/assets` soma 10 vulnerabilidades novas em devDependencies (`tar` via `sharp`,
`uuid` via `xcode` — nenhum dos dois entra no bundle web nem no APK, são só ferramentas de build/geração
de imagem). `npm audit --omit=dev` permanece **0** — mesmo padrão já aceito pra `vite-plugin-pwa`/
`@capacitor/cli`.

### D9 — Distribuição: rota real via `vercel.json` rewrite; APK publicado só após validação física

**Problema:** o pedido era uma URL real e compartilhável (`https://valionsistemas.com.br/encanto/download`),
não um hash como o acesso ao Admin (`#admin-encanto`) usa. Path real exige que o **servidor** (Vercel)
saiba servir o bundle React pra essa URL — investigação confirmou que este projeto **não tinha nenhum
fallback de SPA configurado** em `vercel.json` (só o `redirects` da raiz institucional): sem uma regra
explícita, `/encanto/download` bateria direto no host estático e devolveria 404 antes do bundle carregar.

**Decisão:** `vercel.json` ganhou `"rewrites": [{"source":"/encanto/download","destination":"/encanto/index.html"}]`
— escopado só a esse path novo (não um catch-all `/encanto/(.*)`, pra não alterar como nenhum outro path
existente já resolve, ex.: `/encanto/assets/...` continua servido como arquivo real). Dentro do bundle,
`hooks/useDownloadPage.js` (novo) faz o mesmo tipo de checagem 1x-no-mount que `useAdminSession.js` já usa
pro hash do Admin, só que comparando `window.location.pathname`. `App.jsx` intercepta **depois** de todos
os hooks (regra dos hooks preservada) e **antes** do branch `mode` normal, renderizando
`components/DownloadScreen.jsx` (novo) — uma página standalone, fora da árvore Loja/Admin.

**Decisão consciente — o arquivo `Encanto.apk` ainda não foi publicado:** o botão da página já é
funcional, apontando pra `/encanto/downloads/Encanto.apk` — mas esse arquivo **ainda não existe** no
repositório. O motivo: o APK gerado na Onda 6 é um build DEBUG que só teve a **compilação** validada (CI
verde); a validação **funcional** num aparelho físico real (login, pedidos, impressão, ausência do alerta
Play Protect) é uma pendência explícita do dono, ainda em aberto. Como qualquer push nesta REF já dispara
deploy automático de produção (Vercel), publicar um link de download real e funcionando *antes* dessa
validação colocaria um binário não testado ao alcance de qualquer visitante do site — um risco
desnecessário quando o pedido original já era explícito sobre não automatizar a distribuição
("Não implementar atualização automática de APK... apenas preparar distribuição"). A infraestrutura está
100% pronta; falta só colocar o arquivo validado em `public/downloads/Encanto.apk` (passo manual,
deliberadamente fora desta execução).

**Atualização pós-D10:** barreira removida — `public/downloads/Encanto.apk` publicado, cópia byte a byte
do artefato que passou pela homologação física (mesmo `sha256`, `da390a02...`). `vercel.json` ganhou um
`Content-Type` explícito (`application/vnd.android.package-archive`) só pra esse arquivo, já que nem
Vite nem o host estático inferem esse MIME type sozinhos pra `.apk`.

### D10 — Homologação física da Onda 6: 3 causas raiz distintas, encontradas por execução real (não leitura de código)

A validação em dispositivo físico (Android 16) revelou 3 problemas **sequenciais e independentes**, cada
um mascarando o próximo — só apareceram um de cada vez, à medida que o anterior era corrigido. Nenhum
deles foi resolvido por inferência: todos foram isolados executando o artefato real (o `.apk`/`.zip`
gerado pela CI) fora do ambiente de origem, com `aapt`/`apksigner`/`unzip`/Playwright — nunca só lendo
código-fonte e supondo o comportamento.

**Causa raiz #1 — instalação falhava ("Ocorreu um problema ao analisar o pacote").**
Auditoria completa do pipeline (tarefa Gradle, ordem `build`→`cap sync`, cache, universal/ABI, assinatura)
não achou nada errado — `aapt dump badging`+`apksigner verify` (novo gate automático no
`android-apk.yml`, roda antes do upload) sempre passaram. A causa real só apareceu comparando hashes:
**o backend de GitHub Actions Artifacts (v4) reconstrói o `.zip` de download dinamicamente a cada
requisição**, e a reconstrução feita pelo caminho da **interface web** entregava um `app-debug.apk` com
**572 bytes a menos** que o original — determinístico e reproduzível (mesmo resultado age após age,
mesmo depois de eliminar cache/pasta antiga/extração incorreta), mas incorreto. O caminho da **API REST**
(`archive_download_url`) sempre reconstruiu o zip correto, confirmado batendo com o `sha256sum` calculado
**dentro do próprio job da CI, antes de qualquer zip existir** — a fonte da verdade. Ver issue pública
relacionada: [actions/upload-artifact#190](https://github.com/actions/upload-artifact/issues/190).
**Mitigação adotada:** baixar artefatos desta REF exclusivamente via API (`curl`/`Invoke-WebRequest` com
token `workflow`), nunca clicando "Download" na UI do GitHub, até esse bug ser corrigido do lado deles —
não é algo que este repositório possa corrigir.

**Causa raiz #2 — app instalava e abria, mas mostrava catálogo genérico/desatualizado.**
Extraí o `.apk` (é um `.zip`) e rodei o `index.html`/JS reais (os que vieram da CI) num Chromium de
verdade via Playwright — não bastava ler o código, precisava ver o boot acontecer. Console mostrou:
```
[Encanto] Supabase init erro: supabaseUrl is required.
[Encanto] ⚠️ Supabase offline — categorias/products usando fallback local
```
`android-apk.yml` nunca passava `VITE_SUPABASE_URL`/`VITE_SUPABASE_KEY` ao step de build —
`createClient()` (em `lib/supabase.js`/`lib/dbCliente.js`) lançava a exceção documentada do próprio
`@supabase-js` pra URL ausente, o `catch` degradava `db`/`dbCliente` pra `null` (comportamento **correto e
intencional** do código pra esse cenário) e `services/DataService.js:33` caía no catálogo mock
(`src/data/mockCatalog.js`) — o "layout antigo" reportado era esse fallback, não uma versão velha do
bundle (confirmado: o JS continha strings de código recém-adicionado, como "Baixar aplicativo Android" da
Onda 7). **Decisão explícita, discutida com o dono:** os secrets de produção (`VITE_SUPABASE_URL`/
`VITE_SUPABASE_KEY`, mesmos valores da Vercel) tiveram que ser criados **novos**, não reaproveitando
`E2E_SUPABASE_URL`/`E2E_SUPABASE_ANON_KEY` já existentes — esses apontam pra um projeto Supabase dedicado
e isolado da REF-E2E-01, usado só por testes automatizados; reutilizá-los faria o app distribuído a
clientes reais rodar contra um banco de teste (pedidos reais se perderiam, invisíveis ao Admin real).
**Correção:** `env:` novo no step "Build web" do `android-apk.yml`, lendo `secrets.VITE_SUPABASE_URL`/
`secrets.VITE_SUPABASE_KEY` — mesmo padrão já usado pelo job `e2e` do `ci.yml`. Diff mínimo, zero código
de aplicação alterado.

**Causa raiz #3 (regressão intermediária) — mesmo após cadastrar os secrets, catálogo real não carregava.**
`createClient()` parou de lançar exceção (prova de que os secrets tinham valor), mas a rede falhava com
`ERR_NAME_NOT_RESOLVED`. Comparando as URLs de fato gravadas no bundle: o valor colado no secret
`VITE_SUPABASE_URL` tinha duas letras trocadas de posição (`...jwv` **s** `n` `lo` em vez de `...jwv` `n`
**s** `lo`) — um domínio que nunca existiu. Confirmado testando as duas URLs de verdade (`curl`): a
correta respondia HTTP 401 (existe, só faltava a API key na chamada de teste); a com o typo nem
resolvia DNS. Corrigido recolando o valor certo no secret.

**Validação final, com evidência de execução real em cada etapa (não suposição em nenhuma):**
- Boot do bundle real (extraído do `.apk`, rodado em Chromium via Playwright) mostrando `"✅ 8 categorias
  carregadas do Supabase"` / `"✅ 24 products carregados do Supabase"`, com produtos e preços
  genuinamente distintos do catálogo mock, e todas as chamadas REST/RPC ao Supabase retornando 200.
- Integridade do artefato reconfirmada 3 vezes de forma independente (hash do zip via API, hash do `.apk`
  extraído, teste de CRC de todas as entradas via `unzip -t`) — sempre o mesmo resultado.
- **Homologação física no aparelho real (Android 16) concluída pelo dono: instalação normal, app abre e
  funciona corretamente.** Esta é a confirmação que fecha a Onda 6 de fato — todas as validações
  anteriores (CI verde, `aapt`/`apksigner`, boot num Chromium local) eram necessárias mas não
  substituíam o teste no hardware/SO real.

**Nota de escopo, honesta:** esta homologação confirma o app abrindo e o catálogo real carregando —
não constitui, por si só, um teste funcional dedicado dos fluxos específicos de D5 (login Google nativo via
deep link), D6 (botão físico voltar) ou D7 (impressão nativa da comanda), que dependem de ações do usuário
mais específicas (fazer login, navegar por modais, imprimir uma comanda no Admin). Recomenda-se exercitar
esses 3 fluxos no uso real subsequente do aparelho de teste.

**Nota de processo:** dois tokens do GitHub (escopo `workflow`) foram usados durante esta investigação,
ambos exclusivamente para chamadas de leitura/dispatch pontuais, nunca persistidos em arquivo nem em
memória — o dono foi orientado a revogá-los após o uso, por serem credenciais coladas em texto puro na
conversa.

## Encerramento

**O Encanto passa a ter três formas oficiais de utilização**, todas servidas pelo mesmo código-fonte,
mesma arquitetura, mesmo backend Supabase — nenhuma é um "produto separado":

1. 🌐 **Navegador** — `https://valionsistemas.com.br/encanto`, o app web original.
2. 📲 **PWA** — mesmo endereço, instalável via "Adicionar à tela inicial" (REF-MOBILE-01). Continua sendo
   a forma de instalação **primária/recomendada** — esta REF não a substitui nem a deprecia.
3. 📦 **APK Android nativo** — `https://valionsistemas.com.br/encanto/download`, instalação direta (fora
   da Play Store, sem o aviso de compatibilidade que às vezes aparece na instalação do PWA via WebAPK,
   motivação original desta REF). Gerado via Capacitor (D1-D9), com uma segunda forma de login (D5),
   comportamento de navegação nativo (D6) e impressão nativa (D7) específicos dela.

**Todas as 8 ondas concluídas, com homologação física real (não só CI) confirmando a Onda 6 e o D5:**

- Ondas 1-3: Dual Build + integração Capacitor + projeto Android (versões modernas de fábrica).
- Onda 4: OAuth Google nativo, botão voltar, geolocalização, impressão nativa — código completo.
- Onda 5: ícones/splash/tema a partir da identidade visual já existente.
- **Onda 6: homologação física no Android 16 do dono, concluída com sucesso**, depois de uma investigação
  real com 3 causas raiz sequenciais (D10) — bug de infraestrutura do GitHub Actions Artifacts, secrets
  do Supabase ausentes, typo num secret. Nenhuma delas era um defeito de arquitetura desta REF.
- **Onda 7: `public/downloads/Encanto.apk` publicado em produção**, cópia exata do artefato homologado —
  confirmado ao vivo (`https://valionsistemas.com.br/encanto/downloads/Encanto.apk`, hash conferido,
  `Content-Type` correto).
- **D5 (login Google nativo): validado fisicamente pelo dono** — Redirect URL cadastrada no Supabase Auth,
  fluxo completo (Browser do sistema → deep link → sessão) confirmado ponta a ponta, sem regressão no
  Web/PWA/APK.
- Onda 8 (esta seção): documentação de encerramento.

**Limitações conhecidas, aceitas conscientemente (não são bugs):**
- Login/botão voltar/impressão nativa (D5-D7) tiveram validação funcional real (D10 + fechamento do D5);
  fluxos menos centrais (ex.: modais internos do Admin reagindo ao botão voltar) permanecem fora do
  escopo original, registrados em D6.
- `public/downloads/Encanto.apk` é atualizado **manualmente** (build validado → cópia → commit) — sem
  pipeline de atualização automática, por decisão explícita do pedido original.
- Publicação em loja oficial (Play Store) **não faz parte desta REF**, por decisão explícita do pedido
  original — arquitetura já compatível com isso no futuro (mesmo `appId`, mesmo projeto Android).

**REF-CAP-01 encerrada.** Nenhuma pendência técnica bloqueante restante. Trabalho relacionado ao go-live
geral do sistema (migrations, WhatsApp, Mapbox, QA ampliada, etc.) pertence a uma iniciativa própria
(`docs/PLANO-GOLIVE-01*`), fora do escopo desta REF.
